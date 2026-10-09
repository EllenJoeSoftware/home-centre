const TOKEN_KEY = "homecentre.token";
const USER_KEY = "homecentre.user";

// In-memory fallback for when localStorage is unavailable (private mode, blocked storage).
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    const v = globalThis.localStorage?.getItem(key);
    if (v != null) return v;
  } catch {
    /* storage unavailable */
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string | null): void {
  if (value == null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value == null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function getToken(): string | null {
  return read(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  write(TOKEN_KEY, token);
}

export function getStoredUser<T>(): T | null {
  const raw = read(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setStoredUser(user: unknown | null): void {
  write(USER_KEY, user == null ? null : JSON.stringify(user));
}
