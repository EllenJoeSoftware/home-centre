import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaItem } from '../src/media.js';
import { type TestServer, ffmpeg, hasFfmpeg, login, startServer, tempDir } from './helpers.js';

const FF = hasFfmpeg();

describe.skipIf(!FF)('scanner + playback with real media (ffmpeg)', () => {
  let srv: TestServer;
  let token: string;
  let mediaDir: string;
  let items: MediaItem[];

  beforeAll(async () => {
    mediaDir = tempDir('ffmedia');
    fs.mkdirSync(path.join(mediaDir, 'Movies'), { recursive: true });
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=25',
      '-f', 'lavfi', '-i', 'sine=duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      path.join(mediaDir, 'Movies', 'Test Movie (2020).mp4'),
    ]);
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc=duration=9:size=320x240:rate=25',
      '-f', 'lavfi', '-i', 'sine=duration=9',
      '-c:v', 'mpeg4', '-c:a', 'ac3', '-shortest',
      path.join(mediaDir, 'Movies', 'Legacy.Clip.mkv'),
    ]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'libmp3lame', '-metadata', 'artist=Tester',
      '-metadata', 'album=Fixtures', '-metadata', 'date=2021', path.join(mediaDir, 'song.mp3')]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=1024x768', '-frames:v', '1', path.join(mediaDir, 'picture.png')]);
    srv = await startServer(mediaDir);
    await srv.ctx.scanner.scan();
    token = await login(srv.app);
    const res = await srv.app.inject({ url: '/api/media?limit=500', headers: { authorization: `Bearer ${token}` } });
    items = (res.json() as { items: MediaItem[] }).items;
  }, 120_000);

  afterAll(async () => {
    await srv?.cleanup();
    if (mediaDir) fs.rmSync(mediaDir, { recursive: true, force: true });
  });

  const byName = (n: string) => items.find((i) => i.fileName === n)!;

  it('probes metadata', () => {
    expect(items).toHaveLength(4);
    const mp4 = byName('Test Movie (2020).mp4');
    expect(mp4).toMatchObject({
      kind: 'video', title: 'Test Movie', year: 2020, width: 320, height: 240,
      videoCodec: 'h264', audioCodec: 'aac', container: 'mp4', directPlayable: true, hasThumbnail: true,
    });
    expect(mp4.durationSec).toBeGreaterThan(2.5);
    const mkv = byName('Legacy.Clip.mkv');
    expect(mkv).toMatchObject({ container: 'matroska', videoCodec: 'mpeg4', audioCodec: 'ac3', directPlayable: false });
    const mp3 = byName('song.mp3');
    expect(mp3).toMatchObject({ kind: 'audio', artist: 'Tester', album: 'Fixtures', year: 2021, directPlayable: true });
    const png = byName('picture.png');
    expect(png).toMatchObject({ kind: 'image', width: 1024, height: 768, hasThumbnail: true });
  });

  it('serves thumbnails (with resize)', async () => {
    const png = byName('picture.png');
    const t = await srv.app.inject({ url: `/api/media/${png.id}/thumbnail?token=${token}` });
    expect(t.statusCode).toBe(200);
    expect(t.headers['content-type']).toBe('image/jpeg');
    expect(t.rawPayload.subarray(0, 2).toString('hex')).toBe('ffd8');
    const small = await srv.app.inject({ url: `/api/media/${png.id}/thumbnail?w=100&token=${token}` });
    expect(small.statusCode).toBe(200);
    expect(small.rawPayload.length).toBeLessThan(t.rawPayload.length);
    const none = await srv.app.inject({ url: `/api/media/${byName('song.mp3').id}/thumbnail?token=${token}` });
    expect(none.statusCode).toBe(404);
  });

  it('transcodes to HLS and serves segments', async () => {
    const mkv = byName('Legacy.Clip.mkv');
    const pl = await srv.app.inject({ url: `/api/media/${mkv.id}/transcode.m3u8?token=${token}` });
    expect(pl.statusCode).toBe(200);
    expect(pl.headers['content-type']).toContain('mpegurl');
    const uris = pl.body.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(uris.length).toBe(3); // 9s / 4s segments
    expect(uris[0]).toMatch(/^hls\/[0-9a-f]+\/0\.ts\?token=/);
    const seg = await srv.app.inject({ url: `/api/media/${mkv.id}/${uris[0]}` });
    expect(seg.statusCode).toBe(200);
    expect(seg.headers['content-type']).toBe('video/mp2t');
    expect(seg.rawPayload[0]).toBe(0x47); // MPEG-TS sync byte
    // Jump to the last segment (seek path)
    const last = await srv.app.inject({ url: `/api/media/${mkv.id}/${uris[2]}` });
    expect(last.statusCode).toBe(200);
    const noTok = await srv.app.inject({ url: `/api/media/${mkv.id}/${uris[0]!.split('?')[0]}` });
    expect(noTok.statusCode).toBe(401);
  }, 60_000);

  it('auto-completes progress at 95%', async () => {
    const mp4 = byName('Test Movie (2020).mp4');
    const put = await srv.app.inject({
      method: 'PUT',
      url: `/api/media/${mp4.id}/progress`,
      headers: { authorization: `Bearer ${token}` },
      payload: { positionSec: mp4.durationSec! * 0.97 },
    });
    expect(put.json()).toMatchObject({ completed: true });
  });

  it('rescans incrementally', async () => {
    const before = byName('song.mp3');
    await srv.ctx.scanner.scan();
    const res = await srv.app.inject({ url: `/api/media/${before.id}`, headers: { authorization: `Bearer ${token}` } });
    expect((res.json() as MediaItem).addedAt).toBe(before.addedAt);
  });
});
