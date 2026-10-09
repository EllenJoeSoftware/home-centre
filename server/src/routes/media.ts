import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app.js';
import { requireUser } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { type MediaItem, type MediaRowWithProgress, type Progress, rowToItem } from '../media.js';

const SELECT_WITH_PROGRESS = `
  SELECT m.*, p.position_sec AS p_position, p.completed AS p_completed, p.updated_at AS p_updated
  FROM media m
  LEFT JOIN progress p ON p.media_id = m.id AND p.user_id = @userId`;

const SORTS: Record<string, string> = {
  title: 'm.title COLLATE NOCASE',
  added: 'm.added_at',
  modified: 'm.modified_at',
  size: 'm.size',
  duration: 'm.duration_sec',
};

type Query = Record<string, string | undefined>;

function intParam(v: string | undefined, def: number, min: number, max: number): number {
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw badRequest(`invalid number: ${v}`);
  return Math.min(max, Math.max(min, n));
}

/** Normalise a folder path: forward slashes, no leading/trailing slash, no "." / "..". */
export function normaliseFolder(p: string | undefined): string {
  if (!p) return '';
  const parts = p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.');
  if (parts.includes('..')) throw badRequest('invalid path');
  return parts.join('/');
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  const getItem = (id: string, userId: number): MediaItem | null => {
    const row = db.prepare(`${SELECT_WITH_PROGRESS} WHERE m.id = @id`).get({ id, userId }) as
      | MediaRowWithProgress
      | undefined;
    return row ? rowToItem(row) : null;
  };

  app.get('/api/media', async (request: FastifyRequest<{ Querystring: Query }>) => {
    const user = requireUser(request);
    const q = request.query;
    const where: string[] = [];
    const params: Record<string, unknown> = { userId: user.id };
    if (q.kind) {
      if (!['video', 'audio', 'image'].includes(q.kind)) throw badRequest('kind must be video, audio or image');
      where.push('m.kind = @kind');
      params.kind = q.kind;
    }
    if (q.libraryId) {
      where.push('m.library_id = @libraryId');
      params.libraryId = q.libraryId;
    }
    if (q.folder !== undefined) {
      where.push('m.folder = @folder');
      params.folder = normaliseFolder(q.folder);
    }
    if (q.q && q.q.trim()) {
      where.push(
        `(m.title LIKE @q ESCAPE '\\' OR m.file_name LIKE @q ESCAPE '\\' OR m.artist LIKE @q ESCAPE '\\' OR m.album LIKE @q ESCAPE '\\' OR m.series_name LIKE @q ESCAPE '\\')`,
      );
      params.q = `%${escapeLike(q.q.trim())}%`;
    }
    const sortKey = q.sort ?? 'title';
    const sortCol = SORTS[sortKey];
    if (!sortCol) throw badRequest('sort must be one of title, added, modified, size, duration');
    const order = (q.order ?? 'asc').toLowerCase();
    if (order !== 'asc' && order !== 'desc') throw badRequest('order must be asc or desc');
    const offset = intParam(q.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(q.limit, 50, 1, 500);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM media m ${whereSql}`).get(params) as { n: number }).n;
    const nulls = sortKey === 'duration' ? `m.duration_sec IS NULL, ` : '';
    const rows = db
      .prepare(
        `${SELECT_WITH_PROGRESS} ${whereSql} ORDER BY ${nulls}${sortCol} ${order.toUpperCase()}, m.relative_path COLLATE NOCASE ASC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as MediaRowWithProgress[];
    return { items: rows.map(rowToItem), total, offset, limit };
  });

  app.get('/api/media/recent', async (request: FastifyRequest<{ Querystring: Query }>) => {
    const user = requireUser(request);
    const limit = intParam(request.query.limit, 20, 1, 500);
    const rows = db
      .prepare(`${SELECT_WITH_PROGRESS} ORDER BY m.added_at DESC, m.title COLLATE NOCASE ASC LIMIT @limit`)
      .all({ userId: user.id, limit }) as MediaRowWithProgress[];
    return rows.map(rowToItem);
  });

  app.get('/api/media/continue', async (request: FastifyRequest<{ Querystring: Query }>) => {
    const user = requireUser(request);
    const limit = intParam(request.query.limit, 50, 1, 500);
    const rows = db
      .prepare(
        `SELECT m.*, p.position_sec AS p_position, p.completed AS p_completed, p.updated_at AS p_updated
         FROM progress p JOIN media m ON m.id = p.media_id
         WHERE p.user_id = @userId AND p.position_sec > 0 AND p.completed = 0
         ORDER BY p.updated_at DESC LIMIT @limit`,
      )
      .all({ userId: user.id, limit }) as MediaRowWithProgress[];
    return rows.map(rowToItem);
  });

  app.get<{ Params: { id: string } }>('/api/media/:id', async (request) => {
    const user = requireUser(request);
    const item = getItem(request.params.id, user.id);
    if (!item) throw notFound('Media not found');
    return item;
  });

  app.get('/api/folders', async (request: FastifyRequest<{ Querystring: Query }>) => {
    const user = requireUser(request);
    const libraryId = request.query.libraryId;
    if (!libraryId) throw badRequest('libraryId is required');
    if (!ctx.scanner.libraries().some((l) => l.id === libraryId)) throw notFound('Library not found');
    const folder = normaliseFolder(request.query.path);

    const prefix = folder === '' ? '' : `${folder}/`;
    const folderRows = db
      .prepare(
        `SELECT DISTINCT folder FROM media WHERE library_id = @libraryId AND folder != @folder
         AND (@prefix = '' OR substr(folder, 1, length(@prefix)) = @prefix)`,
      )
      .all({ libraryId, folder, prefix }) as { folder: string }[];
    const names = new Set<string>();
    for (const { folder: f } of folderRows) {
      const rest = f.slice(prefix.length);
      const name = rest.split('/')[0];
      if (name) names.add(name);
    }
    const folders = [...names]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map((name) => ({ name, path: prefix + name }));

    const items = (
      db
        .prepare(
          `${SELECT_WITH_PROGRESS} WHERE m.library_id = @libraryId AND m.folder = @folder
           ORDER BY m.season, m.episode, m.title COLLATE NOCASE, m.file_name COLLATE NOCASE`,
        )
        .all({ userId: user.id, libraryId, folder }) as MediaRowWithProgress[]
    ).map(rowToItem);
    return { path: folder, folders, items };
  });

  app.get('/api/series', async () => {
    const rows = db
      .prepare(
        `SELECT series_name AS name, COUNT(*) AS episodeCount, GROUP_CONCAT(DISTINCT season) AS seasons
         FROM media WHERE series_name IS NOT NULL GROUP BY series_name ORDER BY series_name COLLATE NOCASE`,
      )
      .all() as { name: string; episodeCount: number; seasons: string | null }[];
    const thumbStmt = db.prepare(
      `SELECT id FROM media WHERE series_name = ? AND has_thumbnail = 1 ORDER BY season, episode LIMIT 1`,
    );
    return rows.map((r) => {
      const thumb = thumbStmt.get(r.name) as { id: string } | undefined;
      const seasons = (r.seasons ?? '')
        .split(',')
        .filter((s) => s !== '')
        .map((s) => Number.parseInt(s, 10))
        .sort((a, b) => a - b);
      return { name: r.name, episodeCount: r.episodeCount, seasons, thumbnailItemId: thumb?.id ?? null };
    });
  });

  app.get<{ Params: { name: string } }>('/api/series/:name/episodes', async (request) => {
    const user = requireUser(request);
    const rows = db
      .prepare(
        `${SELECT_WITH_PROGRESS} WHERE m.series_name = @name ORDER BY m.season, m.episode, m.title COLLATE NOCASE`,
      )
      .all({ userId: user.id, name: request.params.name }) as MediaRowWithProgress[];
    if (rows.length === 0) throw notFound('Series not found');
    return rows.map(rowToItem);
  });

  const getProgress = (userId: number, mediaId: string): Progress | null => {
    const row = db
      .prepare('SELECT position_sec, completed, updated_at FROM progress WHERE user_id = ? AND media_id = ?')
      .get(userId, mediaId) as { position_sec: number; completed: number; updated_at: string } | undefined;
    return row ? { positionSec: row.position_sec, completed: row.completed === 1, updatedAt: row.updated_at } : null;
  };

  app.get<{ Params: { id: string } }>('/api/media/:id/progress', async (request, reply) => {
    const user = requireUser(request);
    const exists = db.prepare('SELECT 1 FROM media WHERE id = ?').get(request.params.id);
    if (!exists) throw notFound('Media not found');
    const p = getProgress(user.id, request.params.id);
    // Explicitly serialise `null` as a JSON body.
    return reply.type('application/json').send(JSON.stringify(p));
  });

  app.put<{ Params: { id: string } }>('/api/media/:id/progress', async (request) => {
    const user = requireUser(request);
    const media = db.prepare('SELECT duration_sec FROM media WHERE id = ?').get(request.params.id) as
      | { duration_sec: number | null }
      | undefined;
    if (!media) throw notFound('Media not found');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const pos = body.positionSec;
    if (typeof pos !== 'number' || !Number.isFinite(pos) || pos < 0) {
      throw badRequest('positionSec must be a non-negative number');
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
      throw badRequest('completed must be a boolean');
    }
    const duration = media.duration_sec;
    const positionSec = duration ? Math.min(pos, duration) : pos;
    const auto = duration !== null && duration > 0 && positionSec >= duration * 0.95;
    const completed = body.completed === true || auto;
    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO progress (user_id, media_id, position_sec, completed, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, media_id) DO UPDATE SET position_sec = excluded.position_sec,
         completed = excluded.completed, updated_at = excluded.updated_at`,
    ).run(user.id, request.params.id, positionSec, completed ? 1 : 0, updatedAt);
    return { positionSec, completed, updatedAt } satisfies Progress;
  });
}
