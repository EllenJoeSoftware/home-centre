import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaItem } from '../src/media.js';
import { type TestServer, login, startServer, tempDir } from './helpers.js';

/** Tests that do not need ffmpeg: files are indexed even when probing fails/is skipped. */
describe('API without ffmpeg', () => {
  let srv: TestServer;
  let token: string;
  const blob = crypto.randomBytes(10_000);
  let mediaDir: string;

  beforeAll(async () => {
    mediaDir = tempDir('media');
    fs.mkdirSync(path.join(mediaDir, 'Music', 'Album'), { recursive: true });
    fs.mkdirSync(path.join(mediaDir, 'TV', 'Show Name', 'Season 1'), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'Music', 'Album', '01 - Track One.mp3'), blob);
    fs.writeFileSync(path.join(mediaDir, 'TV', 'Show Name', 'Season 1', 'Show.Name.S01E02.mkv'), 'x');
    fs.writeFileSync(path.join(mediaDir, 'TV', 'Show Name', 'Season 1', 'Show.Name.S01E01.mkv'), 'x');
    fs.writeFileSync(
      path.join(mediaDir, 'TV', 'Show Name', 'Season 1', 'Show.Name.S01E01.en.srt'),
      '1\n00:00:01,000 --> 00:00:02,000\nHi\n',
    );
    fs.writeFileSync(path.join(mediaDir, 'notes.txt'), 'ignored');
    // Point ffmpeg/ffprobe at a missing binary so this suite never depends on them.
    srv = await startServer(mediaDir, { FFMPEG_PATH: '/nonexistent/ffmpeg', FFPROBE_PATH: '/nonexistent/ffprobe' });
    await srv.ctx.scanner.scan();
  });

  afterAll(async () => {
    await srv.cleanup();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  });

  it('serves public endpoints without auth', async () => {
    expect((await srv.app.inject('/api/health')).json()).toEqual({ status: 'ok' });
    expect((await srv.app.inject('/api/server/info')).json()).toEqual({ name: 'Home Centre', version: '1.0.0' });
  });

  it('rejects unauthenticated and bad credentials', async () => {
    const r1 = await srv.app.inject('/api/me');
    expect(r1.statusCode).toBe(401);
    expect(r1.json()).toHaveProperty('error');
    const r2 = await srv.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'nope' },
    });
    expect(r2.statusCode).toBe(401);
    const r3 = await srv.app.inject({ url: '/api/me', headers: { authorization: 'Bearer garbage' } });
    expect(r3.statusCode).toBe(401);
  });

  it('logs in and returns the user', async () => {
    const res = await srv.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'secret-pass' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; user: unknown };
    expect(body.user).toEqual({ id: 1, username: 'admin', isAdmin: true });
    token = body.token;
    const me = await srv.app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toEqual({ id: 1, username: 'admin', isAdmin: true });
    // ?token= also accepted
    const me2 = await srv.app.inject({ url: `/api/me?token=${token}` });
    expect(me2.statusCode).toBe(200);
  });

  it('manages users (admin only)', async () => {
    const auth = { authorization: `Bearer ${token}` };
    const created = await srv.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth,
      payload: { username: 'bob', password: 'bobpass', isAdmin: false },
    });
    expect(created.statusCode).toBe(201);
    const bob = created.json() as { id: number };
    const dup = await srv.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth,
      payload: { username: 'bob', password: 'bobpass' },
    });
    expect(dup.statusCode).toBe(409);
    const bobToken = await login(srv.app, 'bob', 'bobpass');
    const forbidden = await srv.app.inject({ url: '/api/users', headers: { authorization: `Bearer ${bobToken}` } });
    expect(forbidden.statusCode).toBe(403);
    const scan = await srv.app.inject({
      method: 'POST',
      url: '/api/libraries/scan',
      headers: { authorization: `Bearer ${bobToken}` },
    });
    expect(scan.statusCode).toBe(403);
    const list = await srv.app.inject({ url: '/api/users', headers: auth });
    expect((list.json() as unknown[]).length).toBe(2);
    const del = await srv.app.inject({ method: 'DELETE', url: `/api/users/${bob.id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    // Token of a deleted user no longer works.
    const after = await srv.app.inject({ url: '/api/me', headers: { authorization: `Bearer ${bobToken}` } });
    expect(after.statusCode).toBe(401);
  });

  it('lists libraries, media, folders and series', async () => {
    const auth = { authorization: `Bearer ${token}` };
    const libs = (await srv.app.inject({ url: '/api/libraries', headers: auth })).json() as { id: string; itemCount: number }[];
    expect(libs).toHaveLength(1);
    expect(libs[0]!.itemCount).toBe(3);

    const page = (await srv.app.inject({ url: '/api/media?sort=title', headers: auth })).json() as {
      items: MediaItem[];
      total: number;
      limit: number;
    };
    expect(page.total).toBe(3);
    expect(page.limit).toBe(50);
    const ep1 = page.items.find((i) => i.fileName === 'Show.Name.S01E01.mkv')!;
    expect(ep1.series).toEqual({ name: 'Show Name', season: 1, episode: 1 });
    expect(ep1.folder).toBe('TV/Show Name/Season 1');
    expect(ep1.id).toMatch(/^[0-9a-f]{16}$/);
    expect(ep1.subtitles).toHaveLength(1);
    expect(ep1.subtitles[0]).toMatchObject({ language: 'en', format: 'srt' });

    const audio = (await srv.app.inject({ url: '/api/media?kind=audio&q=track', headers: auth })).json() as {
      items: MediaItem[];
    };
    expect(audio.items).toHaveLength(1);
    expect(audio.items[0]!.title).toBe('Track One');
    expect(audio.items[0]!.directPlayable).toBe(true);

    const root = (
      await srv.app.inject({ url: `/api/folders?libraryId=${libs[0]!.id}`, headers: auth })
    ).json() as { path: string; folders: { name: string; path: string }[]; items: MediaItem[] };
    expect(root.path).toBe('');
    expect(root.folders).toEqual([
      { name: 'Music', path: 'Music' },
      { name: 'TV', path: 'TV' },
    ]);
    const album = (
      await srv.app.inject({ url: `/api/folders?libraryId=${libs[0]!.id}&path=Music/Album`, headers: auth })
    ).json() as { items: MediaItem[] };
    expect(album.items).toHaveLength(1);

    const series = (await srv.app.inject({ url: '/api/series', headers: auth })).json();
    expect(series).toEqual([{ name: 'Show Name', episodeCount: 2, seasons: [1], thumbnailItemId: null }]);
    const eps = (
      await srv.app.inject({ url: `/api/series/${encodeURIComponent('Show Name')}/episodes`, headers: auth })
    ).json() as MediaItem[];
    expect(eps.map((e) => e.series!.episode)).toEqual([1, 2]);

    const sub = await srv.app.inject({ url: `/api/media/${ep1.id}/subtitles/${ep1.subtitles[0]!.id}?token=${token}` });
    expect(sub.statusCode).toBe(200);
    expect(sub.headers['content-type']).toContain('text/vtt');
    expect(sub.body).toContain('WEBVTT');
    expect(sub.body).toContain('00:00:01.000 --> 00:00:02.000');
  });

  it('streams with Range support', async () => {
    const page = (
      await srv.app.inject({ url: '/api/media?kind=audio', headers: { authorization: `Bearer ${token}` } })
    ).json() as { items: MediaItem[] };
    const id = page.items[0]!.id;

    const full = await srv.app.inject({ url: `/api/media/${id}/stream?token=${token}` });
    expect(full.statusCode).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['content-type']).toBe('audio/mpeg');
    expect(full.rawPayload.equals(blob)).toBe(true);

    const part = await srv.app.inject({ url: `/api/media/${id}/stream?token=${token}`, headers: { range: 'bytes=100-199' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 100-199/${blob.length}`);
    expect(part.headers['content-length']).toBe('100');
    expect(part.rawPayload.equals(blob.subarray(100, 200))).toBe(true);

    const open = await srv.app.inject({ url: `/api/media/${id}/stream?token=${token}`, headers: { range: 'bytes=9990-' } });
    expect(open.statusCode).toBe(206);
    expect(open.rawPayload.length).toBe(10);

    const suffix = await srv.app.inject({ url: `/api/media/${id}/stream?token=${token}`, headers: { range: 'bytes=-5' } });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload.equals(blob.subarray(blob.length - 5))).toBe(true);

    const bad = await srv.app.inject({ url: `/api/media/${id}/stream?token=${token}`, headers: { range: 'bytes=20000-' } });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${blob.length}`);

    const head = await srv.app.inject({ method: 'HEAD', url: `/api/media/${id}/stream?token=${token}` });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe(String(blob.length));
    expect(head.headers['accept-ranges']).toBe('bytes');
    expect(head.rawPayload.length).toBe(0);

    const noAuth = await srv.app.inject({ url: `/api/media/${id}/stream` });
    expect(noAuth.statusCode).toBe(401);
  });

  it('tracks progress and continue-watching', async () => {
    const auth = { authorization: `Bearer ${token}` };
    const page = (await srv.app.inject({ url: '/api/media?kind=video', headers: auth })).json() as { items: MediaItem[] };
    const id = page.items[0]!.id;
    const empty = await srv.app.inject({ url: `/api/media/${id}/progress`, headers: auth });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toBeNull();
    const put = await srv.app.inject({
      method: 'PUT',
      url: `/api/media/${id}/progress`,
      headers: auth,
      payload: { positionSec: 42.5 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ positionSec: 42.5, completed: false });
    const got = (await srv.app.inject({ url: `/api/media/${id}/progress`, headers: auth })).json();
    expect(got).toMatchObject({ positionSec: 42.5, completed: false });
    const cont = (await srv.app.inject({ url: '/api/media/continue', headers: auth })).json() as MediaItem[];
    expect(cont.map((c) => c.id)).toEqual([id]);
    expect(cont[0]!.progress).toMatchObject({ positionSec: 42.5 });
    const bad = await srv.app.inject({
      method: 'PUT',
      url: `/api/media/${id}/progress`,
      headers: auth,
      payload: { positionSec: 'x' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('removes deleted files on rescan', async () => {
    fs.rmSync(path.join(mediaDir, 'TV', 'Show Name', 'Season 1', 'Show.Name.S01E02.mkv'));
    await srv.ctx.scanner.scan();
    const status = (
      await srv.app.inject({ url: '/api/scan/status', headers: { authorization: `Bearer ${token}` } })
    ).json() as { itemCount: number; running: boolean; lastScanAt: string };
    expect(status.itemCount).toBe(2);
    expect(status.running).toBe(false);
    expect(typeof status.lastScanAt).toBe('string');
  });

  it('returns JSON 404s', async () => {
    const r = await srv.app.inject({ url: '/api/media/0000000000000000', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toHaveProperty('error');
  });
});
