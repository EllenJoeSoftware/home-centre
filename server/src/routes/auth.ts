import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../auth.js';
import { HttpError, badRequest } from '../errors.js';

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { auth } = ctx;

  app.post('/api/auth/login', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const username = str(body.username)?.trim();
    const password = str(body.password);
    if (!username || password === null) throw badRequest('username and password are required');
    const user = await auth.verifyCredentials(username, password);
    if (!user) throw new HttpError(401, 'Invalid username or password');
    return { token: auth.sign(user), user };
  });

  app.get('/api/me', async (request) => requireUser(request));

  app.get('/api/users', async (request) => {
    requireAdmin(request);
    return auth.listUsers();
  });

  app.post('/api/users', async (request, reply) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const username = str(body.username)?.trim();
    const password = str(body.password);
    if (!username || !/^[\w.@-]{1,64}$/.test(username)) {
      throw badRequest('username is required (1-64 chars: letters, digits, _ . @ -)');
    }
    if (!password || password.length < 4) throw badRequest('password must be at least 4 characters');
    if (auth.findByUsername(username)) throw new HttpError(409, 'Username already exists');
    const user = auth.createUser(username, password, body.isAdmin === true);
    return reply.code(201).send(user);
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (request) => {
    const me = requireAdmin(request);
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) throw badRequest('invalid user id');
    if (id === me.id) throw badRequest('you cannot delete your own account');
    if (!auth.deleteUser(id)) throw new HttpError(404, 'User not found');
    return { deleted: true };
  });
}
