import type { BrowseRoot } from "../api/types";

/** Last segment of a server path ("/host/Movies/" -> "Movies"). */
export function baseName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Breadcrumb trail for `path`: the browse root it lives in (longest match), then each folder below it. */
export function crumbsFor(path: string, roots: BrowseRoot[]): { label: string; path: string }[] {
  const root = roots
    .filter((r) => path === r.path || path.startsWith(r.path.endsWith("/") ? r.path : `${r.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!root) return [{ label: path, path }];
  const out = [{ label: root.name, path: root.path }];
  let cur = root.path;
  for (const seg of path.slice(root.path.length).split("/").filter(Boolean)) {
    cur = cur.endsWith("/") ? `${cur}${seg}` : `${cur}/${seg}`;
    out.push({ label: seg, path: cur });
  }
  return out;
}

/** Parent folder of a server path, or null for "/". */
export function parentPath(p: string): string | null {
  const trimmed = p.length > 1 ? p.replace(/\/+$/, "") : p;
  const i = trimmed.lastIndexOf("/");
  if (i < 0 || trimmed === "/") return null;
  return i === 0 ? "/" : trimmed.slice(0, i);
}
