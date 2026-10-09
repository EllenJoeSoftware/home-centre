import { spawn } from 'node:child_process';
import fs from 'node:fs';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a process, collecting output. Never throws for non-zero exit; rejects only on spawn failure/timeout. */
export function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let errLen = 0;
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      if (errLen < 64 * 1024) {
        err.push(d);
        errLen += d.length;
      }
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}

export interface ProbeResult {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string | null;
  hasCoverArt: boolean;
  tags: Record<string, string>;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; format_name?: string; tags?: Record<string, string> };
}

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function probe(ffprobePath: string, file: string): Promise<ProbeResult | null> {
  const res = await run(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    30_000,
  );
  if (res.code !== 0) return null;
  let data: FfprobeOutput;
  try {
    data = JSON.parse(res.stdout) as FfprobeOutput;
  } catch {
    return null;
  }
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const cover = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic === 1);
  const audio = streams.find((s) => s.codec_type === 'audio');

  const tags: Record<string, string> = {};
  for (const src of [data.format?.tags, audio?.tags]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      const key = k.toLowerCase();
      if (!(key in tags)) tags[key] = v;
    }
  }

  return {
    durationSec: num(data.format?.duration) ?? num(video?.duration) ?? num(audio?.duration),
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    formatName: data.format?.format_name ?? null,
    hasCoverArt: cover !== undefined,
    tags,
  };
}

/** Map ffprobe's format_name + extension to a single container name ("mp4", "matroska", ...). */
export function containerName(formatName: string | null, ext: string): string | null {
  if (!formatName) return null;
  const parts = formatName.split(',');
  if (parts.includes('matroska')) return ext === 'webm' ? 'webm' : 'matroska';
  if (parts.includes('mov') || parts.includes('mp4')) {
    if (['mp4', 'm4v', 'mov', 'm4a', '3gp'].includes(ext)) return ext === 'm4v' ? 'mp4' : ext;
    return 'mp4';
  }
  return parts[0] ?? null;
}

const SCALE_480 = "scale='min(480,iw)':-2";

async function finish(out: string, res: RunResult): Promise<boolean> {
  if (res.code !== 0) {
    await fs.promises.rm(out, { force: true });
    return false;
  }
  try {
    const st = await fs.promises.stat(out);
    return st.size > 0;
  } catch {
    return false;
  }
}

/** Grab a frame at `atSec` from a video. */
export async function videoThumbnail(ffmpegPath: string, file: string, out: string, atSec: number): Promise<boolean> {
  const args = (ss: number) => [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', ss.toFixed(2), '-i', file,
    '-map', '0:V:0', '-frames:v', '1',
    '-vf', `${SCALE_480},format=yuvj420p`, '-q:v', '4', '-f', 'image2', out,
  ];
  try {
    let res = await run(ffmpegPath, args(atSec), 60_000);
    if (await finish(out, res)) return true;
    if (atSec > 0) {
      res = await run(ffmpegPath, args(0), 60_000);
      return await finish(out, res);
    }
  } catch {
    /* ignore */
  }
  await fs.promises.rm(out, { force: true });
  return false;
}

/** Extract embedded cover art from an audio file. */
export async function coverThumbnail(ffmpegPath: string, file: string, out: string): Promise<boolean> {
  try {
    const res = await run(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-an', '-map', '0:v:0', '-frames:v', '1',
        '-vf', `${SCALE_480},format=yuvj420p`, '-q:v', '4', '-f', 'image2', out],
      30_000,
    );
    return await finish(out, res);
  } catch {
    return false;
  }
}

/** Resize an image (or an existing thumbnail) to at most `maxWidth` wide JPEG. */
export async function resizeImage(ffmpegPath: string, file: string, out: string, maxWidth = 480): Promise<boolean> {
  try {
    const res = await run(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1',
        '-vf', `scale='min(${maxWidth},iw)':-2,format=yuvj420p`, '-q:v', '4', '-f', 'image2', out],
      30_000,
    );
    return await finish(out, res);
  } catch {
    return false;
  }
}
