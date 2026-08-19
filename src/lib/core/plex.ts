/**
 * Plex integration.
 *
 * Strictly read-only: Vaka asks a Plex server what is already on the shelves
 * and crosses those episodes and films off, so the watcher stops looking for
 * things you own. Nothing is ever written back to Plex.
 *
 * Sync only ever marks items as *had*. It never marks something wanted again,
 * because a Plex server that is briefly unreachable, mid-scan, or missing a
 * drive would otherwise trigger a mass re-download.
 */

import { nowIso, type Db } from "./db";
import { normalizeTitle } from "./parse-release";
import * as repo from "./repo";
import { getConfig, savePlexState, type PlexConfig } from "./settings";
import type { Media, Resolution } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;
/** Plex pages large sections; this is the window size we ask for. */
const PAGE_SIZE = 500;

export class PlexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlexError";
  }
}

/** Accepts "10.0.1.5:32400" as readily as a full URL. */
export function normalizePlexUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

interface PlexRequestOptions {
  params?: Record<string, string | number>;
  range?: { start: number; size: number };
}

async function plexFetch<T>(
  config: PlexConfig,
  pathname: string,
  options: PlexRequestOptions = {},
): Promise<T> {
  const base = normalizePlexUrl(config.url);
  if (!base) throw new PlexError("No Plex server URL configured");
  if (!config.token.trim()) throw new PlexError("No Plex token configured");

  const url = new URL(pathname, base);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "X-Plex-Token": config.token.trim(),
    "X-Plex-Client-Identifier": "vaka",
    "X-Plex-Product": "Vaka",
  };
  if (options.range) {
    headers["X-Plex-Container-Start"] = String(options.range.start);
    headers["X-Plex-Container-Size"] = String(options.range.size);
  }

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PlexError(`could not reach ${base} — ${reason}`);
  }

  if (response.status === 401) {
    throw new PlexError("Plex rejected the token (401). Check X-Plex-Token.");
  }
  if (!response.ok) {
    throw new PlexError(`Plex returned ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  if (!body.trim()) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    // A JSON accept header is honoured by every supported Plex version; XML
    // back means we are talking to something else entirely.
    throw new PlexError("Plex did not return JSON — is that URL really a Plex server?");
  }
}

/* ------------------------------------------------------------------ */
/* Plex payloads                                                        */
/* ------------------------------------------------------------------ */

interface PlexGuid {
  id?: string;
}

interface PlexMedia {
  videoResolution?: string;
  height?: number;
}

interface PlexMetadata {
  ratingKey?: string;
  title?: string;
  year?: number;
  guid?: string;
  Guid?: PlexGuid[];
  Media?: PlexMedia[];
  /** Episodes only. */
  index?: number;
  parentIndex?: number;
  grandparentRatingKey?: string;
}

interface PlexContainer {
  MediaContainer?: {
    friendlyName?: string;
    size?: number;
    totalSize?: number;
    Directory?: Array<{ key?: string; type?: string; title?: string }>;
    Metadata?: PlexMetadata[];
  };
}

export interface PlexSection {
  key: string;
  type: "movie" | "show";
  title: string;
}

export async function getSections(config: PlexConfig): Promise<PlexSection[]> {
  const data = await plexFetch<PlexContainer>(config, "/library/sections");
  const directories = data.MediaContainer?.Directory ?? [];
  return directories
    .filter((entry) => entry.type === "movie" || entry.type === "show")
    .map((entry) => ({
      key: String(entry.key),
      type: entry.type as "movie" | "show",
      title: entry.title ?? "Library",
    }));
}

export interface PlexServerInfo {
  name: string;
  sections: PlexSection[];
}

export async function testConnection(config: PlexConfig): Promise<PlexServerInfo> {
  const root = await plexFetch<PlexContainer>(config, "/");
  const sections = await getSections(config);
  return { name: root.MediaContainer?.friendlyName ?? "Plex", sections };
}

/** Fetch a whole section, following Plex's paging. */
async function fetchAll(
  config: PlexConfig,
  pathname: string,
  params: Record<string, string | number>,
): Promise<PlexMetadata[]> {
  const items: PlexMetadata[] = [];

  for (let start = 0; ; start += PAGE_SIZE) {
    const data = await plexFetch<PlexContainer>(config, pathname, {
      params,
      range: { start, size: PAGE_SIZE },
    });
    const page = data.MediaContainer?.Metadata ?? [];
    items.push(...page);

    const total = data.MediaContainer?.totalSize ?? data.MediaContainer?.size ?? items.length;
    if (page.length < PAGE_SIZE || items.length >= total) break;
    // Defensive stop; no real library needs this many pages.
    if (start > 100_000) break;
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

interface ExternalIds {
  imdb?: string;
  tmdb?: string;
  tvdb?: string;
}

/**
 * Pull external ids out of a Plex item.
 *
 * Modern Plex exposes a `Guid` array (`imdb://tt0903747`); the older agents
 * put a single value in `guid` (`com.plexapp.agents.thetvdb://81189/1/1`).
 */
export function externalIds(item: PlexMetadata): ExternalIds {
  const candidates = [...(item.Guid ?? []).map((guid) => guid.id ?? ""), item.guid ?? ""];
  const ids: ExternalIds = {};

  for (const value of candidates) {
    if (!value) continue;
    const imdb = /imdb:\/\/(tt\d+)/i.exec(value);
    if (imdb) ids.imdb = imdb[1];
    const tmdb = /(?:themoviedb|tmdb):\/\/(\d+)/i.exec(value);
    if (tmdb) ids.tmdb = tmdb[1];
    const tvdb = /(?:thetvdb|tvdb):\/\/(\d+)/i.exec(value);
    if (tvdb) ids.tvdb = tvdb[1];
  }

  return ids;
}

function resolutionOf(item: PlexMetadata): Resolution | null {
  const raw = item.Media?.[0]?.videoResolution?.toLowerCase();
  const height = item.Media?.[0]?.height;

  if (raw) {
    if (raw === "4k" || raw === "2160") return "2160p";
    if (raw === "1080") return "1080p";
    if (raw === "720") return "720p";
    if (raw === "576") return "576p";
    if (raw === "480") return "480p";
    if (raw === "sd") return "sd";
  }
  if (typeof height === "number") {
    if (height >= 1800) return "2160p";
    if (height >= 900) return "1080p";
    if (height >= 700) return "720p";
    if (height >= 550) return "576p";
    if (height >= 400) return "480p";
    return "sd";
  }
  return null;
}

/** What gets stored on the row, e.g. "1080p · Plex". */
function qualityLabel(item: PlexMetadata): string {
  const resolution = resolutionOf(item);
  return resolution ? `${resolution} · Plex` : "in Plex";
}

/**
 * Index the library for lookup by external id first, then title.
 *
 * IDs are authoritative; the title fallback exists because Plex libraries
 * built by the old agents, or matched by hand, often carry no usable id.
 */
function buildIndex(library: Media[]) {
  const byId = new Map<string, Media>();
  const byTitle = new Map<string, Media[]>();

  for (const media of library) {
    if (media.imdbId) byId.set(`imdb:${media.imdbId}`, media);
    if (media.tvdbId) byId.set(`tvdb:${media.tvdbId}`, media);
    if (media.provider === "tmdb") byId.set(`tmdb:${media.providerId}`, media);
    // Cinemeta keys its catalogue by IMDb id.
    if (media.provider === "cinemeta" && media.providerId.startsWith("tt")) {
      byId.set(`imdb:${media.providerId}`, media);
    }

    const key = normalizeTitle(media.title);
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(media);
    else byTitle.set(key, [media]);
  }

  return { byId, byTitle };
}

export function matchPlexItem(
  item: PlexMetadata,
  index: ReturnType<typeof buildIndex>,
): Media | null {
  const ids = externalIds(item);

  for (const [source, value] of [
    ["imdb", ids.imdb],
    ["tvdb", ids.tvdb],
    ["tmdb", ids.tmdb],
  ] as const) {
    if (!value) continue;
    const hit = index.byId.get(`${source}:${value}`);
    if (hit) return hit;
  }

  const candidates = index.byTitle.get(normalizeTitle(item.title ?? ""));
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];

  // Same title more than once — the year decides.
  if (item.year) {
    const exact = candidates.find((media) => media.year === item.year);
    if (exact) return exact;
    const close = candidates.find(
      (media) => media.year !== null && Math.abs(media.year - item.year!) <= 1,
    );
    if (close) return close;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Sync                                                                 */
/* ------------------------------------------------------------------ */

export interface PlexSyncSummary {
  matchedTitles: number;
  markedMovies: number;
  markedEpisodes: number;
  sections: number;
  serverName: string;
}

/**
 * Scan Plex and mark everything it already holds as had.
 *
 * `mediaId` limits the scan to a single title, which is what happens right
 * after you add something — the back catalogue is usually already on the
 * shelf, and there is no point downloading it again.
 */
export async function syncPlex(
  options: { mediaId?: number } = {},
  db?: Db,
): Promise<PlexSyncSummary> {
  const config = getConfig(db);
  if (!config.plex.enabled) throw new PlexError("Plex sync is turned off");

  const server = await testConnection(config.plex);
  const summary: PlexSyncSummary = {
    matchedTitles: 0,
    markedMovies: 0,
    markedEpisodes: 0,
    sections: server.sections.length,
    serverName: server.name,
  };

  const library = options.mediaId
    ? [repo.getMedia(options.mediaId, db)].filter((media): media is Media => Boolean(media))
    : repo.listMedia({}, db);

  if (!library.length) return summary;

  // Competitions are excluded: Plex has no notion of a followed league, and
  // leaving one in the index would let it shadow a show of the same name.
  const index = buildIndex(library.filter((media) => media.kind !== "sport"));
  const wantsMovies = library.some((media) => media.kind === "movie");
  const wantsShows = library.some((media) => media.kind === "tv");

  for (const section of server.sections) {
    if (section.type === "movie" && !wantsMovies) continue;
    if (section.type === "show" && !wantsShows) continue;

    if (section.type === "movie") {
      const movies = await fetchAll(config.plex, `/library/sections/${section.key}/all`, {
        type: 1,
        includeGuids: 1,
      });

      for (const item of movies) {
        const media = matchPlexItem(item, index);
        if (!media || media.kind !== "movie") continue;
        summary.matchedTitles += 1;
        if (media.state === "done") continue;

        repo.updateMedia(
          media.id,
          { state: "done", grabbedQuality: qualityLabel(item), grabbedAt: nowIso() },
          db,
        );
        repo.addHistory(
          {
            mediaId: media.id,
            event: "info",
            title: media.title,
            quality: qualityLabel(item),
            reason: "already in Plex — will not be downloaded again",
          },
          db,
        );
        summary.markedMovies += 1;
      }
      continue;
    }

    const shows = await fetchAll(config.plex, `/library/sections/${section.key}/all`, {
      type: 2,
      includeGuids: 1,
    });

    for (const show of shows) {
      const media = matchPlexItem(show, index);
      if (!media || media.kind !== "tv" || !show.ratingKey) continue;
      summary.matchedTitles += 1;

      // One request per matched show beats pulling every episode in the
      // section, since Vaka usually follows a handful of the shows there.
      const episodes = await fetchAll(
        config.plex,
        `/library/metadata/${show.ratingKey}/allLeaves`,
        {},
      );

      let marked = 0;
      for (const episode of episodes) {
        if (typeof episode.parentIndex !== "number" || typeof episode.index !== "number") continue;

        const known = repo.findEpisode(media.id, episode.parentIndex, episode.index, db);
        if (!known || known.state === "done") continue;

        repo.updateEpisode(
          known.id,
          { state: "done", grabbedQuality: qualityLabel(episode), grabbedAt: nowIso() },
          db,
        );
        marked += 1;
      }

      if (marked > 0) {
        repo.addHistory(
          {
            mediaId: media.id,
            event: "info",
            title: media.title,
            reason: `already in Plex — crossed off ${marked} episode${marked === 1 ? "" : "s"}`,
          },
          db,
        );
      }
      summary.markedEpisodes += marked;
    }
  }

  savePlexState(
    {
      lastSyncAt: nowIso(),
      lastStatus: "ok",
      lastError: null,
      serverName: server.name,
      matchedTitles: summary.matchedTitles,
      markedEpisodes: summary.markedEpisodes,
      markedMovies: summary.markedMovies,
    },
    db,
  );

  return summary;
}

/** Wrapper that records failures for the settings screen. */
export async function syncPlexSafely(
  options: { mediaId?: number } = {},
  db?: Db,
): Promise<{ ok: boolean; message: string; summary?: PlexSyncSummary }> {
  try {
    const summary = await syncPlex(options, db);
    return {
      ok: true,
      message:
        summary.markedMovies + summary.markedEpisodes > 0
          ? `Crossed off ${summary.markedEpisodes} episode(s) and ${summary.markedMovies} movie(s) already in Plex`
          : "Plex is in sync — nothing new to cross off",
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    savePlexState({ lastSyncAt: nowIso(), lastStatus: "error", lastError: message }, db);
    return { ok: false, message };
  }
}
