import crypto from 'node:crypto';
import path from 'node:path';

export type MediaKind = 'video' | 'audio' | 'image';

export interface SubtitleRef {
  id: string;
  language: string | null;
  label: string;
  format: 'srt' | 'vtt';
}

/** Stored form of a subtitle (includes the absolute path; never sent to clients). */
export interface StoredSubtitle extends SubtitleRef {
  path: string;
}

export interface Progress {
  positionSec: number;
  completed: boolean;
  updatedAt: string;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  fileName: string;
  relativePath: string;
  libraryId: string;
  folder: string;
  size: number;
  mimeType: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  directPlayable: boolean;
  series: { name: string; season: number; episode: number } | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  addedAt: string;
  modifiedAt: string;
  hasThumbnail: boolean;
  subtitles: SubtitleRef[];
  progress: Progress | null;
}

export interface MediaRow {
  id: string;
  kind: MediaKind;
  path: string;
  library_id: string;
  relative_path: string;
  folder: string;
  file_name: string;
  title: string;
  size: number;
  mtime_ms: number;
  mime_type: string;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  container: string | null;
  direct_playable: number;
  series_name: string | null;
  season: number | null;
  episode: number | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  added_at: string;
  modified_at: string;
  has_thumbnail: number;
  subtitles: string;
}

/** Row joined with the current user's progress (p_* columns may be null). */
export interface MediaRowWithProgress extends MediaRow {
  p_position: number | null;
  p_completed: number | null;
  p_updated: string | null;
}

const VIDEO_EXT = ['mp4', 'm4v', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'ts', 'm2ts', 'mpg', 'mpeg', '3gp'];
const AUDIO_EXT = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma', 'alac'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'];

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  alac: 'audio/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
};

export function extOf(fileName: string): string {
  return path.extname(fileName).slice(1).toLowerCase();
}

export function kindForFile(fileName: string): MediaKind | null {
  const ext = extOf(fileName);
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return null;
}

export function mimeForFile(fileName: string): string {
  return MIME[extOf(fileName)] ?? 'application/octet-stream';
}

/** Stable 16-hex-char id: sha1 of the absolute path. */
export function idForPath(absPath: string): string {
  return crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 16);
}

const DIRECT_VIDEO_CONTAINERS = ['mp4', 'm4v', 'webm', 'mov'];
const DIRECT_VIDEO_CODECS = ['h264', 'hevc', 'vp9', 'av1'];
const DIRECT_AUDIO_CODECS = ['aac', 'mp3', 'opus'];
const DIRECT_AUDIO_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac'];
const DIRECT_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

export function isDirectPlayable(
  kind: MediaKind,
  fileName: string,
  videoCodec: string | null,
  audioCodec: string | null,
): boolean {
  const ext = extOf(fileName);
  if (kind === 'video') {
    if (!DIRECT_VIDEO_CONTAINERS.includes(ext)) return false;
    if (!videoCodec || !DIRECT_VIDEO_CODECS.includes(videoCodec)) return false;
    return audioCodec === null || DIRECT_AUDIO_CODECS.includes(audioCodec);
  }
  if (kind === 'audio') return DIRECT_AUDIO_EXT.includes(ext);
  return DIRECT_IMAGE_EXT.includes(ext);
}

export function rowToItem(row: MediaRow | MediaRowWithProgress): MediaItem {
  let subtitles: SubtitleRef[] = [];
  try {
    const stored = JSON.parse(row.subtitles) as StoredSubtitle[];
    subtitles = stored.map((s) => ({ id: s.id, language: s.language, label: s.label, format: s.format }));
  } catch {
    subtitles = [];
  }
  const withP = row as Partial<MediaRowWithProgress>;
  const progress: Progress | null =
    withP.p_updated != null && withP.p_position != null
      ? { positionSec: withP.p_position, completed: withP.p_completed === 1, updatedAt: withP.p_updated }
      : null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    fileName: row.file_name,
    relativePath: row.relative_path,
    libraryId: row.library_id,
    folder: row.folder,
    size: row.size,
    mimeType: row.mime_type,
    durationSec: row.duration_sec,
    width: row.width,
    height: row.height,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    container: row.container,
    directPlayable: row.direct_playable === 1,
    series:
      row.series_name != null && row.season != null && row.episode != null
        ? { name: row.series_name, season: row.season, episode: row.episode }
        : null,
    artist: row.artist,
    album: row.album,
    year: row.year,
    addedAt: row.added_at,
    modifiedAt: row.modified_at,
    hasThumbnail: row.has_thumbnail === 1,
    subtitles,
    progress,
  };
}

export function storedSubtitles(row: MediaRow): StoredSubtitle[] {
  try {
    return JSON.parse(row.subtitles) as StoredSubtitle[];
  } catch {
    return [];
  }
}
