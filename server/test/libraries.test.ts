import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsBrowser } from '../src/browse.js';
import { openDb } from '../src/db.js';
import { LibraryStore, libraryIdForPath } from '../src/libraries.js';
import type { MediaItem } from '../src/media.js';
import { type TestServer, login, startServer, tempDir } from './helpers.js';

interface Lib {
  id: string;
  name: string;
  path: string;
  itemCount: number;
}
interface Browse {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string; mediaCount: number }[];
  mediaFiles: number;
  truncated: boolean;
}

describe('library seeding', () => {
  it('seeds once from MEDIA_DIRS with path-derived ids', () => {
    const dataDir = tempDir('seed');
    try {
      const db = openDb(dataDir);
      const store = new LibraryStore(db, new FsBrowser([]));
      expect(store.seed(['/media', '/srv/Films'])).toBe(2);
      expect(store.list().map(({ id, name, path: p }) => ({ id, name, path: p }))).toEqual([
        { id: libraryIdForPath('/media'), name: 'Media', path: '/media' },
        { id: libraryIdForPath('/srv/Films'), name: 'Films', path: '/srv/Films' },
      ]);
      // Never again, even after every library was removed.
      for (const l of store.list()) store.delete(l.id);
      expect(store.seed(['/media'])).toBe(0);
      expect(store.list()).toEqual([]);
      db.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('folder browser and library management', () => {
  let srv: TestServer;
  let admin: Record<string, string>;
  let userAuth: Record<string, string>;
  let base: string;
  let mediaDir: string;
  let host: string;
  let outside: string;

  const get = async <T>(url: string, headers = admin) => {
    const r = await srv.app.inject({ url, headers });
    return { status: r.statusCode, body: r.json() as T };
  };
  const send = async <T>(method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers = admin) => {
    const r = await srv.app.inject({ method, url, headers, payload: payload as Record<string, unknown> | undefined });
    return { status: r.statusCode, body: r.json() as T };
  };
  const browse = (p: string, headers = admin) => get<Browse>(`/api/fs/browse?path=${encodeURIComponent(p)}`, headers);
  const libs = async () => (await get<Lib[]>('/api/libraries')).body;
  const allMedia = async () => (await get<{ items: MediaItem[] }>('/api/media?limit=500')).body.items;

  beforeAll(async () => {
    base = fs.realpathSync(tempDir('libs'));
    mediaDir = path.join(base, 'seed-media');
    host = path.join(base, 'host');
    outside = path.join(base, 'outside');
    for (const d of [
      mediaDir,
      path.join(host, 'Movies', 'Extras'),
      path.join(host, 'music'),
      path.join(host, '.hidden'),
      path.join(host, 'Zed'),
      outside,
    ]) {
      fs.mkdirSync(d, { recursive: true });
    }
    fs.writeFileSync(path.join(mediaDir, 'Seed Clip.mp4'), 'x');
    fs.writeFileSync(path.join(host, 'Movies', 'Big Movie (2020).mp4'), 'x');
    fs.writeFileSync(path.join(host, 'Movies', 'readme.txt'), 'x');
    fs.writeFileSync(path.join(host, 'Movies', 'Extras', 'Trailer.mkv'), 'x');
    fs.writeFileSync(path.join(host, 'music', 'Song.mp3'), 'x');
    fs.writeFileSync(path.join(host, 'music', 'Other.flac'), 'x');
    fs.writeFileSync(path.join(host, 'top.jpg'), 'x');
    fs.writeFileSync(path.join(outside, 'secret.mp4'), 'x');
    fs.symlinkSync(outside, path.join(host, 'escape'));
    fs.symlinkSync(path.join(host, 'music'), path.join(host, 'Music Link'));

    srv = await startServer(mediaDir, {
      BROWSE_ROOTS: `${host},${path.join(base, 'missing-root')}`,
      FFMPEG_PATH: '/nonexistent/ffmpeg',
      FFPROBE_PATH: '/nonexistent/ffprobe',
    });
    await srv.ctx.scanner.scan();
    admin = { authorization: `Bearer ${await login(srv.app)}` };
    srv.ctx.auth.createUser('kid', 'kidpass', false);
    userAuth = { authorization: `Bearer ${await login(srv.app, 'kid', 'kidpass')}` };
  });

  afterAll(async () => {
    await srv.cleanup();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('seeds the libraries table from MEDIA_DIRS on first start', async () => {
    const list = await libs();
    expect(list).toEqual([
      { id: libraryIdForPath(mediaDir), name: 'seed-media', path: mediaDir, itemCount: 1 },
    ]);
  });

  it('lists only existing browse roots', async () => {
    const r = await get<{ roots: { name: string; path: string }[] }>('/api/fs/roots');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ roots: [{ name: 'host', path: host }] });
  });

  it('browses folders inside a root', async () => {
    const r = await browse(host);
    expect(r.status).toBe(200);
    expect(r.body.path).toBe(host);
    expect(r.body.parent).toBeNull();
    expect(r.body.mediaFiles).toBe(1);
    expect(r.body.truncated).toBe(false);
    // Sorted case-insensitively; hidden dirs and symlinks escaping the root are not offered.
    expect(r.body.dirs).toEqual([
      { name: 'Movies', path: path.join(host, 'Movies'), mediaCount: 1 },
      { name: 'music', path: path.join(host, 'music'), mediaCount: 2 },
      { name: 'Music Link', path: path.join(host, 'Music Link'), mediaCount: 2 },
      { name: 'Zed', path: path.join(host, 'Zed'), mediaCount: 0 },
    ]);
    const sub = await browse(path.join(host, 'Movies'));
    expect(sub.body.parent).toBe(host);
    expect(sub.body.dirs.map((d) => d.name)).toEqual(['Extras']);
    // A symlink that stays inside the root resolves to its canonical path.
    const link = await browse(path.join(host, 'Music Link'));
    expect(link.status).toBe(200);
    expect(link.body.path).toBe(path.join(host, 'music'));
  });

  it('rejects paths outside the roots with 403', async () => {
    for (const p of [
      outside,
      `${host}/../outside`,
      `${host}/Movies/../../outside`,
      path.join(host, 'escape'),
      path.join(host, 'escape', 'nested'),
      '/etc',
      '/',
    ]) {
      const r = await browse(p);
      expect(r.status, p).toBe(403);
      expect(r.body).toHaveProperty('error');
    }
    expect((await browse('relative/path')).status).toBe(400);
    expect((await get('/api/fs/browse')).status).toBe(400);
    expect((await browse(path.join(host, 'nope'))).status).toBe(404);
    expect((await browse(path.join(host, 'top.jpg'))).status).toBe(400);
  });

  it('is admin-only', async () => {
    const id = (await libs())[0]!.id;
    expect((await get('/api/fs/roots', userAuth)).status).toBe(403);
    expect((await browse(host, userAuth)).status).toBe(403);
    expect((await send('POST', '/api/libraries', { path: path.join(host, 'Zed') }, userAuth)).status).toBe(403);
    expect((await send('PATCH', `/api/libraries/${id}`, { name: 'x' }, userAuth)).status).toBe(403);
    expect((await send('DELETE', `/api/libraries/${id}`, undefined, userAuth)).status).toBe(403);
    expect((await srv.app.inject('/api/fs/roots')).statusCode).toBe(401);
    // Listing libraries stays available to every user.
    expect((await get('/api/libraries', userAuth)).status).toBe(200);
  });

  it('validates new library folders', async () => {
    const add = (body: unknown) => send<{ error: string }>('POST', '/api/libraries', body);
    expect((await add({})).status).toBe(400);
    expect((await add({ path: 'Movies' })).status).toBe(400);
    expect((await add({ path: outside })).status).toBe(403);
    expect((await add({ path: path.join(host, 'escape') })).status).toBe(403);
    const missing = await add({ path: path.join(host, 'missing') });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/does not exist/);
    expect((await add({ path: path.join(host, 'top.jpg') })).status).toBe(400);
    expect((await add({ path: path.join(host, 'Zed'), name: '   ' })).status).toBe(400);
  });

  let moviesId: string;

  it('adds a library and indexes it in the background', async () => {
    const r = await send<Lib>('POST', '/api/libraries', { path: path.join(host, 'Movies') });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Movies', path: path.join(host, 'Movies') });
    expect(r.body.id).toBe(libraryIdForPath(path.join(host, 'Movies')));
    moviesId = r.body.id;
    await srv.ctx.scanner.scan();
    const list = await libs();
    expect(list.map((l) => l.name)).toEqual(['seed-media', 'Movies']);
    expect(list[1]!.itemCount).toBe(2);
    const items = (await allMedia()).filter((m) => m.libraryId === moviesId);
    expect(items.map((m) => m.fileName).sort()).toEqual(['Big Movie (2020).mp4', 'Trailer.mkv']);
  });

  it('rejects duplicate and nested libraries', async () => {
    const add = (p: string) => send<{ error: string }>('POST', '/api/libraries', { path: p });
    const dup = await add(path.join(host, 'Movies'));
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/already/);
    const inner = await add(path.join(host, 'Movies', 'Extras'));
    expect(inner.status).toBe(400);
    expect(inner.body.error).toMatch(/inside the library "Movies"/);
    const outer = await add(host);
    expect(outer.status).toBe(400);
    expect(outer.body.error).toMatch(/contains the library "Movies"/);
    // Same folder reached through a symlink is still a duplicate of "music" once added.
    const music = await send<Lib>('POST', '/api/libraries', { path: path.join(host, 'music'), name: 'Tunes' });
    expect(music.status).toBe(201);
    expect((await add(path.join(host, 'Music Link'))).status).toBe(400);
    expect((await send('DELETE', `/api/libraries/${music.body.id}`)).status).toBe(200);
  });

  it('renames and changes the folder of a library, keeping its id', async () => {
    const before = (await allMedia()).find((m) => m.libraryId === moviesId)!;
    const prog = await srv.app.inject({
      method: 'PUT',
      url: `/api/media/${before.id}/progress`,
      headers: admin,
      payload: { positionSec: 12 },
    });
    expect(prog.statusCode).toBe(200);

    const renamed = await send<Lib>('PATCH', `/api/libraries/${moviesId}`, { name: 'Films' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: moviesId, name: 'Films', itemCount: 2 });

    const nested = await send('PATCH', `/api/libraries/${moviesId}`, { path: mediaDir });
    expect(nested.status).toBe(403); // seed dir is not under BROWSE_ROOTS
    const changed = await send<Lib>('PATCH', `/api/libraries/${moviesId}`, { path: path.join(host, 'music') });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ id: moviesId, name: 'Films', path: path.join(host, 'music'), itemCount: 0 });
    // Progress for removed items is gone with them.
    const n = srv.ctx.db.prepare('SELECT COUNT(*) AS n FROM progress WHERE media_id = ?').get(before.id) as { n: number };
    expect(n.n).toBe(0);

    await srv.ctx.scanner.scan();
    const items = (await allMedia()).filter((m) => m.libraryId === moviesId);
    expect(items.map((m) => m.fileName).sort()).toEqual(['Other.flac', 'Song.mp3']);
    expect((await allMedia()).some((m) => m.fileName === 'Big Movie (2020).mp4')).toBe(false);
    const folders = await get<{ items: MediaItem[] }>(`/api/folders?libraryId=${moviesId}`);
    expect(folders.body.items).toHaveLength(2);
    expect((await send('PATCH', '/api/libraries/0000000000000000', { name: 'x' })).status).toBe(404);
  });

  it('removes a library with its media', async () => {
    const r = await send<{ deleted: boolean }>('DELETE', `/api/libraries/${moviesId}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ deleted: true });
    expect((await libs()).map((l) => l.id)).toEqual([libraryIdForPath(mediaDir)]);
    expect((await allMedia()).map((m) => m.fileName)).toEqual(['Seed Clip.mp4']);
    expect((await send('DELETE', `/api/libraries/${moviesId}`)).status).toBe(404);
    // Re-adding the folder reuses the natural id and indexes again.
    const again = await send<Lib>('POST', '/api/libraries', { path: path.join(host, 'music') });
    expect(again.status).toBe(201);
    await srv.ctx.scanner.scan();
    expect((await libs()).find((l) => l.id === again.body.id)!.itemCount).toBe(2);
  });

  it('a library added while a scan runs gets indexed by a queued pass', async () => {
    const running = srv.ctx.scanner.scan();
    const r = await send<Lib>('POST', '/api/libraries', { path: path.join(host, 'Zed') });
    expect(r.status).toBe(201);
    fs.writeFileSync(path.join(host, 'Zed', 'late.mp3'), 'x');
    await running;
    await srv.ctx.scanner.scan();
    expect((await libs()).find((l) => l.id === r.body.id)!.itemCount).toBe(1);
  });
});

describe('FsBrowser limits', () => {
  it('caps listings at 1000 folders and flags truncation', async () => {
    const root = fs.realpathSync(tempDir('many'));
    try {
      for (let i = 0; i < 1005; i++) fs.mkdirSync(path.join(root, `d${String(i).padStart(4, '0')}`));
      const res = await new FsBrowser([root]).browse(root);
      expect(res.dirs).toHaveLength(1000);
      expect(res.truncated).toBe(true);
      expect(res.dirs[0]!.name).toBe('d0000');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
