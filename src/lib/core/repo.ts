/**
 * Data access. Plain SQL with hand-written row mappers — the schema is small
 * and both processes need identical semantics, so an ORM would only add a
 * layer to keep in sync.
 */

import { fromBool, getDb, nowIso, parseJson, toBool, type Db } from "./db";
import { parseQualityProfile } from "./settings";
import type {
  Episode,
  EpisodeState,
  Feed,
  FeedItem,
  HistoryEvent,
  HistoryRow,
  Job,
  JobType,
  Media,
  MediaKind,
  MediaState,
  QualityProfile,
} from "./types";

/* ------------------------------------------------------------------ */
/* Row mappers                                                          */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function mapMedia(row: Row): Media {
  return {
    id: row.id as number,
    kind: row.kind as MediaKind,
    provider: row.provider as string,
    providerId: String(row.provider_id),
    imdbId: (row.imdb_id as string) ?? null,
    tvdbId: (row.tvdb_id as string) ?? null,
    title: row.title as string,
    sortTitle: row.sort_title as string,
    year: (row.year as number) ?? null,
    overview: (row.overview as string) ?? null,
    poster: (row.poster as string) ?? null,
    status: (row.status as string) ?? null,
    network: (row.network as string) ?? null,
    runtime: (row.runtime as number) ?? null,
    genres: parseJson<string[]>(row.genres, []),
    monitored: toBool(row.monitored),
    quality: parseQualityProfile(parseJson<unknown>(row.quality, {})),
    searchTerms: parseJson<string[]>(row.search_terms, []),
    folder: (row.folder as string) ?? null,
    state: row.state as MediaState,
    grabbedQuality: (row.grabbed_quality as string) ?? null,
    grabbedAt: (row.grabbed_at as string) ?? null,
    releaseDate: (row.release_date as string) ?? null,
    addedAt: row.added_at as string,
    refreshedAt: (row.refreshed_at as string) ?? null,
  };
}

function mapEpisode(row: Row): Episode {
  return {
    id: row.id as number,
    mediaId: row.media_id as number,
    providerId: (row.provider_id as string) ?? null,
    season: row.season as number,
    number: row.number as number,
    title: (row.title as string) ?? null,
    airDate: (row.air_date as string) ?? null,
    runtime: (row.runtime as number) ?? null,
    monitored: toBool(row.monitored),
    state: row.state as EpisodeState,
    grabbedQuality: (row.grabbed_quality as string) ?? null,
    grabbedAt: (row.grabbed_at as string) ?? null,
  };
}

function mapFeed(row: Row): Feed {
  return {
    id: row.id as number,
    name: row.name as string,
    url: row.url as string,
    kind: row.kind as MediaKind | "any",
    enabled: toBool(row.enabled),
    lastCheckedAt: (row.last_checked_at as string) ?? null,
    lastStatus: (row.last_status as string) ?? null,
    lastError: (row.last_error as string) ?? null,
    itemCount: (row.item_count as number) ?? 0,
    createdAt: row.created_at as string,
  };
}

function mapFeedItem(row: Row): FeedItem {
  return {
    id: row.id as number,
    feedId: row.feed_id as number,
    guid: row.guid as string,
    title: row.title as string,
    link: (row.link as string) ?? null,
    magnet: (row.magnet as string) ?? null,
    publishedAt: (row.published_at as string) ?? null,
    sizeBytes: (row.size_bytes as number) ?? null,
    seeders: (row.seeders as number) ?? null,
    leechers: (row.leechers as number) ?? null,
    firstSeenAt: row.first_seen_at as string,
  };
}

function mapHistory(row: Row): HistoryRow {
  return {
    id: row.id as number,
    mediaId: (row.media_id as number) ?? null,
    episodeId: (row.episode_id as number) ?? null,
    feedId: (row.feed_id as number) ?? null,
    event: row.event as HistoryEvent,
    title: (row.title as string) ?? null,
    quality: (row.quality as string) ?? null,
    reason: (row.reason as string) ?? null,
    path: (row.path as string) ?? null,
    guid: (row.guid as string) ?? null,
    createdAt: row.created_at as string,
    mediaTitle: (row.media_title as string) ?? null,
    mediaKind: (row.media_kind as MediaKind) ?? null,
  };
}

function mapJob(row: Row): Job {
  return {
    id: row.id as number,
    type: row.type as JobType,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    state: row.state as Job["state"],
    result: (row.result as string) ?? null,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string) ?? null,
    finishedAt: (row.finished_at as string) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Media                                                                */
/* ------------------------------------------------------------------ */

export interface NewMedia {
  kind: MediaKind;
  provider: string;
  providerId: string;
  imdbId?: string | null;
  tvdbId?: string | null;
  title: string;
  year?: number | null;
  overview?: string | null;
  poster?: string | null;
  status?: string | null;
  network?: string | null;
  runtime?: number | null;
  genres?: string[];
  quality: QualityProfile;
  searchTerms?: string[];
  folder?: string | null;
  releaseDate?: string | null;
}

/** Strips a leading article so "The Bear" sorts under B. */
export function sortTitleOf(title: string): string {
  return title.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
}

export function insertMedia(input: NewMedia, db: Db = getDb()): Media {
  const info = db
    .prepare(
      `INSERT INTO media (
         kind, provider, provider_id, imdb_id, tvdb_id, title, sort_title, year,
         overview, poster, status, network, runtime, genres, monitored, quality,
         search_terms, folder, state, release_date, added_at
       ) VALUES (
         @kind, @provider, @providerId, @imdbId, @tvdbId, @title, @sortTitle, @year,
         @overview, @poster, @status, @network, @runtime, @genres, 1, @quality,
         @searchTerms, @folder, 'wanted', @releaseDate, @addedAt
       )
       ON CONFLICT (provider, provider_id) DO UPDATE SET
         monitored = 1,
         quality = excluded.quality`,
    )
    .run({
      kind: input.kind,
      provider: input.provider,
      providerId: input.providerId,
      imdbId: input.imdbId ?? null,
      tvdbId: input.tvdbId ?? null,
      title: input.title,
      sortTitle: sortTitleOf(input.title),
      year: input.year ?? null,
      overview: input.overview ?? null,
      poster: input.poster ?? null,
      status: input.status ?? null,
      network: input.network ?? null,
      runtime: input.runtime ?? null,
      genres: JSON.stringify(input.genres ?? []),
      quality: JSON.stringify(input.quality),
      searchTerms: JSON.stringify(input.searchTerms ?? []),
      folder: input.folder ?? null,
      releaseDate: input.releaseDate ?? null,
      addedAt: nowIso(),
    });

  const id =
    info.changes > 0 && info.lastInsertRowid
      ? Number(info.lastInsertRowid)
      : (
          db
            .prepare("SELECT id FROM media WHERE provider = ? AND provider_id = ?")
            .get(input.provider, input.providerId) as { id: number }
        ).id;

  return getMedia(id, db)!;
}

export function getMedia(id: number, db: Db = getDb()): Media | null {
  const row = db.prepare("SELECT * FROM media WHERE id = ?").get(id) as Row | undefined;
  return row ? mapMedia(row) : null;
}

export function findMediaByProvider(
  provider: string,
  providerId: string,
  db: Db = getDb(),
): Media | null {
  const row = db
    .prepare("SELECT * FROM media WHERE provider = ? AND provider_id = ?")
    .get(provider, providerId) as Row | undefined;
  return row ? mapMedia(row) : null;
}

export function listMedia(
  options: { kind?: MediaKind; monitoredOnly?: boolean } = {},
  db: Db = getDb(),
): Media[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.kind) {
    clauses.push("kind = ?");
    params.push(options.kind);
  }
  if (options.monitoredOnly) clauses.push("monitored = 1");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM media ${where} ORDER BY sort_title ASC`)
    .all(...params) as Row[];
  return rows.map(mapMedia);
}

export function updateMedia(
  id: number,
  patch: Partial<{
    monitored: boolean;
    quality: QualityProfile;
    folder: string | null;
    searchTerms: string[];
    state: MediaState;
    grabbedQuality: string | null;
    grabbedAt: string | null;
    title: string;
    year: number | null;
    overview: string | null;
    poster: string | null;
    status: string | null;
    network: string | null;
    runtime: number | null;
    genres: string[];
    releaseDate: string | null;
    refreshedAt: string | null;
  }>,
  db: Db = getDb(),
): void {
  const columns: Record<string, string> = {
    monitored: "monitored",
    quality: "quality",
    folder: "folder",
    searchTerms: "search_terms",
    state: "state",
    grabbedQuality: "grabbed_quality",
    grabbedAt: "grabbed_at",
    title: "title",
    year: "year",
    overview: "overview",
    poster: "poster",
    status: "status",
    network: "network",
    runtime: "runtime",
    genres: "genres",
    releaseDate: "release_date",
    refreshedAt: "refreshed_at",
  };

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    if (key === "monitored") params.push(fromBool(value as boolean));
    else if (key === "quality" || key === "searchTerms" || key === "genres")
      params.push(JSON.stringify(value));
    else params.push(value ?? null);
  }
  if (patch.title) {
    sets.push("sort_title = ?");
    params.push(sortTitleOf(patch.title));
  }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE media SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteMedia(id: number, db: Db = getDb()): void {
  db.prepare("DELETE FROM media WHERE id = ?").run(id);
}

/* ------------------------------------------------------------------ */
/* Episodes                                                             */
/* ------------------------------------------------------------------ */

export interface NewEpisode {
  mediaId: number;
  providerId?: string | null;
  season: number;
  number: number;
  title?: string | null;
  airDate?: string | null;
  runtime?: number | null;
  monitored: boolean;
}

/**
 * Insert or refresh episodes from a metadata provider. Existing rows keep
 * their state and monitored flag — a refresh must never undo a grab.
 */
export function upsertEpisodes(episodes: NewEpisode[], db: Db = getDb()): void {
  const statement = db.prepare(
    `INSERT INTO episodes (media_id, provider_id, season, number, title, air_date, runtime, monitored, state)
     VALUES (@mediaId, @providerId, @season, @number, @title, @airDate, @runtime, @monitored, 'wanted')
     ON CONFLICT (media_id, season, number) DO UPDATE SET
       provider_id = excluded.provider_id,
       title       = excluded.title,
       air_date    = excluded.air_date,
       runtime     = excluded.runtime`,
  );

  const run = db.transaction((rows: NewEpisode[]) => {
    for (const row of rows) {
      statement.run({
        mediaId: row.mediaId,
        providerId: row.providerId ?? null,
        season: row.season,
        number: row.number,
        title: row.title ?? null,
        airDate: row.airDate ?? null,
        runtime: row.runtime ?? null,
        monitored: fromBool(row.monitored),
      });
    }
  });
  run(episodes);
}

export function listEpisodes(mediaId: number, db: Db = getDb()): Episode[] {
  const rows = db
    .prepare("SELECT * FROM episodes WHERE media_id = ? ORDER BY season ASC, number ASC")
    .all(mediaId) as Row[];
  return rows.map(mapEpisode);
}

export function getEpisode(id: number, db: Db = getDb()): Episode | null {
  const row = db.prepare("SELECT * FROM episodes WHERE id = ?").get(id) as Row | undefined;
  return row ? mapEpisode(row) : null;
}

export function findEpisode(
  mediaId: number,
  season: number,
  number: number,
  db: Db = getDb(),
): Episode | null {
  const row = db
    .prepare("SELECT * FROM episodes WHERE media_id = ? AND season = ? AND number = ?")
    .get(mediaId, season, number) as Row | undefined;
  return row ? mapEpisode(row) : null;
}

/** Daily shows are identified by air date rather than episode number. */
export function findEpisodeByAirDate(
  mediaId: number,
  airDate: string,
  db: Db = getDb(),
): Episode | null {
  const row = db
    .prepare("SELECT * FROM episodes WHERE media_id = ? AND substr(air_date, 1, 10) = ?")
    .get(mediaId, airDate) as Row | undefined;
  return row ? mapEpisode(row) : null;
}

export function listSeasonEpisodes(
  mediaId: number,
  season: number,
  db: Db = getDb(),
): Episode[] {
  const rows = db
    .prepare("SELECT * FROM episodes WHERE media_id = ? AND season = ? ORDER BY number ASC")
    .all(mediaId, season) as Row[];
  return rows.map(mapEpisode);
}

export function updateEpisode(
  id: number,
  patch: Partial<{
    monitored: boolean;
    state: EpisodeState;
    grabbedQuality: string | null;
    grabbedAt: string | null;
  }>,
  db: Db = getDb(),
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.monitored !== undefined) {
    sets.push("monitored = ?");
    params.push(fromBool(patch.monitored));
  }
  if (patch.state !== undefined) {
    sets.push("state = ?");
    params.push(patch.state);
  }
  if (patch.grabbedQuality !== undefined) {
    sets.push("grabbed_quality = ?");
    params.push(patch.grabbedQuality);
  }
  if (patch.grabbedAt !== undefined) {
    sets.push("grabbed_at = ?");
    params.push(patch.grabbedAt);
  }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE episodes SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function setSeasonMonitored(
  mediaId: number,
  season: number,
  monitored: boolean,
  db: Db = getDb(),
): void {
  db.prepare("UPDATE episodes SET monitored = ? WHERE media_id = ? AND season = ?").run(
    fromBool(monitored),
    mediaId,
    season,
  );
}

/** Episodes that have aired (or air today) and are still wanted. */
export function listWantedEpisodes(db: Db = getDb()): Array<Episode & { media: Media }> {
  const rows = db
    .prepare(
      `SELECT e.*, m.id AS m_id FROM episodes e
       JOIN media m ON m.id = e.media_id
       WHERE m.monitored = 1 AND e.monitored = 1 AND e.state = 'wanted'
       ORDER BY e.air_date DESC`,
    )
    .all() as Row[];
  const mediaCache = new Map<number, Media>();
  return rows.map((row) => {
    const mediaId = row.media_id as number;
    if (!mediaCache.has(mediaId)) mediaCache.set(mediaId, getMedia(mediaId, db)!);
    return { ...mapEpisode(row), media: mediaCache.get(mediaId)! };
  });
}

export interface UpcomingEpisode extends Episode {
  mediaTitle: string;
  poster: string | null;
}

export function listUpcoming(days = 14, db: Db = getDb()): UpcomingEpisode[] {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86400000);
  const rows = db
    .prepare(
      `SELECT e.*, m.title AS media_title, m.poster AS poster
       FROM episodes e JOIN media m ON m.id = e.media_id
       WHERE m.monitored = 1 AND e.air_date IS NOT NULL
         AND e.air_date >= ? AND e.air_date <= ?
       ORDER BY e.air_date ASC LIMIT 60`,
    )
    .all(from.toISOString(), to.toISOString()) as Row[];
  return rows.map((row) => ({
    ...mapEpisode(row),
    mediaTitle: row.media_title as string,
    poster: (row.poster as string) ?? null,
  }));
}

export function countEpisodes(
  mediaId: number,
  db: Db = getDb(),
): { total: number; have: number; wanted: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN state IN ('grabbed','done') THEN 1 ELSE 0 END) AS have,
              SUM(CASE WHEN state = 'wanted' AND monitored = 1 THEN 1 ELSE 0 END) AS wanted
       FROM episodes WHERE media_id = ?`,
    )
    .get(mediaId) as Row;
  return {
    total: (row.total as number) ?? 0,
    have: (row.have as number) ?? 0,
    wanted: (row.wanted as number) ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Feeds                                                                */
/* ------------------------------------------------------------------ */

export function listFeeds(enabledOnly = false, db: Db = getDb()): Feed[] {
  const rows = db
    .prepare(`SELECT * FROM feeds ${enabledOnly ? "WHERE enabled = 1" : ""} ORDER BY id ASC`)
    .all() as Row[];
  return rows.map(mapFeed);
}

export function getFeed(id: number, db: Db = getDb()): Feed | null {
  const row = db.prepare("SELECT * FROM feeds WHERE id = ?").get(id) as Row | undefined;
  return row ? mapFeed(row) : null;
}

export function insertFeed(
  input: { name: string; url: string; kind: MediaKind | "any"; enabled?: boolean },
  db: Db = getDb(),
): Feed {
  const info = db
    .prepare(
      `INSERT INTO feeds (name, url, kind, enabled, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.name, input.url, input.kind, fromBool(input.enabled ?? true), nowIso());
  return getFeed(Number(info.lastInsertRowid), db)!;
}

export function updateFeed(
  id: number,
  patch: Partial<{
    name: string;
    url: string;
    kind: MediaKind | "any";
    enabled: boolean;
    lastCheckedAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    itemCount: number;
  }>,
  db: Db = getDb(),
): void {
  const columns: Record<string, string> = {
    name: "name",
    url: "url",
    kind: "kind",
    enabled: "enabled",
    lastCheckedAt: "last_checked_at",
    lastStatus: "last_status",
    lastError: "last_error",
    itemCount: "item_count",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    params.push(key === "enabled" ? fromBool(value as boolean) : (value ?? null));
  }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE feeds SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteFeed(id: number, db: Db = getDb()): void {
  db.prepare("DELETE FROM feeds WHERE id = ?").run(id);
}

/**
 * Store items and report which ones we had not seen before. Only new items are
 * considered for grabbing, so a feed that keeps an item around for days does
 * not cause repeated downloads.
 */
export function saveFeedItems(items: FeedItem[], db: Db = getDb()): FeedItem[] {
  const insert = db.prepare(
    `INSERT INTO feed_items (feed_id, guid, title, link, magnet, published_at, size_bytes, seeders, leechers, first_seen_at)
     VALUES (@feedId, @guid, @title, @link, @magnet, @publishedAt, @sizeBytes, @seeders, @leechers, @firstSeenAt)
     ON CONFLICT (feed_id, guid) DO UPDATE SET
       seeders  = excluded.seeders,
       leechers = excluded.leechers`,
  );

  // An upsert reports changes === 1 whether it inserted or updated, so
  // novelty has to be established before writing.
  const existing = db.prepare("SELECT id FROM feed_items WHERE feed_id = ? AND guid = ?");

  const fresh: FeedItem[] = [];
  const run = db.transaction((rows: FeedItem[]) => {
    for (const row of rows) {
      const seenBefore = existing.get(row.feedId, row.guid) as Row | undefined;
      const firstSeenAt = nowIso();
      const info = insert.run({
        feedId: row.feedId,
        guid: row.guid,
        title: row.title,
        link: row.link,
        magnet: row.magnet,
        publishedAt: row.publishedAt,
        sizeBytes: row.sizeBytes,
        seeders: row.seeders,
        leechers: row.leechers,
        firstSeenAt,
      });
      if (!seenBefore) {
        fresh.push({ ...row, id: Number(info.lastInsertRowid), firstSeenAt });
      }
    }
  });
  run(items);
  return fresh;
}

export function listFeedItems(limit = 200, db: Db = getDb()): FeedItem[] {
  const rows = db
    .prepare("SELECT * FROM feed_items ORDER BY first_seen_at DESC, id DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map(mapFeedItem);
}

/** All cached items from feeds that may serve the given library. */
export function listFeedItemsForKind(kind: MediaKind, db: Db = getDb()): FeedItem[] {
  const rows = db
    .prepare(
      `SELECT fi.* FROM feed_items fi
       JOIN feeds f ON f.id = fi.feed_id
       WHERE f.enabled = 1 AND f.kind IN ('any', ?)
       ORDER BY fi.first_seen_at DESC LIMIT 2000`,
    )
    .all(kind) as Row[];
  return rows.map(mapFeedItem);
}

/**
 * Items still awaiting a grab decision.
 *
 * Evaluation is tracked with `processed_at` rather than "items new since the
 * last poll" so that a configured grab delay, a daemon restart, or a title
 * added between polls can never cause an item to be skipped forever.
 */
export function listPendingItems(
  delayMinutes: number,
  limit = 500,
  db: Db = getDb(),
): FeedItem[] {
  const cutoff = new Date(Date.now() - delayMinutes * 60_000).toISOString();
  const rows = db
    .prepare(
      `SELECT fi.* FROM feed_items fi
       JOIN feeds f ON f.id = fi.feed_id
       WHERE fi.processed_at IS NULL AND f.enabled = 1 AND fi.first_seen_at <= ?
       ORDER BY fi.first_seen_at ASC LIMIT ?`,
    )
    .all(cutoff, limit) as Row[];
  return rows.map(mapFeedItem);
}

export function markItemsProcessed(ids: number[], db: Db = getDb()): void {
  if (!ids.length) return;
  const statement = db.prepare("UPDATE feed_items SET processed_at = ? WHERE id = ?");
  const run = db.transaction((values: number[]) => {
    const stamp = nowIso();
    for (const id of values) statement.run(stamp, id);
  });
  run(ids);
}

/** The feed kind restriction, needed when deciding what an item may match. */
export function feedKinds(db: Db = getDb()): Map<number, MediaKind | "any"> {
  const rows = db.prepare("SELECT id, kind FROM feeds").all() as Row[];
  return new Map(rows.map((row) => [row.id as number, row.kind as MediaKind | "any"]));
}

export function getFeedItem(id: number, db: Db = getDb()): FeedItem | null {
  const row = db.prepare("SELECT * FROM feed_items WHERE id = ?").get(id) as Row | undefined;
  return row ? mapFeedItem(row) : null;
}

export function pruneFeedItems(retentionDays: number, db: Db = getDb()): number {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  return db.prepare("DELETE FROM feed_items WHERE first_seen_at < ?").run(cutoff).changes;
}

/* ------------------------------------------------------------------ */
/* History                                                              */
/* ------------------------------------------------------------------ */

export interface NewHistory {
  mediaId?: number | null;
  episodeId?: number | null;
  feedId?: number | null;
  event: HistoryEvent;
  title?: string | null;
  quality?: string | null;
  reason?: string | null;
  path?: string | null;
  guid?: string | null;
}

export function addHistory(entry: NewHistory, db: Db = getDb()): void {
  db.prepare(
    `INSERT INTO history (media_id, episode_id, feed_id, event, title, quality, reason, path, guid, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.mediaId ?? null,
    entry.episodeId ?? null,
    entry.feedId ?? null,
    entry.event,
    entry.title ?? null,
    entry.quality ?? null,
    entry.reason ?? null,
    entry.path ?? null,
    entry.guid ?? null,
    nowIso(),
  );
}

export function listHistory(
  options: { limit?: number; event?: HistoryEvent; mediaId?: number } = {},
  db: Db = getDb(),
): HistoryRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.event) {
    clauses.push("h.event = ?");
    params.push(options.event);
  }
  if (options.mediaId) {
    clauses.push("h.media_id = ?");
    params.push(options.mediaId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(options.limit ?? 100);
  const rows = db
    .prepare(
      `SELECT h.*, m.title AS media_title, m.kind AS media_kind
       FROM history h LEFT JOIN media m ON m.id = h.media_id
       ${where} ORDER BY h.created_at DESC, h.id DESC LIMIT ?`,
    )
    .all(...params) as Row[];
  return rows.map(mapHistory);
}

/**
 * How many releases were grabbed in the last N days.
 *
 * Compared as ISO strings, which sorts correctly because every timestamp is
 * written by `nowIso()` in the same UTC format.
 */
export function countRecentGrabs(days = 7, db: Db = getDb()): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM history
       WHERE event = 'grabbed'
         AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`,
    )
    .get(`-${days} days`) as Row;
  return (row.total as number) ?? 0;
}

/**
 * Did tvarr itself ask for this release?
 *
 * Used when adopting a torrent client's existing downloads: anything tvarr
 * grabbed is ours to file, however long it has been sitting there.
 *
 * Torrent names and feed titles usually match exactly, but trackers sometimes
 * decorate one or the other, so a punctuation-insensitive comparison backs up
 * the exact match.
 */
export function wasGrabbedByTvarr(releaseName: string, db: Db = getDb()): boolean {
  const trimmed = releaseName.trim();
  if (!trimmed) return false;

  const exact = db
    .prepare("SELECT 1 AS hit FROM history WHERE event = 'grabbed' AND title = ? LIMIT 1")
    .get(trimmed) as Row | undefined;
  if (exact) return true;

  const key = normalizeName(trimmed);
  if (!key) return false;

  const recent = db
    .prepare(
      "SELECT title FROM history WHERE event = 'grabbed' AND title IS NOT NULL ORDER BY id DESC LIMIT 500",
    )
    .all() as Row[];

  return recent.some((row) => normalizeName(String(row.title)) === key);
}

/** Lowercase alphanumerics only, so separators and case cannot disagree. */
function normalizeName(input: string): string {
  return input.toLowerCase().replace(/\.(mkv|mp4|avi|m4v|ts)$/i, "").replace(/[^a-z0-9]+/g, "");
}

/** Guards against grabbing the same release twice across polls. */
export function hasGrabbed(guid: string, db: Db = getDb()): boolean {
  const row = db
    .prepare("SELECT 1 AS hit FROM history WHERE guid = ? AND event = 'grabbed' LIMIT 1")
    .get(guid) as Row | undefined;
  return Boolean(row);
}

/* ------------------------------------------------------------------ */
/* Imports                                                              */
/* ------------------------------------------------------------------ */

export interface ImportRecord {
  id: number;
  sourceKey: string;
  name: string | null;
  path: string | null;
  fileCount: number;
  status: string;
  detail: string | null;
  /** Files written into the library, checked before cleaning up the source. */
  libraryPaths: string[];
  cleanedAt: string | null;
  createdAt: string;
}

function mapImport(row: Row): ImportRecord {
  return {
    id: row.id as number,
    sourceKey: row.source_key as string,
    name: (row.name as string) ?? null,
    path: (row.path as string) ?? null,
    fileCount: (row.file_count as number) ?? 0,
    status: row.status as string,
    detail: (row.detail as string) ?? null,
    libraryPaths: parseJson<string[]>(row.library_paths, []),
    cleanedAt: (row.cleaned_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

/** Keyed by torrent hash, or by path for folder scans. */
export function wasImported(sourceKey: string, db: Db = getDb()): boolean {
  const row = db
    .prepare("SELECT 1 AS hit FROM imports WHERE source_key = ? LIMIT 1")
    .get(sourceKey) as Row | undefined;
  return Boolean(row);
}

export function recordImport(
  entry: {
    sourceKey: string;
    name?: string | null;
    path?: string | null;
    fileCount?: number;
    status: "done" | "failed" | "skipped";
    detail?: string | null;
    libraryPaths?: string[];
  },
  db: Db = getDb(),
): void {
  db.prepare(
    `INSERT INTO imports (source_key, name, path, file_count, status, detail, library_paths, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       file_count    = excluded.file_count,
       status        = excluded.status,
       detail        = excluded.detail,
       library_paths = excluded.library_paths`,
  ).run(
    entry.sourceKey,
    entry.name ?? null,
    entry.path ?? null,
    entry.fileCount ?? 0,
    entry.status,
    entry.detail ?? null,
    JSON.stringify(entry.libraryPaths ?? []),
    nowIso(),
  );
}

/** Imports that succeeded and have not been cleaned up yet. */
export function listCleanupCandidates(db: Db = getDb()): ImportRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM imports
       WHERE status = 'done' AND cleaned_at IS NULL AND file_count > 0
       ORDER BY created_at ASC`,
    )
    .all() as Row[];
  return rows.map(mapImport);
}

export function markImportCleaned(
  sourceKey: string,
  detail: string,
  db: Db = getDb(),
): void {
  db.prepare("UPDATE imports SET cleaned_at = ?, detail = ? WHERE source_key = ?").run(
    nowIso(),
    detail,
    sourceKey,
  );
}

export function listImports(limit = 50, db: Db = getDb()): ImportRecord[] {
  const rows = db
    .prepare("SELECT * FROM imports ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map(mapImport);
}

/** Lets a failed import be retried on the next scan. */
export function forgetImport(sourceKey: string, db: Db = getDb()): void {
  db.prepare("DELETE FROM imports WHERE source_key = ?").run(sourceKey);
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The web UI cannot reach into the daemon's process, so "check now" and
 * friends are queued here and picked up on the daemon's next tick.
 */
export function enqueueJob(
  type: JobType,
  payload: Record<string, unknown> = {},
  db: Db = getDb(),
): number {
  const info = db
    .prepare("INSERT INTO jobs (type, payload, created_at) VALUES (?, ?, ?)")
    .run(type, JSON.stringify(payload), nowIso());
  return Number(info.lastInsertRowid);
}

/** Atomically claim the next pending job so two ticks cannot double-run it. */
export function claimNextJob(db: Db = getDb()): Job | null {
  const claim = db.transaction((): Job | null => {
    const row = db
      .prepare("SELECT * FROM jobs WHERE state = 'pending' ORDER BY id ASC LIMIT 1")
      .get() as Row | undefined;
    if (!row) return null;
    db.prepare("UPDATE jobs SET state = 'running', started_at = ? WHERE id = ?").run(
      nowIso(),
      row.id,
    );
    return mapJob({ ...row, state: "running" });
  });
  return claim();
}

export function finishJob(
  id: number,
  state: "done" | "failed",
  result: string | null,
  db: Db = getDb(),
): void {
  db.prepare("UPDATE jobs SET state = ?, result = ?, finished_at = ? WHERE id = ?").run(
    state,
    result,
    nowIso(),
    id,
  );
}

export function getJob(id: number, db: Db = getDb()): Job | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? mapJob(row) : null;
}

export function pruneJobs(keep = 200, db: Db = getDb()): void {
  db.prepare(
    `DELETE FROM jobs WHERE state IN ('done','failed')
     AND id NOT IN (SELECT id FROM jobs WHERE state IN ('done','failed') ORDER BY id DESC LIMIT ?)`,
  ).run(keep);
}

/** Reset jobs left running by a daemon that was killed mid-flight. */
export function requeueStaleJobs(db: Db = getDb()): number {
  return db
    .prepare("UPDATE jobs SET state = 'pending', started_at = NULL WHERE state = 'running'")
    .run().changes;
}

