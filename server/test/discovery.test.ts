import dgram from 'node:dgram';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { DISCOVERY_PROBE, DiscoveryServer, MAX_REPLIES_PER_SECOND, buildDiscoveryReply } from '../src/discovery.js';
import { type TestServer, startServer, tempDir } from './helpers.js';

const silent = { info: () => {}, warn: () => {}, debug: () => {} };

/** Send `payload` to the discovery port and collect replies for `waitMs`. */
async function probe(port: number, payload: string | Buffer, waitMs = 300, count = 1): Promise<Buffer[]> {
  const client = dgram.createSocket('udp4');
  const replies: Buffer[] = [];
  client.on('message', (msg) => replies.push(msg));
  await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', () => resolve()));
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve, reject) =>
      client.send(payload, port, '127.0.0.1', (err) => (err ? reject(err) : resolve())),
    );
  }
  await new Promise((r) => setTimeout(r, waitMs));
  await new Promise<void>((resolve) => client.close(() => resolve()));
  return replies;
}

describe('LAN discovery (UDP)', () => {
  let srv: TestServer;
  let discovery: DiscoveryServer;
  let port: number;
  let mediaDir: string;

  beforeAll(async () => {
    mediaDir = tempDir('media');
    srv = await startServer(mediaDir, {
      SERVER_NAME: 'Living Room',
      PORT: '8096',
      ADVERTISED_PORT: '18096',
      PUBLIC_URL: 'http://192.168.1.10:18096/',
    });
    discovery = new DiscoveryServer({
      port: 0,
      host: '127.0.0.1',
      reply: () => buildDiscoveryReply(srv.ctx.serverInfo, srv.config),
      log: silent,
    });
    expect(await discovery.start()).toBe(true);
    port = discovery.port!;
    expect(port).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await discovery.close();
    await srv.cleanup();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  });

  it('replies to the probe with server identity JSON', async () => {
    const replies = await probe(port, `${DISCOVERY_PROBE}\r\n`);
    expect(replies).toHaveLength(1);
    expect(JSON.parse(replies[0]!.toString('utf8'))).toEqual({
      product: 'home-centre',
      id: srv.ctx.serverInfo.id,
      name: 'Living Room',
      version: '1.0.0',
      port: 18096,
      url: 'http://192.168.1.10:18096',
    });
  });

  it('ignores other payloads', async () => {
    expect(await probe(port, 'hello')).toHaveLength(0);
    expect(await probe(port, `${DISCOVERY_PROBE}X`)).toHaveLength(0);
    expect(await probe(port, Buffer.from([0, 1, 2, 3]))).toHaveLength(0);
  });

  it('rate limits replies globally', async () => {
    await new Promise((r) => setTimeout(r, 1100)); // fresh rate window
    const replies = await probe(port, DISCOVERY_PROBE, 400, 50);
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.length).toBeLessThanOrEqual(MAX_REPLIES_PER_SECOND);
  });

  it('server/info includes product and id', async () => {
    const info = (await srv.app.inject('/api/server/info')).json() as Record<string, unknown>;
    expect(info).toEqual({ product: 'home-centre', id: srv.ctx.serverInfo.id, name: 'Living Room', version: '1.0.0' });
  });

  it('does not crash when the port is already in use', async () => {
    const blocker = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    await new Promise<void>((resolve) => blocker.bind(0, '127.0.0.1', () => resolve()));
    const warnings: unknown[] = [];
    const other = new DiscoveryServer({
      port: blocker.address().port,
      host: '127.0.0.1',
      reply: () => buildDiscoveryReply(srv.ctx.serverInfo, srv.config),
      log: { ...silent, warn: (...args: unknown[]) => void warnings.push(args) },
    });
    expect(await other.start()).toBe(false);
    expect(warnings).toHaveLength(1);
    await other.close();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });
});

describe('server identity', () => {
  it('keeps the same id across restarts with the same DATA_DIR', async () => {
    const dataDir = tempDir('data');
    const mediaDir = tempDir('media');
    const env = { DATA_DIR: dataDir, MEDIA_DIRS: mediaDir, ADMIN_PASSWORD: 'x' };
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { app } = await buildApp(loadConfig(env), { logger: false });
      const info = (await app.inject('/api/server/info')).json() as { product: string; id: string };
      expect(info.product).toBe('home-centre');
      ids.push(info.id);
      await app.close();
    }
    expect(ids[0]).toBe(ids[1]);

    const otherData = tempDir('data');
    const { app } = await buildApp(loadConfig({ ...env, DATA_DIR: otherData }), { logger: false });
    expect(((await app.inject('/api/server/info')).json() as { id: string }).id).not.toBe(ids[0]);
    await app.close();
    for (const d of [dataDir, mediaDir, otherData]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('reads discovery settings from env', () => {
    expect(loadConfig({})).toMatchObject({
      serverName: 'Home Centre',
      discoveryPort: 7359,
      advertisedPort: 8096,
      publicUrl: null,
    });
    expect(loadConfig({ PORT: '9000', DISCOVERY_PORT: '0' })).toMatchObject({ discoveryPort: 0, advertisedPort: 9000 });
  });
});
