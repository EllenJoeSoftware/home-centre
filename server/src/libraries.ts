import fs from 'node:fs';
import path from 'node:path';
import { type FsBrowser, folderDisplayName, isWithin } from './browse.js';
import { type DB, getSetting, setSetting } from './db.js';
import { HttpError, badRequest, notFound } from './errors.js';
import { idForPath } from './media.js';

export interface LibraryRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

interface LibraryRow {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

const toRecord = (r: LibraryRow): LibraryRecord => ({ id: r.id, name: r.name, path: r.path, createdAt: r.created_at });

/** Library ids are the sha1-16 of the root path (same scheme as media ids), kept stable across path changes. */
export function libraryIdForPath(root: string): string {
  return idForPath(root);
}

const MAX_NAME = 100;

function parseName(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw badRequest('name must be a string');
  const name = v.trim();
  if (!name) throw badRequest('name must not be empty');
  if (name.length > MAX_NAME) throw badRequest(`name must be at most ${MAX_NAME} characters`);
  return name;
}

async function realOrSelf(p: string): Promise<string> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return p;
  }
}

/** "dev:ino" of a directory, or null when it cannot be stat'ed (or the FS reports no inode numbers). */
async function dirIdentity(p: string): Promise<string | null> {
  try {
    const st = await fs.promises.stat(p);
    return st.ino ? `${st.dev}:${st.ino}` : null;
  } catch {
    return null;
  }
}

/** Identities of the strict ancestors of `p` (parent up to "/"). */
async function identityChain(p: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let cur = path.dirname(p); ; cur = path.dirname(cur)) {
    const id = await dirIdentity(cur);
    if (id) out.add(id);
    if (cur === path.dirname(cur)) break;
  }
  return out;
}

/** Persisted media folders (the `libraries` table). MEDIA_DIRS only seeds it on first run. */
export class LibraryStore {
  constructor(
    private readonly db: DB,
    private readonly browser: FsBrowser,
  ) {}

  list(): LibraryRecord[] {
    return (this.db.prepare('SELECT * FROM libraries ORDER BY created_at, rowid').all() as LibraryRow[]).map(toRecord);
  }

  get(id: string): LibraryRecord | null {
    const row = this.db.prepare('SELECT * FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined;
    return row ? toRecord(row) : null;
  }

  /**
   * First-run seed from MEDIA_DIRS. Runs once per database (tracked in settings) so that an admin
   * removing every library does not get MEDIA_DIRS back on the next restart.
   * Returns the number of libraries inserted.
   */
  seed(mediaDirs: string[]): number {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM libraries').get() as { n: number }).n;
    if (n > 0 || getSetting(this.db, 'librariesSeeded') === '1') return 0;
    let inserted = 0;
    const base = Date.now();
    this.db.transaction(() => {
      const stmt = this.db.prepare(
        'INSERT OR IGNORE INTO libraries (id, name, path, created_at) VALUES (?, ?, ?, ?)',
      );
      mediaDirs.forEach((dir, i) => {
        // Distinct, ordered timestamps keep MEDIA_DIRS order stable in listings.
        const createdAt = new Date(base + i).toISOString();
        inserted += stmt.run(libraryIdForPath(dir), folderDisplayName(dir), dir, createdAt).changes;
      });
      setSetting(this.db, 'librariesSeeded', '1');
    })();
    return inserted;
  }

  /**
   * Validate a folder for use as a library: inside BROWSE_ROOTS (403 otherwise), an existing readable
   * directory, not already a library and neither inside nor containing another library.
   * Returns the canonical path to store.
   */
  private async validatePath(input: unknown, excludeId?: string): Promise<string> {
    if (input === undefined || input === null || (typeof input === 'string' && input.trim() === '')) {
      throw badRequest('path is required');
    }
    const dir = await this.browser.resolveDir(input).catch((err: unknown) => {
      if (err instanceof HttpError && err.statusCode === 404) throw badRequest('Folder does not exist');
      throw err;
    });
    // Besides comparing paths, compare directory identities (dev:ino): the same host folder can be
    // visible under two mount points (e.g. /media and /host/Videos in Docker) and must not be indexed twice.
    const candId = await dirIdentity(dir.real);
    const candChain = await identityChain(dir.real);
    for (const other of this.list()) {
      if (other.id === excludeId) continue;
      const otherReal = await realOrSelf(other.path);
      const otherId = await dirIdentity(otherReal);
      if (otherReal === dir.real || other.path === dir.path || (candId !== null && candId === otherId)) {
        throw badRequest(`This folder is already the library "${other.name}"`);
      }
      if (isWithin(dir.real, otherReal) || (otherId !== null && candChain.has(otherId))) {
        throw badRequest(`This folder is inside the library "${other.name}" (${other.path})`);
      }
      if (isWithin(otherReal, dir.real) || (candId !== null && (await identityChain(otherReal)).has(candId))) {
        throw badRequest(`This folder contains the library "${other.name}" (${other.path})`);
      }
    }
    return dir.path;
  }

  private newId(p: string): string {
    let id = libraryIdForPath(p);
    // A library whose path was changed keeps its old id, so the natural id may already be taken.
    for (let i = 1; this.get(id); i++) id = idForPath(`${p}#${i}`);
    return id;
  }

  async create(body: { path?: unknown; name?: unknown }): Promise<LibraryRecord> {
    const name = parseName(body.name);
    const p = await this.validatePath(body.path);
    const rec: LibraryRecord = {
      id: this.newId(p),
      name: name ?? folderDisplayName(p),
      path: p,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare('INSERT INTO libraries (id, name, path, created_at) VALUES (?, ?, ?, ?)')
      .run(rec.id, rec.name, rec.path, rec.createdAt);
    return rec;
  }

  /** Returns the updated record and whether its path changed. */
  async update(id: string, body: { path?: unknown; name?: unknown }): Promise<{ library: LibraryRecord; pathChanged: boolean }> {
    const current = this.get(id);
    if (!current) throw notFound('Library not found');
    const name = parseName(body.name);
    let newPath = current.path;
    if (body.path !== undefined) newPath = await this.validatePath(body.path, id);
    const pathChanged = path.normalize(newPath) !== path.normalize(current.path);
    const library: LibraryRecord = { ...current, name: name ?? current.name, path: newPath };
    this.db.prepare('UPDATE libraries SET name = ?, path = ? WHERE id = ?').run(library.name, library.path, id);
    return { library, pathChanged };
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM libraries WHERE id = ?').run(id).changes > 0;
  }
}
