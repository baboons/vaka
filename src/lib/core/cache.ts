/**
 * A small TTL cache in SQLite, for provider responses.
 *
 * The dashboard re-renders every 20 seconds; without this, every refresh would
 * hit TVmaze and Cinemeta. Expired entries are kept rather than deleted so a
 * provider outage degrades to slightly stale data instead of an empty page.
 */

import { getDb, nowIso, type Db } from "./db";

interface CacheRow {
  value: string;
  expires_at: string;
  updated_at: string;
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
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  db: Db = getDb(),
): Promise<CachedResult<T>> {
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
    ? db.prepare("DELETE FROM cache WHERE key LIKE ?").run(`${prefix}%`).changes
    : db.prepare("DELETE FROM cache").run().changes;
}
