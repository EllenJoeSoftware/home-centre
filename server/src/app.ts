import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { Auth, authHook } from './auth.js';
import { FsBrowser } from './browse.js';
import type { Config } from './config.js';
import { type DB, openDb } from './db.js';
import { HttpError } from './errors.js';
import { LibraryStore } from './libraries.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerLibraryRoutes } from './routes/libraries.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerPlaybackRoutes } from './routes/playback.js';
import { registerSystemRoutes } from './routes/system.js';
import { Scanner } from './scanner.js';
import { TranscodeManager } from './transcode.js';

export interface AppContext {
  config: Config;
  db: DB;
  auth: Auth;
  scanner: Scanner;
  libraries: LibraryStore;
  browser: FsBrowser;
  transcoder: TranscodeManager;
}

export interface BuildOptions {
  logger?: boolean;
}

function redactUrl(url: string): string {
  return url.replace(/([?&]token=)[^&]*/gi, '$1[redacted]');
}

export async function buildApp(config: Config, opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            serializers: {
              req(req) {
                return { method: req.method, url: redactUrl(req.url), remoteAddress: req.ip };
              },
            },
          },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const db = openDb(config.dataDir);
  const auth = new Auth(db, config);
  if (auth.seedAdmin(config.adminUser, config.adminPassword)) {
    app.log.info({ username: config.adminUser }, 'created initial admin user');
  }
  if (config.adminPassword === 'admin') {
    app.log.warn('ADMIN_PASSWORD is the default "admin" — set ADMIN_PASSWORD (only used when seeding the first user)');
  }
  const browser = new FsBrowser(config.browseRoots);
  const libraries = new LibraryStore(db, browser);
  const seeded = libraries.seed(config.mediaDirs);
  if (seeded > 0) app.log.info({ mediaDirs: config.mediaDirs }, 'seeded libraries from MEDIA_DIRS');
  const scanner = new Scanner(db, config, app.log);
  const transcoder = new TranscodeManager(config, app.log);
  const ctx: AppContext = { config, db, auth, scanner, libraries, browser, transcoder };

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? '*' : config.corsOrigin.split(',').map((o) => o.trim()),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Range', 'If-Range', 'If-None-Match'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'ETag'],
    maxAge: 86400,
  });

  app.decorateRequest('user', null);
  app.decorateRequest('authToken', null);
  app.addHook('onRequest', authHook(auth));

  app.setErrorHandler((err: FastifyError | HttpError, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) request.log.error({ err }, 'request failed');
    const message = status >= 500 && !(err instanceof HttpError) ? 'Internal server error' : err.message;
    if (!reply.sent) void reply.code(status).type('application/json').send({ error: message });
  });
  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({ error: `Route ${request.method} ${request.url.split('?')[0]} not found` });
  });

  registerSystemRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerMediaRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerPlaybackRoutes(app, ctx);

  app.addHook('onClose', async () => {
    scanner.stop();
    await scanner.idle(5000);
    transcoder.close();
    db.close();
  });

  return { app, ctx };
}
