import { getToken } from "./token";
import type {
  BrowseListing,
  BrowseRoots,
  FolderListing,
  Library,
  LibraryUpdate,
  LoginResponse,
  MediaItem,
  MediaQuery,
  NewLibrary,
  NewUser,
  Page,
  Progress,
  ProgressUpdate,
  ScanStatus,
  Series,
  ServerInfo,
  User,
} from "./types";

export const API_BASE = "/api";

type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Builds "?a=1&b=x" skipping null/undefined/empty-string values. Returns "" when empty. */
export function buildQuery(params: QueryParams = {}): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.append(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Absolute (same-origin) API path, e.g. apiUrl("/media", {kind:"video"}) -> "/api/media?kind=video". */
export function apiUrl(path: string, params?: QueryParams): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}${buildQuery(params)}`;
}

/**
 * URL for media elements (<video>, <img>, <audio>, <track>) that cannot send headers:
 * the token travels as ?token=.
 */
export function mediaUrl(path: string, params: QueryParams = {}, token: string | null = getToken()): string {
  return apiUrl(path, { ...params, token });
}

const enc = encodeURIComponent;

export const urls = {
  stream: (id: string, token?: string | null) => mediaUrl(`/media/${enc(id)}/stream`, {}, token === undefined ? getToken() : token),
  hls: (id: string, start?: number, token?: string | null) =>
    mediaUrl(
      `/media/${enc(id)}/transcode.m3u8`,
      { start: start && start > 0 ? Math.floor(start) : undefined },
      token === undefined ? getToken() : token,
    ),
  thumbnail: (id: string, w?: number, token?: string | null) =>
    mediaUrl(`/media/${enc(id)}/thumbnail`, { w }, token === undefined ? getToken() : token),
  subtitle: (id: string, subId: string, token?: string | null) =>
    mediaUrl(`/media/${enc(id)}/subtitles/${enc(subId)}`, {}, token === undefined ? getToken() : token),
};

/** Playback source for an item following the contract's client playback rule. */
export function playbackSource(item: Pick<MediaItem, "id" | "kind" | "directPlayable">, start?: number): {
  url: string;
  type: "direct" | "hls";
} {
  if (item.directPlayable || item.kind !== "video") return { url: urls.stream(item.id), type: "direct" };
  return { url: urls.hls(item.id, start), type: "hls" };
}

let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  keepalive?: boolean;
  /** When false, a 401 does not trigger the global logout redirect (used by login). */
  redirectOn401?: boolean;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), {
      method,
      headers,
      body,
      signal: opts.signal,
      keepalive: opts.keepalive,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "Cannot reach the server");
  }

  if (res.status === 401 && opts.redirectOn401 !== false) {
    unauthorizedHandler?.();
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : res.statusText || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  serverInfo: () => request<ServerInfo>("GET", "/server/info", { auth: false }),
  login: (username: string, password: string) =>
    request<LoginResponse>("POST", "/auth/login", { body: { username, password }, auth: false, redirectOn401: false }),
  me: () => request<User>("GET", "/me"),

  libraries: () => request<Library[]>("GET", "/libraries"),
  startScan: () => request<{ started: boolean }>("POST", "/libraries/scan"),
  scanStatus: () => request<ScanStatus>("GET", "/scan/status"),
  createLibrary: (lib: NewLibrary) => request<Library>("POST", "/libraries", { body: lib }),
  updateLibrary: (id: string, update: LibraryUpdate) => request<Library>("PATCH", `/libraries/${enc(id)}`, { body: update }),
  deleteLibrary: (id: string) => request<{ deleted: boolean }>("DELETE", `/libraries/${enc(id)}`),

  fsRoots: () => request<BrowseRoots>("GET", "/fs/roots"),
  fsBrowse: (path: string, signal?: AbortSignal) => request<BrowseListing>("GET", "/fs/browse", { query: { path }, signal }),

  media: (q: MediaQuery = {}, signal?: AbortSignal) =>
    request<Page<MediaItem>>("GET", "/media", { query: { ...q }, signal }),
  recent: (limit = 20) => request<MediaItem[]>("GET", "/media/recent", { query: { limit } }),
  continueWatching: () => request<MediaItem[]>("GET", "/media/continue"),
  item: (id: string) => request<MediaItem>("GET", `/media/${enc(id)}`),

  folders: (libraryId: string, path = "") =>
    request<FolderListing>("GET", "/folders", { query: { libraryId, path } }),

  series: () => request<Series[]>("GET", "/series"),
  episodes: (name: string) => request<MediaItem[]>("GET", `/series/${enc(name)}/episodes`),

  progress: (id: string) => request<Progress | null>("GET", `/media/${enc(id)}/progress`),
  saveProgress: (id: string, update: ProgressUpdate, keepalive = false) =>
    request<Progress>("PUT", `/media/${enc(id)}/progress`, { body: update, keepalive }),

  users: () => request<User[]>("GET", "/users"),
  createUser: (u: NewUser) => request<User>("POST", "/users", { body: u }),
  deleteUser: (id: number) => request<unknown>("DELETE", `/users/${id}`),
};
