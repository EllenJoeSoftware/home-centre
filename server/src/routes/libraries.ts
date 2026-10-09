import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../auth.js';
import { notFound } from '../errors.js';
import type { Library } from '../scanner.js';

type Body = { path?: unknown; name?: unknown };

/** Admin folder browser (confined to BROWSE_ROOTS) and library management. */
export function registerLibraryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { scanner, libraries, browser } = ctx;

  const rescan = (request: FastifyRequest) => {
    // Scanner.scan() queues exactly one more pass when a scan is already running.
    scanner.scan().catch((err: unknown) => request.log.error({ err }, 'scan failed'));
  };

  const withCount = (id: string): Library => {
    const lib = scanner.library(id);
    if (!lib) throw notFound('Library not found');
    return lib;
  };

  app.get('/api/fs/roots', async (request) => {
    requireAdmin(request);
    return { roots: await browser.roots() };
  });

  app.get<{ Querystring: { path?: string } }>('/api/fs/browse', async (request) => {
    requireAdmin(request);
    return browser.browse(request.query.path);
  });

  app.post<{ Body: Body }>('/api/libraries', async (request, reply) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as Body;
    const lib = await libraries.create(body);
    request.log.info({ id: lib.id, path: lib.path }, 'library added');
    rescan(request);
    return reply.code(201).send(withCount(lib.id));
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/libraries/:id', async (request) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as Body;
    const { library, pathChanged } = await libraries.update(request.params.id, body);
    if (pathChanged) {
      const removed = scanner.removeLibraryMedia(library.id);
      request.log.info({ id: library.id, path: library.path, removed }, 'library folder changed');
      rescan(request);
    }
    return withCount(library.id);
  });

  app.delete<{ Params: { id: string } }>('/api/libraries/:id', async (request) => {
    requireAdmin(request);
    const id = request.params.id;
    if (!libraries.delete(id)) throw notFound('Library not found');
    const removed = scanner.removeLibraryMedia(id);
    request.log.info({ id, removed }, 'library removed');
    // An in-flight scan may still re-index this library's files; one more pass clears them.
    if (scanner.running) rescan(request);
    return { deleted: true };
  });
}
