import { type ChildProcess, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import { HttpError } from './errors.js';
import type { MediaRow } from './media.js';

/** Segment length in seconds. Keyframes are forced on this grid so segments are exactly this long. */
export const SEGMENT_SECONDS = 4;
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;
/** Pause ffmpeg when it is this many segments ahead of the player, resume when within RESUME_AHEAD. */
const PAUSE_AHEAD = 40;
const RESUME_AHEAD = 20;
/** A request this far beyond what has been produced triggers a seek (restart) instead of waiting. */
const SEEK_THRESHOLD = 8;
const SEGMENT_WAIT_MS = 60_000;

interface Session {
  id: string;
  userId: number;
  mediaId: string;
  filePath: string;
  dir: string;
  durationSec: number | null;
  segmentCount: number | null;
  proc: ChildProcess | null;
  procExited: boolean;
  procFailed: boolean;
  runStart: number;
  /** Next segment index we expect the current ffmpeg run to produce. */
  nextExpected: number;
  lastRequested: number;
  paused: boolean;
  lastAccess: number;
  waiters: Set<() => void>;
  poller: NodeJS.Timeout | null;
}

export class TranscodeManager {
  private readonly sessions = new Map<string, Session>();
  private readonly root: string;
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {
    this.root = path.join(config.dataDir, 'cache', 'hls');
    // Leftovers from a previous run are useless.
    fs.rmSync(this.root, { recursive: true, force: true });
    fs.mkdirSync(this.root, { recursive: true });
    this.sweeper = setInterval(() => this.sweep(), 15_000);
    this.sweeper.unref();
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * Create a session and return the HLS media playlist text.
   * `token` is appended to every segment URI so players without header support work.
   */
  async createPlaylist(media: MediaRow, userId: number, token: string, startSec: number): Promise<string> {
    // One transcode per user+item: a new request (e.g. a seek via ?start=) replaces the old one.
    for (const s of this.sessions.values()) {
      if (s.userId === userId && s.mediaId === media.id) this.destroy(s.id);
    }
    if (this.sessions.size >= this.config.maxTranscodes) {
      // Evict the least recently used session belonging to the same user, if any.
      const own = [...this.sessions.values()].filter((s) => s.userId === userId).sort((a, b) => a.lastAccess - b.lastAccess);
      if (own[0]) this.destroy(own[0].id);
    }
    if (this.sessions.size >= this.config.maxTranscodes) {
      throw new HttpError(503, 'Too many concurrent transcodes; try again later');
    }

    const id = crypto.randomBytes(12).toString('hex');
    const dir = path.join(this.root, id);
    await fs.promises.mkdir(dir, { recursive: true });
    const duration = media.duration_sec && media.duration_sec > 0 ? media.duration_sec : null;
    const segmentCount = duration ? Math.max(1, Math.ceil(duration / SEGMENT_SECONDS - 1e-6)) : null;
    let startSegment = 0;
    if (segmentCount && startSec > 0) {
      startSegment = Math.min(segmentCount - 1, Math.floor(startSec / SEGMENT_SECONDS));
    }
    const session: Session = {
      id,
      userId,
      mediaId: media.id,
      filePath: media.path,
      dir,
      durationSec: duration,
      segmentCount,
      proc: null,
      procExited: true,
      procFailed: false,
      runStart: startSegment,
      nextExpected: startSegment,
      lastRequested: startSegment,
      paused: false,
      lastAccess: Date.now(),
      waiters: new Set(),
      poller: null,
    };
    this.sessions.set(id, session);
    this.startFfmpeg(session, startSegment);

    const q = `?token=${encodeURIComponent(token)}`;
    if (duration && segmentCount) {
      return buildVodPlaylist(id, duration, segmentCount, q, startSec > 0 ? startSec : null);
    }
    // Unknown duration: wait for ffmpeg's own (growing) playlist and expose it via a master playlist.
    return ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-STREAM-INF:BANDWIDTH=5000000', `hls/${id}/index.m3u8${q}`, ''].join('\n');
  }

  private startFfmpeg(s: Session, startSegment: number): void {
    this.stopFfmpeg(s);
    // Drop segments at/after the new start so progress accounting reflects this run only.
    try {
      for (const name of fs.readdirSync(s.dir)) {
        const m = /^(\d+)\.ts(?:\.tmp)?$/.exec(name);
        if (m && Number.parseInt(m[1]!, 10) >= startSegment) fs.rmSync(path.join(s.dir, name), { force: true });
      }
    } catch {
      /* ignore */
    }
    const startSec = startSegment * SEGMENT_SECONDS;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      ...(startSec > 0 ? ['-ss', String(startSec)] : []),
      '-i', s.filePath,
      '-map', '0:V:0', '-map', '0:a:0?',
      '-sn', '-dn',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p',
      '-vf', "scale='trunc(min(1920,iw)/2)*2':-2",
      '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
      '-sc_threshold', '0',
      '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
      ...(startSec > 0 ? ['-output_ts_offset', String(startSec)] : []),
      '-max_muxing_queue_size', '2048',
      '-f', 'hls',
      '-hls_time', String(SEGMENT_SECONDS),
      '-hls_list_size', '0',
      '-hls_segment_type', 'mpegts',
      '-hls_flags', 'temp_file+independent_segments',
      '-start_number', String(startSegment),
      '-hls_segment_filename', path.join(s.dir, '%d.ts'),
      path.join(s.dir, 'ffmpeg.m3u8'),
    ];
    const proc = spawn(this.config.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    s.proc = proc;
    s.procExited = false;
    s.procFailed = false;
    s.paused = false;
    s.runStart = startSegment;
    s.nextExpected = startSegment;
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 8192) stderr += d.toString();
    });
    proc.on('error', (err) => {
      this.log.error({ err }, 'failed to spawn ffmpeg');
      if (s.proc === proc) {
        s.procExited = true;
        s.procFailed = true;
        this.notify(s);
      }
    });
    proc.on('exit', (code, signal) => {
      if (s.proc !== proc) return;
      s.procExited = true;
      if (code !== 0 && signal === null) {
        s.procFailed = true;
        this.log.warn({ code, stderr: stderr.slice(0, 2000), session: s.id }, 'ffmpeg transcode failed');
      }
      this.poll(s);
      this.notify(s);
    });
    if (!s.poller) {
      s.poller = setInterval(() => this.poll(s), 500);
      s.poller.unref();
    }
    this.log.info({ session: s.id, media: s.mediaId, startSegment }, 'transcode started');
  }

  private stopFfmpeg(s: Session): void {
    const proc = s.proc;
    if (proc && !s.procExited) {
      if (s.paused) proc.kill('SIGCONT');
      proc.kill('SIGKILL');
    }
    s.proc = null;
    s.procExited = true;
    s.paused = false;
  }

  private setPaused(s: Session, paused: boolean): void {
    if (!s.proc || s.procExited || s.paused === paused) return;
    try {
      s.proc.kill(paused ? 'SIGSTOP' : 'SIGCONT');
      s.paused = paused;
    } catch {
      /* ignore */
    }
  }

  /** Advance nextExpected over segments that now exist; throttle ffmpeg. */
  private poll(s: Session): void {
    let advanced = false;
    while (fs.existsSync(path.join(s.dir, `${s.nextExpected}.ts`))) {
      s.nextExpected++;
      advanced = true;
    }
    if (advanced) this.notify(s);
    const ahead = s.nextExpected - s.lastRequested;
    if (ahead > PAUSE_AHEAD) this.setPaused(s, true);
    else if (ahead < RESUME_AHEAD) this.setPaused(s, false);
  }

  private notify(s: Session): void {
    for (const w of s.waiters) w();
    s.waiters.clear();
  }

  private waitForChange(s: Session, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        s.waiters.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      s.waiters.add(done);
    });
  }

  getSession(sessionId: string, mediaId: string, userId: number): Session {
    const s = this.sessions.get(sessionId);
    if (!s || s.mediaId !== mediaId) throw new HttpError(404, 'Transcode session not found or expired');
    if (s.userId !== userId) throw new HttpError(403, 'Not your transcode session');
    s.lastAccess = Date.now();
    return s;
  }

  /** Live playlist for unknown-duration sessions: ffmpeg's playlist with tokenised segment URIs. */
  async livePlaylist(s: Session, token: string): Promise<string> {
    const file = path.join(s.dir, 'ffmpeg.m3u8');
    const deadline = Date.now() + SEGMENT_WAIT_MS;
    for (;;) {
      try {
        const text = await fs.promises.readFile(file, 'utf8');
        if (text.includes('#EXTINF')) return rewritePlaylist(text, `?token=${encodeURIComponent(token)}`);
      } catch {
        /* not yet */
      }
      if (s.procExited || Date.now() > deadline) throw new HttpError(500, 'Transcode failed to start');
      await this.waitForChange(s, 500);
    }
  }

  /** Resolve the path of segment `index`, (re)starting ffmpeg as needed and waiting until it is ready. */
  async segmentPath(s: Session, index: number): Promise<string> {
    if (s.segmentCount !== null && (index < 0 || index >= s.segmentCount)) throw new HttpError(404, 'No such segment');
    const file = path.join(s.dir, `${index}.ts`);
    s.lastRequested = index;
    s.lastAccess = Date.now();

    const vod = s.segmentCount !== null;
    const deadline = Date.now() + SEGMENT_WAIT_MS;
    let restarted = false;
    for (;;) {
      if (fs.existsSync(file)) {
        this.poll(s);
        return file;
      }
      if (vod) {
        const needRestart = s.procExited || index < s.runStart || index > s.nextExpected + SEEK_THRESHOLD;
        if (needRestart) {
          // Already restarted for this request and ffmpeg ended without producing the segment.
          if (restarted) throw new HttpError(500, 'Transcode failed');
          this.startFfmpeg(s, index);
          restarted = true;
        }
      } else if (s.procExited) {
        throw new HttpError(404, 'Segment not available');
      }
      this.setPaused(s, false);
      if (Date.now() > deadline) throw new HttpError(504, 'Timed out waiting for segment');
      await this.waitForChange(s, 250);
      this.poll(s);
    }
  }

  destroy(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.stopFfmpeg(s);
    if (s.poller) clearInterval(s.poller);
    this.notify(s);
    fs.promises.rm(s.dir, { recursive: true, force: true }).catch(() => undefined);
    this.log.info({ session: id }, 'transcode session closed');
  }

  private sweep(): void {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (now - s.lastAccess > IDLE_TIMEOUT_MS) this.destroy(s.id);
    }
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const id of [...this.sessions.keys()]) this.destroy(id);
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

export function buildVodPlaylist(
  sessionId: string,
  durationSec: number,
  segmentCount: number,
  query: string,
  startSec: number | null,
): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  if (startSec !== null) lines.push(`#EXT-X-START:TIME-OFFSET=${startSec.toFixed(3)},PRECISE=YES`);
  for (let i = 0; i < segmentCount; i++) {
    const len = i === segmentCount - 1 ? durationSec - i * SEGMENT_SECONDS : SEGMENT_SECONDS;
    lines.push(`#EXTINF:${Math.max(0.001, len).toFixed(6)},`);
    lines.push(`hls/${sessionId}/${i}.ts${query}`);
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

/** Append `query` (e.g. "?token=…") to every URI line of an m3u8 playlist. */
export function rewritePlaylist(text: string, query: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (t === '' || t.startsWith('#')) return line;
      return t.includes('?') ? `${t}&${query.slice(1)}` : `${t}${query}`;
    })
    .join('\n');
}
