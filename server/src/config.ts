import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  mediaDirs: string[];
  dataDir: string;
  adminUser: string;
  adminPassword: string;
  /** Explicit secret from env; when undefined one is generated and persisted in the DB (DATA_DIR). */
  jwtSecret: string | undefined;
  scanIntervalMinutes: number;
  ffmpegPath: string;
  ffprobePath: string;
  corsOrigin: string;
  maxTranscodes: number;
  logLevel: string;
}

function intEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mediaDirs = (env.MEDIA_DIRS ?? '/media')
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .map((d) => path.resolve(d));

  return {
    port: intEnv(env.PORT, 8096),
    host: env.HOST ?? '0.0.0.0',
    mediaDirs,
    dataDir: path.resolve(env.DATA_DIR ?? '/data'),
    adminUser: env.ADMIN_USER?.trim() || 'admin',
    adminPassword: env.ADMIN_PASSWORD ?? 'admin',
    jwtSecret: env.JWT_SECRET?.trim() || undefined,
    scanIntervalMinutes: Math.max(0, intEnv(env.SCAN_INTERVAL_MINUTES, 60)),
    ffmpegPath: env.FFMPEG_PATH?.trim() || 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH?.trim() || 'ffprobe',
    corsOrigin: env.CORS_ORIGIN?.trim() || '*',
    maxTranscodes: Math.max(1, intEnv(env.MAX_TRANSCODES, 3)),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  };
}
