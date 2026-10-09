import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  /** Only used to seed the `libraries` table on first run; the DB is the source of truth afterwards. */
  mediaDirs: string[];
  /** Directory trees the admin folder browser may show and libraries may point into. */
  browseRoots: string[];
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
  /** Display name in /api/server/info and LAN discovery replies. */
  serverName: string;
  /** UDP port for LAN discovery; 0 disables it. */
  discoveryPort: number;
  /** HTTP port as reachable from the LAN (differs from `port` when Docker maps it). */
  advertisedPort: number;
  /** Optional full base URL advertised to clients, e.g. http://192.168.1.10:8096. */
  publicUrl: string | null;
}

function pathList(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .map((d) => path.resolve(d));
}

function intEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mediaDirs = pathList(env.MEDIA_DIRS, '/media');
  const browseRoots = [...new Set(pathList(env.BROWSE_ROOTS, '/media,/host'))];

  const port = intEnv(env.PORT, 8096);
  const discoveryPort = intEnv(env.DISCOVERY_PORT, 7359);

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    mediaDirs,
    browseRoots,
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
    serverName: env.SERVER_NAME?.trim() || 'Home Centre',
    discoveryPort: discoveryPort >= 0 && discoveryPort <= 65535 ? discoveryPort : 7359,
    advertisedPort: intEnv(env.ADVERTISED_PORT, port),
    publicUrl: env.PUBLIC_URL?.trim().replace(/\/+$/, '') || null,
  };
}
