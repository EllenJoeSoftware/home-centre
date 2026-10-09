import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireUser } from '../auth.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { resizeImage } from '../ffmpeg.js';
import { type MediaRow, storedSubtitles } from '../media.js';
import { sendFile } from '../stream.js';

type IdParams = { Params: { id: string }; Querystring: Record<string, string | undefined> };

/** Convert SRT text to WebVTT. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    // 00:00:01,000 --> 00:00:02,000  →  00:00:01.000 --> 00:00:02.000
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2')
    // Some SRTs omit hours on timestamps; pad "MM:SS.mmm" to "00:MM:SS.mmm" on cue lines only.
    .replace(/^(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})/gm, '00:$1 --> 00:$2')
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

function decodeText(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  // Invalid UTF-8 → assume Windows-1252/Latin-1, the most common legacy SRT encoding.
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

export function registerPlaybackRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, scanner, transcoder, config } = ctx;

  const getRow = (id: string): MediaRow => {
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
    if (!row) throw notFound('Media not found');
    return row;
  };

  app.get<IdParams>('/api/media/:id/stream', async (request, reply) => {
    const row = getRow(request.params.id);
    return sendFile(request, reply, row.path, { contentType: row.mime_type });
  });

  app.get<IdParams>('/api/media/:id/thumbnail', async (request, reply) => {
    const row = getRow(request.params.id);
    const base = scanner.thumbPath(row.id);
    if (!row.has_thumbnail || !fs.existsSync(base)) throw notFound('No thumbnail');
    let file = base;
    const wRaw = request.query.w;
    if (wRaw !== undefined && wRaw !== '') {
      const w = Number.parseInt(wRaw, 10);
      if (!Number.isFinite(w) || w <= 0) throw badRequest('w must be a positive integer');
      const width = Math.max(16, Math.min(w, 1920));
      if (width < 480) {
        const resized = path.join(scanner.thumbsDir, `${row.id}_w${width}.jpg`);
        const baseStat = await fs.promises.stat(base);
        const ok = await fs.promises
          .stat(resized)
          .then((st) => st.mtimeMs >= baseStat.mtimeMs)
          .catch(() => false);
        if (ok || (await resizeImage(config.ffmpegPath, base, resized, width))) file = resized;
      }
    }
    return sendFile(request, reply, file, { contentType: 'image/jpeg', cacheControl: 'private, max-age=3600' });
  });

  app.get<{ Params: { id: string; subId: string } }>('/api/media/:id/subtitles/:subId', async (request, reply) => {
    const row = getRow(request.params.id);
    const subId = request.params.subId.replace(/\.(vtt|srt)$/i, '');
    const sub = storedSubtitles(row).find((s) => s.id === subId);
    if (!sub) throw notFound('Subtitle not found');
    let buf: Buffer;
    try {
      buf = await fs.promises.readFile(sub.path);
    } catch {
      throw notFound('Subtitle file missing');
    }
    let text = decodeText(buf);
    if (sub.format === 'srt') {
      text = srtToVtt(text);
    } else {
      text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      if (!text.startsWith('WEBVTT')) text = `WEBVTT\n\n${text}`;
    }
    return reply.header('Cache-Control', 'private, max-age=300').type('text/vtt; charset=utf-8').send(text);
  });

  app.get<IdParams>('/api/media/:id/transcode.m3u8', async (request, reply) => {
    const user = requireUser(request);
    const row = getRow(request.params.id);
    if (row.kind !== 'video') throw badRequest('Only video items can be transcoded');
    let start = 0;
    if (request.query.start !== undefined && request.query.start !== '') {
      start = Number.parseFloat(request.query.start);
      if (!Number.isFinite(start) || start < 0) throw badRequest('start must be a non-negative number of seconds');
    }
    const playlist = await transcoder.createPlaylist(row, user.id, request.authToken ?? '', start);
    return reply
      .header('Cache-Control', 'no-store')
      .type('application/vnd.apple.mpegurl')
      .send(playlist);
  });

  app.get<{ Params: { id: string; session: string; segment: string } }>(
    '/api/media/:id/hls/:session/:segment',
    async (request, reply) => {
      const user = requireUser(request);
      const s = transcoder.getSession(request.params.session, request.params.id, user.id);
      const seg = request.params.segment;
      if (seg === 'index.m3u8') {
        const text = await transcoder.livePlaylist(s, request.authToken ?? '');
        return reply.header('Cache-Control', 'no-store').type('application/vnd.apple.mpegurl').send(text);
      }
      const m = /^(\d{1,6})\.ts$/.exec(seg);
      if (!m) throw new HttpError(404, 'Unknown segment');
      const file = await transcoder.segmentPath(s, Number.parseInt(m[1]!, 10));
      return sendFile(request, reply, file, { contentType: 'video/mp2t', cacheControl: 'private, max-age=600' });
    },
  );
}
