/**
 * Discovery lists for the dashboard: what is popular now, and what is coming.
 *
 * Everything here is cached in SQLite, because the dashboard re-renders on a
 * timer and these are the only external calls it makes.
 *
 * TV comes from Cinemeta's IMDb-backed popularity rather than TVmaze's own
 * ranking — TVmaze ranks by what is airing, which surfaces soaps and talk
 * shows rather than anything you would want to follow.
 */

import { cached } from "./cache";
import { getDb, type Db } from "./db";
import { normalizeTitle } from "./parse-release";
import * as providers from "./providers";
import * as repo from "./repo";
import { getConfig } from "./settings";
import type { Media, MediaKind } from "./types";

/** Popular lists move slowly; premieres barely move at all. */
const POPULAR_TTL = 6 * 60 * 60;
const UPCOMING_TTL = 12 * 60 * 60;

const MAX_ITEMS = 18;

export interface DiscoverList {
  kind: MediaKind;
  items: providers.SearchResult[];
  /** Set when a provider failed and this came from an expired cache entry. */
  stale: boolean;
  /** Explains an empty list, e.g. a missing TMDB key. */
  note: string | null;
}

export interface DiscoverData {
  popular: DiscoverList[];
  upcoming: DiscoverList[];
}

/**
 * Whether something is already in the library.
 *
 * Discovery and the library can name the same title through different
 * providers — a series is discovered by IMDb id but tracked by TVmaze id — so
 * this compares external ids first and falls back to title and year.
 */
export function findTracked(
  item: providers.SearchResult,
  library: Media[],
): Media | null {
  const itemImdb = item.imdbId ?? (item.providerId.startsWith("tt") ? item.providerId : null);

  return library.find((media) => {
    if (media.kind !== item.kind) return false;

    if (media.provider === item.provider && media.providerId === item.providerId) return true;
    if (itemImdb && media.imdbId === itemImdb) return true;
    if (itemImdb && media.provider === "cinemeta" && media.providerId === itemImdb) return true;
    if (item.tvdbId && media.tvdbId === item.tvdbId) return true;

    if (normalizeTitle(media.title) === normalizeTitle(item.title)) {
      if (!media.year || !item.year) return true;
      return Math.abs(media.year - item.year) <= 1;
    }
    return false;
  }) ?? null;
}

export function isTracked(item: providers.SearchResult, library: Media[]): boolean {
  return findTracked(item, library) !== null;
}

/** Full details for a title that is not in the library, cached for a day. */
export async function getPreview(
  kind: MediaKind,
  provider: string,
  providerId: string,
  db: Db = getDb(),
): Promise<providers.TitleDetails> {
  const tmdbKey = getConfig(db).general.tmdbApiKey.trim();
  const result = await cached(
    `preview:${kind}:${provider}:${providerId}`,
    24 * 60 * 60,
    () => providers.getTitleDetails(kind, provider, providerId, tmdbKey),
    db,
  );
  return result.value;
}

async function list(
  kind: MediaKind,
  key: string,
  ttl: number,
  load: () => Promise<providers.SearchResult[]>,
  library: Media[],
  db: Db,
): Promise<DiscoverList> {
  try {
    const result = await cached(key, ttl, load, db);
    return {
      kind,
      items: result.value.filter((item) => !isTracked(item, library)).slice(0, MAX_ITEMS),
      stale: result.stale,
      note: null,
    };
  } catch (error) {
    return {
      kind,
      items: [],
      stale: false,
      note: error instanceof Error ? error.message : "Could not load this list",
    };
  }
}

/** Everything the discovery section needs, in one call. */
export async function getDiscoverData(db: Db = getDb()): Promise<DiscoverData> {
  const config = getConfig(db);
  const tmdbKey = config.general.tmdbApiKey.trim();
  const library = repo.listMedia({}, db);

  const [popularTv, popularMovies, upcomingTv, upcomingMovies] = await Promise.all([
    list("tv", "discover:popular:tv", POPULAR_TTL, () => providers.cinemetaCatalog("tv", "top"), library, db),

    list(
      "movie",
      tmdbKey ? "discover:popular:movie:tmdb" : "discover:popular:movie",
      POPULAR_TTL,
      () =>
        tmdbKey
          ? providers.tmdbList("movie/popular", tmdbKey)
          : providers.cinemetaCatalog("movie", "top"),
      library,
      db,
    ),

    list("tv", "discover:upcoming:tv", UPCOMING_TTL, () => providers.upcomingPremieres(30), library, db),

    tmdbKey
      ? list(
          "movie",
          "discover:upcoming:movie:tmdb",
          UPCOMING_TTL,
          () => providers.tmdbList("movie/upcoming", tmdbKey),
          library,
          db,
        )
      : // Cinemeta has no release calendar, so without a TMDB key the best
        // available answer is what has just landed, labelled as such.
        list(
          "movie",
          "discover:new:movie",
          UPCOMING_TTL,
          () => providers.cinemetaCatalog("movie", "year"),
          library,
          db,
        ),
  ]);

  return {
    popular: [popularTv, popularMovies],
    upcoming: [upcomingTv, upcomingMovies],
  };
}

/** True when the movie column shows genuine release dates rather than new arrivals. */
export function hasMovieCalendar(db: Db = getDb()): boolean {
  return Boolean(getConfig(db).general.tmdbApiKey.trim());
}
