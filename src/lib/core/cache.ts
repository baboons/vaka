/**
 * A small TTL cache in SQLite, for provider responses.
 *
 * The dashboard re-renders every 20 seconds; without this, every refresh would
 * hit TVmaze and Cinemeta. Expired entries are kept rather than deleted so a
 * provider outage degrades to slightly stale data instead of an empty page.
 */

import { getDb, nowIso, type Db } from "./db";

/**
 * Bump this whenever the *derivation* of a cached value changes — a new
 * ranking, a different filter, an added field.
 *
 * Without it, improving how a list is built has no visible effect until the
 * old entry expires hours later, which reads exactly like the update having
 * done nothing.
 *
 * 2: discovery lists ranked by popularity, premieres include returning seasons
 */
export const CACHE_VERSION = 2;

interface CacheRow {
  value: string;
  expires_at: string;
  updated_at: string;
}

function versionedKey(key: string): string {
  return `v${CACHE_VERSION}:${key}`;
}

/**
 * Delete entries written by an older version.
 *
 * Only housekeeping: a versioned key means an old entry is never *read*
 * regardless. Called from the watcher's maintenance pass, and once per process
 * on first use so a web-only run does not accumulate them either.
 */
export function pruneCacheVersions(db: Db = getDb()): number {
  try {
    return db.prepare("DELETE FROM cache WHERE key NOT LIKE ?").run(`v${CACHE_VERSION}:%`).changes;
  } catch {
    // A missing table on first run is not worth failing a page render over.
    return 0;
  }
}

let prunedThisProcess = false;

function pruneOnce(db: Db): void {
  if (prunedThisProcess) return;
  prunedThisProcess = true;
  pruneCacheVersions(db);
}

function read(key: string, db: Db): CacheRow | null {
  const row = db.prepare("SELECT value, expires_at, updated_at FROM cache WHERE key = ?").get(key);
  return (row as CacheRow | undefined) ?? null;
}

function write(key: string, value: unknown, ttlSeconds: number, db: Db): void {
  db.prepare(
    `INSERT INTO cache (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
  ).run(
    key,
    JSON.stringify(value),
    new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    nowIso(),
  );
}

function parse<T>(row: CacheRow): T | null {
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export interface CachedResult<T> {
  value: T;
  /** True when the provider failed and this came from an expired entry. */
  stale: boolean;
  updatedAt: string;
}

/**
 * Return a cached value, refreshing it when expired.
 *
 * If the refresh throws, a previously cached value is returned and marked
 * stale; only a cold cache propagates the error.
 */
export async function cached<T>(
  rawKey: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  db: Db = getDb(),
): Promise<CachedResult<T>> {
  pruneOnce(db);

  const key = versionedKey(rawKey);
  const existing = read(key, db);

  if (existing && existing.expires_at > nowIso()) {
    const value = parse<T>(existing);
    if (value !== null) return { value, stale: false, updatedAt: existing.updated_at };
  }

  try {
    const value = await load();
    write(key, value, ttlSeconds, db);
    return { value, stale: false, updatedAt: nowIso() };
  } catch (error) {
    if (existing) {
      const value = parse<T>(existing);
      if (value !== null) return { value, stale: true, updatedAt: existing.updated_at };
    }
    throw error;
  }
}

export function clearCache(prefix?: string, db: Db = getDb()): number {
  return prefix
    ? db.prepare("DELETE FROM cache WHERE key LIKE ?").run(`v${CACHE_VERSION}:${prefix}%`).changes
    : db.prepare("DELETE FROM cache").run().changes;
}
