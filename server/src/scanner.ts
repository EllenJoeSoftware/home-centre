import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { SKIP_DIRS } from './browse.js';
import type { Config } from './config.js';
import { type DB, getSetting, setSetting } from './db.js';
import { containerName, coverThumbnail, probe, resizeImage, videoThumbnail } from './ffmpeg.js';
import {
  extOf,
  idForPath,
  isDirectPlayable,
  kindForFile,
  type MediaKind,
  type MediaRow,
  mimeForFile,
  type StoredSubtitle,
} from './media.js';
import { parseMediaName } from './parse.js';

export interface Library {
  id: string;
  name: string;
  path: string;
  itemCount: number;
}

interface FoundFile {
  abs: string;
  libraryId: string;
  relativePath: string;
  folder: string;
  fileName: string;
  kind: MediaKind;
  subtitles: StoredSubtitle[];
}

export { libraryIdForPath } from './libraries.js';

export function subtitleId(subPath: string): string {
  return crypto.createHash('sha1').update(subPath).digest('hex').slice(0, 12);
}

/**
 * Find sidecar subtitles for a video: `<base>.srt`, `<base>.vtt`, `<base>.<lang>.srt`, `<base>.<lang>.forced.vtt` …
 * `siblings` are the file names in the same directory.
 */
export function findSidecarSubtitles(dir: string, videoFileName: string, siblings: string[]): StoredSubtitle[] {
  const base = videoFileName.slice(0, videoFileName.length - path.extname(videoFileName).length).toLowerCase();
  const subs: StoredSubtitle[] = [];
  for (const name of siblings) {
    const ext = extOf(name);
    if (ext !== 'srt' && ext !== 'vtt') continue;
    const stem = name.slice(0, name.length - ext.length - 1);
    const lower = stem.toLowerCase();
    let middle: string | null;
    if (lower === base) middle = null;
    else if (lower.startsWith(`${base}.`)) middle = stem.slice(base.length + 1);
    else continue;
    let language: string | null = null;
    let forced = false;
    let sdh = false;
    if (middle) {
      const parts = middle.split('.').filter((p) => p.length > 0);
      for (const p of parts) {
        const pl = p.toLowerCase();
        if (pl === 'forced') forced = true;
        else if (pl === 'sdh' || pl === 'cc' || pl === 'hi') sdh = true;
        else if (!language) language = p;
      }
    }
    let label = language ? language.toUpperCase() : 'Default';
    if (forced) label += ' (Forced)';
    if (sdh) label += ' (SDH)';
    const subPath = path.join(dir, name);
    subs.push({ id: subtitleId(subPath), language, label, format: ext, path: subPath });
  }
  subs.sort((a, b) => a.label.localeCompare(b.label));
  return subs;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export class Scanner {
  running = false;
  private current: Promise<void> | null = null;
  private rerun = false;
  private stopped = false;
  readonly thumbsDir: string;

  constructor(
    private readonly db: DB,
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {
    this.thumbsDir = path.join(config.dataDir, 'cache', 'thumbs');
    fs.mkdirSync(this.thumbsDir, { recursive: true });
  }

  get lastScanAt(): string | null {
    return getSetting(this.db, 'lastScanAt');
  }

  itemCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n;
  }

  /** Libraries from the DB (source of truth) with their item counts. Read fresh on every scan. */
  libraries(): Library[] {
    return this.db
      .prepare(
        `SELECT l.id, l.name, l.path, (SELECT COUNT(*) FROM media m WHERE m.library_id = l.id) AS itemCount
         FROM libraries l ORDER BY l.created_at, l.rowid`,
      )
      .all() as Library[];
  }

  library(id: string): Library | null {
    return this.libraries().find((l) => l.id === id) ?? null;
  }

  /**
   * Remove every indexed item of a library (progress rows go with them via ON DELETE CASCADE)
   * and, best-effort, their cached thumbnails. Returns the number of items removed.
   */
  removeLibraryMedia(libraryId: string): number {
    const ids = (this.db.prepare('SELECT id FROM media WHERE library_id = ?').all(libraryId) as { id: string }[]).map(
      (r) => r.id,
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM progress WHERE media_id IN (SELECT id FROM media WHERE library_id = ?)').run(libraryId);
      this.db.prepare('DELETE FROM media WHERE library_id = ?').run(libraryId);
    })();
    if (ids.length > 0) void this.removeThumbs(new Set(ids));
    return ids.length;
  }

  private async removeThumbs(ids: Set<string>): Promise<void> {
    try {
      for (const name of await fs.promises.readdir(this.thumbsDir)) {
        const id = name.slice(0, 16);
        if (ids.has(id) && (name === `${id}.jpg` || name.startsWith(`${id}_w`))) {
          await fs.promises.rm(path.join(this.thumbsDir, name), { force: true });
        }
      }
    } catch {
      /* best-effort */
    }
  }

  thumbPath(id: string): string {
    return path.join(this.thumbsDir, `${id}.jpg`);
  }

  /** Stop scanning (used on shutdown). In-flight work bails out at the next checkpoint. */
  stop(): void {
    this.stopped = true;
    this.rerun = false;
  }

  /** Wait (bounded) for an in-flight scan to finish. */
  async idle(timeoutMs = 5000): Promise<void> {
    if (!this.current) return;
    await Promise.race([this.current.catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }

  /** Start a scan (or queue one more if a scan is already running). Resolves when scanning settles. */
  scan(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.current) {
      this.rerun = true;
      return this.current;
    }
    this.running = true;
    this.current = (async () => {
      try {
        do {
          this.rerun = false;
          await this.scanOnce();
        } while (this.rerun && !this.stopped);
      } finally {
        this.running = false;
        this.current = null;
      }
    })();
    return this.current;
  }

  private async scanOnce(): Promise<void> {
    const started = Date.now();
    let processed = 0;
    let removed = 0;
    const libs = this.libraries();

    for (const lib of libs) {
      if (this.stopped) return;
      let rootOk = false;
      try {
        rootOk = (await fs.promises.stat(lib.path)).isDirectory();
      } catch {
        rootOk = false;
      }
      if (!rootOk) {
        // Do not delete anything: the volume may just be temporarily unmounted.
        this.log.warn({ path: lib.path }, 'media dir not accessible; skipping');
        continue;
      }
      const found: FoundFile[] = [];
      await this.walk(lib.path, lib.path, lib.id, found, new Set());
      const seen = new Set<string>();
      await pool(found, 3, async (f) => {
        if (this.stopped) return;
        const id = idForPath(f.abs);
        seen.add(id);
        try {
          if (await this.processFile(id, f)) processed++;
        } catch (err) {
          this.log.warn({ err, file: f.abs }, 'failed to index file');
        }
      });
      if (this.stopped) return;
      const rows = this.db.prepare('SELECT id FROM media WHERE library_id = ?').all(lib.id) as { id: string }[];
      for (const { id } of rows) {
        if (!seen.has(id)) {
          this.removeItem(id);
          removed++;
        }
      }
    }

    // Items from libraries no longer configured.
    const libIds = libs.map((l) => l.id);
    const stale = this.db
      .prepare(`SELECT id FROM media WHERE library_id NOT IN (${libIds.map(() => '?').join(',') || "''"})`)
      .all(...libIds) as { id: string }[];
    for (const { id } of stale) {
      this.removeItem(id);
      removed++;
    }

    setSetting(this.db, 'lastScanAt', new Date().toISOString());
    this.log.info(
      { processed, removed, total: this.itemCount(), ms: Date.now() - started },
      'library scan finished',
    );
  }

  private removeItem(id: string): void {
    this.db.prepare('DELETE FROM media WHERE id = ?').run(id);
    void fs.promises.rm(this.thumbPath(id), { force: true });
    void this.removeResizedThumbs(id);
  }

  private async removeResizedThumbs(id: string): Promise<void> {
    try {
      for (const name of await fs.promises.readdir(this.thumbsDir)) {
        if (name.startsWith(`${id}_w`)) await fs.promises.rm(path.join(this.thumbsDir, name), { force: true });
      }
    } catch {
      /* ignore */
    }
  }

  private async walk(root: string, dir: string, libraryId: string, out: FoundFile[], visited: Set<string>): Promise<void> {
    let real: string;
    try {
      real = await fs.promises.realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real) || this.stopped) return;
    visited.add(real);

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      this.log.warn({ err, dir }, 'cannot read directory');
      return;
    }
    const names = entries.map((e) => e.name);
    const subdirs: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const st = await fs.promises.stat(abs);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        subdirs.push(abs);
        continue;
      }
      if (!isFile) continue;
      const kind = kindForFile(e.name);
      if (!kind) continue;
      const relativePath = path.relative(root, abs).split(path.sep).join('/');
      const folderRel = path.relative(root, dir).split(path.sep).join('/');
      out.push({
        abs,
        libraryId,
        relativePath,
        folder: folderRel,
        fileName: e.name,
        kind,
        subtitles: kind === 'video' ? findSidecarSubtitles(dir, e.name, names) : [],
      });
    }
    for (const sub of subdirs) await this.walk(root, sub, libraryId, out, visited);
  }

  /** Returns true when the file was (re)probed. */
  private async processFile(id: string, f: FoundFile): Promise<boolean> {
    const st = await fs.promises.stat(f.abs);
    const size = st.size;
    const mtimeMs = Math.floor(st.mtimeMs);
    const existing = this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
    const subsJson = JSON.stringify(f.subtitles);

    if (existing && existing.size === size && existing.mtime_ms === mtimeMs) {
      if (existing.subtitles !== subsJson || existing.library_id !== f.libraryId) {
        this.db
          .prepare('UPDATE media SET subtitles = ?, library_id = ? WHERE id = ?')
          .run(subsJson, f.libraryId, id);
      }
      return false;
    }

    const ext = extOf(f.fileName);
    const info = await probe(this.config.ffprobePath, f.abs).catch((err: unknown) => {
      this.log.warn({ err, file: f.abs }, 'ffprobe failed');
      return null;
    });
    const parsed = parseMediaName(f.fileName, f.folder, f.kind);

    let durationSec: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let videoCodec: string | null = null;
    let audioCodec: string | null = null;
    let container: string | null = null;
    let artist: string | null = null;
    let album: string | null = null;
    let year: number | null = parsed.year;

    if (info) {
      if (f.kind === 'video') {
        durationSec = info.durationSec;
        width = info.width;
        height = info.height;
        videoCodec = info.videoCodec;
        audioCodec = info.audioCodec;
        container = containerName(info.formatName, ext);
      } else if (f.kind === 'audio') {
        durationSec = info.durationSec;
        audioCodec = info.audioCodec;
        container = containerName(info.formatName, ext);
        artist = info.tags.artist ?? info.tags.album_artist ?? null;
        album = info.tags.album ?? null;
        const date = info.tags.date ?? info.tags.year ?? info.tags.originaldate;
        const ym = date ? /(\d{4})/.exec(date) : null;
        year = ym ? Number.parseInt(ym[1]!, 10) : null;
      } else {
        width = info.width;
        height = info.height;
      }
    }

    // Thumbnail
    const thumb = this.thumbPath(id);
    await this.removeResizedThumbs(id);
    let hasThumb = false;
    if (f.kind === 'video') {
      if (info?.videoCodec) {
        const at = durationSec ? durationSec * 0.1 : 1;
        hasThumb = await videoThumbnail(this.config.ffmpegPath, f.abs, thumb, at);
      }
    } else if (f.kind === 'audio') {
      if (info?.hasCoverArt) hasThumb = await coverThumbnail(this.config.ffmpegPath, f.abs, thumb);
    } else {
      hasThumb = await resizeImage(this.config.ffmpegPath, f.abs, thumb, 480);
    }
    if (!hasThumb) await fs.promises.rm(thumb, { force: true });

    if (this.stopped) return false;
    const now = new Date().toISOString();
    const row: MediaRow = {
      id,
      kind: f.kind,
      path: f.abs,
      library_id: f.libraryId,
      relative_path: f.relativePath,
      folder: f.folder,
      file_name: f.fileName,
      title: parsed.title,
      size,
      mtime_ms: mtimeMs,
      mime_type: mimeForFile(f.fileName),
      duration_sec: durationSec,
      width,
      height,
      video_codec: videoCodec,
      audio_codec: audioCodec,
      container,
      direct_playable: isDirectPlayable(f.kind, f.fileName, videoCodec, audioCodec) ? 1 : 0,
      series_name: parsed.series?.name ?? null,
      season: parsed.series?.season ?? null,
      episode: parsed.series?.episode ?? null,
      artist,
      album,
      year,
      added_at: existing?.added_at ?? now,
      modified_at: new Date(st.mtimeMs).toISOString(),
      has_thumbnail: hasThumb ? 1 : 0,
      subtitles: subsJson,
    };
    this.db
      .prepare(
        `INSERT INTO media (id, kind, path, library_id, relative_path, folder, file_name, title, size, mtime_ms, mime_type,
          duration_sec, width, height, video_codec, audio_codec, container, direct_playable, series_name, season, episode,
          artist, album, year, added_at, modified_at, has_thumbnail, subtitles)
         VALUES (@id, @kind, @path, @library_id, @relative_path, @folder, @file_name, @title, @size, @mtime_ms, @mime_type,
          @duration_sec, @width, @height, @video_codec, @audio_codec, @container, @direct_playable, @series_name, @season, @episode,
          @artist, @album, @year, @added_at, @modified_at, @has_thumbnail, @subtitles)
         ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind, path = excluded.path, library_id = excluded.library_id, relative_path = excluded.relative_path,
          folder = excluded.folder, file_name = excluded.file_name, title = excluded.title, size = excluded.size,
          mtime_ms = excluded.mtime_ms, mime_type = excluded.mime_type, duration_sec = excluded.duration_sec,
          width = excluded.width, height = excluded.height, video_codec = excluded.video_codec,
          audio_codec = excluded.audio_codec, container = excluded.container, direct_playable = excluded.direct_playable,
          series_name = excluded.series_name, season = excluded.season, episode = excluded.episode,
          artist = excluded.artist, album = excluded.album, year = excluded.year, modified_at = excluded.modified_at,
          has_thumbnail = excluded.has_thumbnail, subtitles = excluded.subtitles`,
      )
      .run(row);
    return true;
  }
}
