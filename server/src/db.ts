import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

/**
 * Ordered migrations. Each entry upgrades the schema from version i to i+1.
 * Never edit an existing migration once released; append a new one instead.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    library_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    folder TEXT NOT NULL,
    file_name TEXT NOT NULL,
    title TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    duration_sec REAL,
    width INTEGER,
    height INTEGER,
    video_codec TEXT,
    audio_codec TEXT,
    container TEXT,
    direct_playable INTEGER NOT NULL DEFAULT 0,
    series_name TEXT,
    season INTEGER,
    episode INTEGER,
    artist TEXT,
    album TEXT,
    year INTEGER,
    added_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    has_thumbnail INTEGER NOT NULL DEFAULT 0,
    subtitles TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX idx_media_library_folder ON media(library_id, folder);
  CREATE INDEX idx_media_kind ON media(kind);
  CREATE INDEX idx_media_added ON media(added_at);
  CREATE INDEX idx_media_series ON media(series_name, season, episode);

  CREATE TABLE progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position_sec REAL NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, media_id)
  );
  CREATE INDEX idx_progress_user_updated ON progress(user_id, updated_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE libraries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  `,
];

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]!;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'homecentre.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

/** Stable server UUID, generated on first start and persisted in the settings table (DATA_DIR). */
export function getOrCreateServerId(db: DB): string {
  const existing = getSetting(db, 'serverId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('serverId', id);
  return getSetting(db, 'serverId') ?? id;
}
