import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { type AppContext, buildApp } from '../src/app.js';
import { type Config, loadConfig } from '../src/config.js';

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

export function hasFfmpeg(): boolean {
  try {
    const r = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' });
    const p = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { stdio: 'ignore' });
    return r.status === 0 && p.status === 0;
  } catch {
    return false;
  }
}

export function ffmpeg(args: string[]): void {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString()}`);
}

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hc-${prefix}-`));
}

export interface TestServer {
  app: FastifyInstance;
  ctx: AppContext;
  config: Config;
  mediaDir: string;
  dataDir: string;
  cleanup(): Promise<void>;
}

export async function startServer(mediaDir: string, env: Record<string, string> = {}): Promise<TestServer> {
  const dataDir = tempDir('data');
  const config = loadConfig({
    MEDIA_DIRS: mediaDir,
    DATA_DIR: dataDir,
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD: 'secret-pass',
    LOG_LEVEL: 'warn',
    ...env,
  });
  const { app, ctx } = await buildApp(config, { logger: false });
  await app.ready();
  return {
    app,
    ctx,
    config,
    mediaDir,
    dataDir,
    async cleanup() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function login(app: FastifyInstance, username = 'admin', password = 'secret-pass'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { token: string }).token;
}
