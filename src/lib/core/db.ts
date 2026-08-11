/**
 * SQLite connection shared by the web UI and the watcher daemon.
 *
 * Both run as separate processes against the same file, so the database is
 * opened in WAL mode with a busy timeout: readers never block the writer and a
 * concurrent write waits instead of throwing SQLITE_BUSY.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

export type Db = Database.Database;

/** Where the database and any runtime state live. Override for tests. */
export function dataDir(): string {
  const configured = process.env.TVARR_DATA_DIR;
  if (configured && configured.trim()) return path.resolve(expandHome(configured.trim()));
  return path.join(os.homedir(), ".tvarr");
}

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY,
  kind          TEXT    NOT NULL CHECK (kind IN ('tv','movie')),
  provider      TEXT    NOT NULL,
  provider_id   TEXT    NOT NULL,
  imdb_id       TEXT,
  tvdb_id       TEXT,
  title         TEXT    NOT NULL,
  sort_title    TEXT    NOT NULL,
  year          INTEGER,
  overview      TEXT,
  poster        TEXT,
  status        TEXT,
  network       TEXT,
  runtime       INTEGER,
  genres        TEXT    NOT NULL DEFAULT '[]',
  monitored     INTEGER NOT NULL DEFAULT 1,
  quality       TEXT    NOT NULL,
  search_terms  TEXT    NOT NULL DEFAULT '[]',
  folder        TEXT,
  state         TEXT    NOT NULL DEFAULT 'wanted',
  grabbed_quality TEXT,
  grabbed_at    TEXT,
  release_date  TEXT,
  added_at      TEXT    NOT NULL,
  refreshed_at  TEXT,
  UNIQUE (provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_media_kind ON media (kind, monitored);

CREATE TABLE IF NOT EXISTS episodes (
  id            INTEGER PRIMARY KEY,
  media_id      INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider_id   TEXT,
  season        INTEGER NOT NULL,
  number        INTEGER NOT NULL,
  title         TEXT,
  air_date      TEXT,
  runtime       INTEGER,
  monitored     INTEGER NOT NULL DEFAULT 1,
  state         TEXT    NOT NULL DEFAULT 'wanted',
  grabbed_quality TEXT,
  grabbed_at    TEXT,
  UNIQUE (media_id, season, number)
);

CREATE INDEX IF NOT EXISTS idx_episodes_media ON episodes (media_id, season, number);
CREATE INDEX IF NOT EXISTS idx_episodes_state ON episodes (state, monitored);
CREATE INDEX IF NOT EXISTS idx_episodes_air ON episodes (air_date);

CREATE TABLE IF NOT EXISTS feeds (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  url             TEXT    NOT NULL,
  kind            TEXT    NOT NULL DEFAULT 'any',
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  last_status     TEXT,
  last_error      TEXT,
  item_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_items (
  id            INTEGER PRIMARY KEY,
  feed_id       INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  link          TEXT,
  magnet        TEXT,
  published_at  TEXT,
  size_bytes    INTEGER,
  seeders       INTEGER,
  leechers      INTEGER,
  first_seen_at TEXT    NOT NULL,
  processed_at  TEXT,
  UNIQUE (feed_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_feed_items_seen ON feed_items (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_pending ON feed_items (processed_at, first_seen_at);

CREATE TABLE IF NOT EXISTS history (
  id         INTEGER PRIMARY KEY,
  media_id   INTEGER REFERENCES media(id) ON DELETE SET NULL,
  episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
  feed_id    INTEGER,
  event      TEXT    NOT NULL,
  title      TEXT,
  quality    TEXT,
  reason     TEXT,
  path       TEXT,
  guid       TEXT,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_created ON history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_guid ON history (guid, event);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY,
  type        TEXT    NOT NULL,
  payload     TEXT    NOT NULL DEFAULT '{}',
  state       TEXT    NOT NULL DEFAULT 'pending',
  result      TEXT,
  created_at  TEXT    NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs (state, id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` will not
 * add them to a database that already exists, so they are applied by hand.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: "feed_items", column: "processed_at", definition: "TEXT" },
];

function applyMigrations(db: Db): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.length) continue;
    if (columns.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(path.join(dir, "tvarr.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
  applyMigrations(db);

  cached = db;
  return db;
}

/** Close the connection; used by the daemon on shutdown and by tests. */
export function closeDb(): void {
  cached?.close();
  cached = null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** SQLite has no boolean type; rows come back as 0/1. */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
