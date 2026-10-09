import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../auth.js';

export const SERVER_NAME = 'Home Centre';
export const SERVER_VERSION = '1.0.0';

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/server/info', async () => ({ name: SERVER_NAME, version: SERVER_VERSION }));

  app.get('/api/libraries', async () => ctx.scanner.libraries());

  app.post('/api/libraries/scan', async (request, reply) => {
    requireAdmin(request);
    ctx.scanner.scan().catch((err: unknown) => request.log.error({ err }, 'scan failed'));
    return reply.code(202).send({ started: true });
  });

  app.get('/api/scan/status', async () => ({
    running: ctx.scanner.running,
    lastScanAt: ctx.scanner.lastScanAt,
    itemCount: ctx.scanner.itemCount(),
  }));
}
