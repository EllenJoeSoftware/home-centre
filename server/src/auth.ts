import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { type DB, getSetting, setSetting } from './db.js';
import { HttpError } from './errors.js';

export interface PublicUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: PublicUser | null;
    authToken: string | null;
  }
}

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
// Used to equalise timing when the username does not exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function toPublic(row: UserRow): PublicUser {
  return { id: row.id, username: row.username, isAdmin: row.is_admin === 1 };
}

export class Auth {
  private readonly secret: string;

  constructor(
    private readonly db: DB,
    config: Config,
  ) {
    let secret = config.jwtSecret ?? getSetting(db, 'jwtSecret');
    if (!secret) {
      secret = crypto.randomBytes(48).toString('base64url');
      setSetting(db, 'jwtSecret', secret);
    }
    this.secret = secret;
  }

  /** Create the initial admin when no users exist. Returns true if a user was created. */
  seedAdmin(username: string, password: string): boolean {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    if (n > 0) return false;
    this.createUser(username, password, true);
    return true;
  }

  createUser(username: string, password: string, isAdmin: boolean): PublicUser {
    const hash = bcrypt.hashSync(password, 10);
    const info = this.db
      .prepare('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)')
      .run(username, hash, isAdmin ? 1 : 0, new Date().toISOString());
    return { id: Number(info.lastInsertRowid), username, isAdmin };
  }

  findByUsername(username: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  }

  getUser(id: number): PublicUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toPublic(row) : null;
  }

  listUsers(): (PublicUser & { createdAt: string })[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]).map((r) => ({
      ...toPublic(r),
      createdAt: r.created_at,
    }));
  }

  deleteUser(id: number): boolean {
    return this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
  }

  async verifyCredentials(username: string, password: string): Promise<PublicUser | null> {
    const row = this.findByUsername(username);
    const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
    return row && ok ? toPublic(row) : null;
  }

  sign(user: PublicUser): string {
    return jwt.sign({ sub: String(user.id), username: user.username }, this.secret, {
      expiresIn: TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
    });
  }

  /** Verify a token and load the (still existing) user. */
  verify(token: string): PublicUser | null {
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || !payload.sub) return null;
      const id = Number.parseInt(payload.sub, 10);
      return Number.isFinite(id) ? this.getUser(id) : null;
    } catch {
      return null;
    }
  }
}

const PUBLIC_ROUTES = new Set(['/api/health', '/api/server/info', '/api/auth/login']);

export function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header) {
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (m) return m[1]!.trim();
  }
  const q = request.query as Record<string, unknown> | undefined;
  if (q && typeof q.token === 'string' && q.token.length > 0) return q.token;
  return null;
}

/** onRequest hook: authenticate every /api route except the public ones. */
export function authHook(auth: Auth) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const url = request.url.split('?')[0]!;
    if (!url.startsWith('/api/') || PUBLIC_ROUTES.has(url) || request.method === 'OPTIONS') return;
    const token = extractToken(request);
    if (!token) throw new HttpError(401, 'Authentication required');
    const user = auth.verify(token);
    if (!user) throw new HttpError(401, 'Invalid or expired token');
    request.user = user;
    request.authToken = token;
  };
}

export function requireUser(request: FastifyRequest): PublicUser {
  if (!request.user) throw new HttpError(401, 'Authentication required');
  return request.user;
}

export function requireAdmin(request: FastifyRequest): PublicUser {
  const user = requireUser(request);
  if (!user.isAdmin) throw new HttpError(403, 'Admin privileges required');
  return user;
}
