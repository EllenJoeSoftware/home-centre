import fs from 'node:fs';
import path from 'node:path';
import { HttpError, badRequest } from './errors.js';
import { kindForFile } from './media.js';

/** Folders never shown in the browser nor descended into by the scanner. */
export const SKIP_DIRS = new Set(['@eaDir', '#recycle', '$RECYCLE.BIN', 'System Volume Information', 'lost+found']);

/** Maximum number of sub-folders returned by one browse call. */
export const BROWSE_LIMIT = 1000;

export interface BrowseRoot {
  name: string;
  path: string;
}

export interface BrowseDir {
  name: string;
  path: string;
  /** Media-extension files directly inside this folder (no recursion). */
  mediaCount: number;
}

export interface BrowseResult {
  path: string;
  /** null when `path` is one of the roots. */
  parent: string | null;
  dirs: BrowseDir[];
  /** Media-extension files directly inside `path` (no recursion). */
  mediaFiles: number;
  /** true when more than BROWSE_LIMIT sub-folders exist and the list was cut. */
  truncated: boolean;
}

export interface ResolvedPath {
  /** Canonical path expressed under the configured root (what clients see and what libraries store). */
  path: string;
  /** fs.realpath of the folder. */
  real: string;
  /** Configured root that contains it. */
  root: string;
  rootReal: string;
}

interface RootInfo {
  path: string;
  real: string;
}

/** True when `child` is `parent` or lies inside it (both absolute, normalised). */
export function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Friendly default name for a folder: its basename ("Media" for the conventional /media mount). */
export function folderDisplayName(p: string): string {
  if (p === '/media') return 'Media';
  return path.basename(p) || p;
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

const forbidden = (): HttpError => new HttpError(403, 'Path is outside the allowed browse roots');

function countMedia(entries: fs.Dirent[]): number {
  let n = 0;
  for (const e of entries) {
    if ((e.isFile() || e.isSymbolicLink()) && !e.name.startsWith('.') && kindForFile(e.name)) n++;
  }
  return n;
}

/**
 * Read-only directory browser confined to BROWSE_ROOTS. Every path is canonicalised with
 * fs.realpath, so `..` segments and symlinks cannot escape the roots.
 */
export class FsBrowser {
  constructor(private readonly configuredRoots: string[]) {}

  /** Roots that currently exist, with their real paths. */
  async existingRoots(): Promise<RootInfo[]> {
    const out: RootInfo[] = [];
    for (const root of this.configuredRoots) {
      try {
        const real = await fs.promises.realpath(root);
        if ((await fs.promises.stat(real)).isDirectory()) out.push({ path: root, real });
      } catch {
        /* missing roots are skipped silently */
      }
    }
    return out;
  }

  async roots(): Promise<BrowseRoot[]> {
    return (await this.existingRoots()).map((r) => ({ name: folderDisplayName(r.path), path: r.path }));
  }

  /** Root (longest match) whose real path contains `real`, or null. */
  private rootFor(real: string, roots: RootInfo[]): RootInfo | null {
    let best: RootInfo | null = null;
    for (const r of roots) {
      if (isWithin(real, r.real) && (!best || r.real.length > best.real.length)) best = r;
    }
    return best;
  }

  /**
   * Resolve a client-supplied absolute path to a folder inside the roots.
   * 400 for malformed input, 403 when it is (or resolves) outside the roots, 404 when missing.
   */
  async resolve(input: unknown): Promise<ResolvedPath> {
    if (typeof input !== 'string' || input.trim() === '') throw badRequest('path is required');
    if (input.includes('\0')) throw badRequest('invalid path');
    if (!path.isAbsolute(input)) throw badRequest('path must be absolute');
    const lexical = path.resolve(input);
    const roots = await this.existingRoots();
    // Reject paths that are lexically outside every root before touching the file system,
    // so existence of folders elsewhere is never revealed.
    if (!roots.some((r) => isWithin(lexical, r.path) || isWithin(lexical, r.real))) throw forbidden();
    let real: string;
    try {
      real = await fs.promises.realpath(lexical);
    } catch (err) {
      const code = errCode(err);
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // Do not reveal whether something exists behind a symlink that leaves the roots.
        const ancestor = await this.deepestExisting(lexical);
        if (!ancestor || !this.rootFor(ancestor, roots)) throw forbidden();
        throw new HttpError(404, 'Folder not found');
      }
      if (code === 'EACCES' || code === 'EPERM') throw badRequest('Folder is not readable by the server');
      throw err;
    }
    const root = this.rootFor(real, roots);
    if (!root) throw forbidden();
    const rel = path.relative(root.real, real);
    return { path: rel ? path.join(root.path, rel) : root.path, real, root: root.path, rootReal: root.real };
  }

  /** Real path of the closest existing ancestor of `p` (or of `p` itself). */
  private async deepestExisting(p: string): Promise<string | null> {
    for (let cur = path.dirname(p); ; cur = path.dirname(cur)) {
      try {
        return await fs.promises.realpath(cur);
      } catch {
        if (cur === path.dirname(cur)) return null;
      }
    }
  }

  /** Resolve and require a readable directory. */
  async resolveDir(input: unknown): Promise<ResolvedPath & { entries: fs.Dirent[] }> {
    const resolved = await this.resolve(input);
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(resolved.real);
    } catch {
      throw new HttpError(404, 'Folder not found');
    }
    if (!st.isDirectory()) throw badRequest('Not a folder');
    try {
      await fs.promises.access(resolved.real, fs.constants.R_OK | fs.constants.X_OK);
      const entries = await fs.promises.readdir(resolved.real, { withFileTypes: true });
      return { ...resolved, entries };
    } catch {
      throw badRequest('Folder is not readable by the server');
    }
  }

  async browse(input: unknown): Promise<BrowseResult> {
    const dir = await this.resolveDir(input);
    const roots = await this.existingRoots();

    const candidates = dir.entries
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .map((e) => ({ name: e.name, symlink: e.isSymbolicLink() }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

    const inspect = async (c: { name: string; symlink: boolean }): Promise<BrowseDir | null> => {
      let target = path.join(dir.real, c.name);
      try {
        if (c.symlink) {
          target = await fs.promises.realpath(target);
          if (!this.rootFor(target, roots)) return null; // never offer a link that escapes the roots
          if (!(await fs.promises.stat(target)).isDirectory()) return null;
        }
        const entries = await fs.promises.readdir(target, { withFileTypes: true });
        return { name: c.name, path: path.join(dir.path, c.name), mediaCount: countMedia(entries) };
      } catch {
        return null; // unreadable / vanished
      }
    };

    const dirs: BrowseDir[] = [];
    let next = 0;
    let truncated = false;
    const BATCH = 32;
    while (next < candidates.length && !truncated) {
      const batch = candidates.slice(next, next + BATCH);
      next += batch.length;
      for (const d of await Promise.all(batch.map(inspect))) {
        if (!d) continue;
        if (dirs.length < BROWSE_LIMIT) dirs.push(d);
        else truncated = true;
      }
      // Cap reached with candidates left over: report truncation without inspecting the rest.
      if (dirs.length >= BROWSE_LIMIT && next < candidates.length) truncated = true;
    }

    const atRoot = dir.real === dir.rootReal;
    return {
      path: dir.path,
      parent: atRoot ? null : path.dirname(dir.path),
      dirs,
      mediaFiles: countMedia(dir.entries),
      truncated,
    };
  }
}
