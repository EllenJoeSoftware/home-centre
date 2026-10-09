import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { notFound } from './errors.js';

export type RangeResult = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * Parse an HTTP Range header for a resource of `size` bytes.
 * Returns null when there is no (usable) range — serve the full body;
 * 'unsatisfiable' for a syntactically valid range outside the resource (416).
 * Multi-range requests are served using their first range only.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!m) return null;
  const first = m[1]!.split(',')[0]!.trim();
  const r = /^(\d*)\s*-\s*(\d*)$/.exec(first);
  if (!r) return null;
  const [, s, e] = r;
  if (s === '' && e === '') return null;
  let start: number;
  let end: number;
  if (s === '') {
    // suffix range: last N bytes
    const n = Number.parseInt(e!, 10);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number.parseInt(s!, 10);
    end = e === '' ? size - 1 : Math.min(Number.parseInt(e!, 10), size - 1);
    if (e !== '' && Number.parseInt(e!, 10) < start) return null; // invalid → ignore per RFC 9110
  }
  if (start >= size || size === 0) return 'unsatisfiable';
  return { start, end };
}

export interface SendFileOptions {
  contentType: string;
  cacheControl?: string;
}

/** Stream a file with full Range support (206 / 416, Accept-Ranges, ETag, Last-Modified, HEAD). */
export async function sendFile(
  request: FastifyRequest,
  reply: FastifyReply,
  filePath: string,
  opts: SendFileOptions,
): Promise<FastifyReply> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(filePath);
    if (!st.isFile()) throw new Error('not a file');
  } catch {
    throw notFound('File not found on disk');
  }
  const size = st.size;
  const etag = `"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', opts.contentType);
  reply.header('Last-Modified', st.mtime.toUTCString());
  reply.header('ETag', etag);
  reply.header('Cache-Control', opts.cacheControl ?? 'private, max-age=0, must-revalidate');

  if (request.headers['if-none-match'] === etag && !request.headers.range) {
    return reply.code(304).send();
  }

  // If-Range: only honour Range when the validator still matches.
  let rangeHeader = request.headers.range;
  const ifRange = request.headers['if-range'];
  if (rangeHeader && typeof ifRange === 'string' && ifRange !== etag && ifRange !== st.mtime.toUTCString()) {
    rangeHeader = undefined;
  }

  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    reply.header('Content-Range', `bytes */${size}`);
    return reply.code(416).type('application/json').send({ error: 'Range not satisfiable' });
  }

  // For HEAD, Fastify's auto HEAD route drains a stream payload but keeps our Content-Length;
  // an empty stream avoids reading the file at all.
  const isHead = request.method === 'HEAD';
  const empty = () => Readable.from([]);
  if (range) {
    const length = range.end - range.start + 1;
    reply.code(206);
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    reply.header('Content-Length', length);
    if (isHead) return reply.send(empty());
    return reply.send(fs.createReadStream(filePath, { start: range.start, end: range.end }));
  }

  reply.code(200);
  reply.header('Content-Length', size);
  if (isHead) return reply.send(empty());
  return reply.send(fs.createReadStream(filePath));
}
