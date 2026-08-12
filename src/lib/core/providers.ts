/**
 * Metadata providers.
 *
 * TV comes from TVmaze, which needs no API key and exposes full episode lists
 * with air dates — exactly what the watcher needs to know what to expect.
 *
 * Movies come from TMDB when an API key is configured, and otherwise from
 * Cinemeta, a keyless IMDb-backed catalogue. That keeps the app usable out of
 * the box while allowing better data for anyone who wants it.
 */

import type { MediaKind } from "./types";

const TVMAZE = "https://api.tvmaze.com";
const TMDB = "https://api.themoviedb.org/3";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w342";
const CINEMETA = "https://v3-cinemeta.strem.io";

const REQUEST_TIMEOUT_MS = 12_000;

export interface SearchResult {
  kind: MediaKind;
  provider: "tvmaze" | "tmdb" | "cinemeta";
  providerId: string;
  title: string;
  year: number | null;
  overview: string | null;
  poster: string | null;
  status: string | null;
  network: string | null;
  runtime: number | null;
  genres: string[];
  imdbId: string | null;
  tvdbId: string | null;
  releaseDate: string | null;
  /** Discovery only: why this is in the list, e.g. "Season 4". */
  note?: string | null;
}

export interface ProviderEpisode {
  providerId: string;
  season: number;
  number: number;
  title: string | null;
  airDate: string | null;
  runtime: number | null;
}

class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "tvarr/1.0" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProviderError(`request failed: ${reason}`);
  }
  if (!response.ok) {
    throw new ProviderError(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/** TVmaze summaries are HTML fragments. */
function stripHtml(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  return text || null;
}

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(String(date).slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
}

/* ------------------------------------------------------------------ */
/* TV — TVmaze                                                          */
/* ------------------------------------------------------------------ */

interface TvmazeShow {
  id: number;
  name: string;
  premiered: string | null;
  ended: string | null;
  language: string | null;
  weight: number | null;
  status: string | null;
  runtime: number | null;
  averageRuntime: number | null;
  genres: string[];
  summary: string | null;
  image: { medium?: string; original?: string } | null;
  network: { name: string } | null;
  webChannel: { name: string } | null;
  externals: { imdb?: string | null; thetvdb?: number | null } | null;
}

function mapShow(show: TvmazeShow): SearchResult {
  return {
    kind: "tv",
    provider: "tvmaze",
    providerId: String(show.id),
    title: show.name,
    year: yearOf(show.premiered),
    overview: stripHtml(show.summary),
    poster: show.image?.original ?? show.image?.medium ?? null,
    status: show.status ?? null,
    network: show.network?.name ?? show.webChannel?.name ?? null,
    runtime: show.averageRuntime ?? show.runtime ?? null,
    genres: show.genres ?? [],
    imdbId: show.externals?.imdb ?? null,
    tvdbId: show.externals?.thetvdb ? String(show.externals.thetvdb) : null,
    releaseDate: show.premiered ?? null,
  };
}

export async function searchTv(query: string): Promise<SearchResult[]> {
  const results = await fetchJson<Array<{ score: number; show: TvmazeShow }>>(
    `${TVMAZE}/search/shows?q=${encodeURIComponent(query)}`,
  );
  return results.map((entry) => mapShow(entry.show));
}

export async function getTvShow(providerId: string): Promise<SearchResult> {
  const show = await fetchJson<TvmazeShow>(`${TVMAZE}/shows/${encodeURIComponent(providerId)}`);
  return mapShow(show);
}

interface TvmazeEpisode {
  id: number;
  name: string | null;
  season: number | null;
  number: number | null;
  airdate: string | null;
  airstamp: string | null;
  runtime: number | null;
  type?: string;
}

export async function getTvEpisodes(providerId: string): Promise<ProviderEpisode[]> {
  const episodes = await fetchJson<TvmazeEpisode[]>(
    `${TVMAZE}/shows/${encodeURIComponent(providerId)}/episodes`,
  );
  return episodes
    // Specials have no episode number and are not tracked.
    .filter((episode) => episode.season !== null && episode.number !== null)
    .map((episode) => ({
      providerId: String(episode.id),
      season: episode.season as number,
      number: episode.number as number,
      title: episode.name,
      airDate: episode.airstamp ?? (episode.airdate ? `${episode.airdate}T00:00:00.000Z` : null),
      runtime: episode.runtime,
    }));
}

/* ------------------------------------------------------------------ */
/* Movies — TMDB (with key) or iTunes (without)                         */
/* ------------------------------------------------------------------ */

interface TmdbMovie {
  id: number;
  title: string;
  release_date: string | null;
  overview: string | null;
  poster_path: string | null;
  genres?: Array<{ name: string }>;
  genre_ids?: number[];
  runtime?: number | null;
  imdb_id?: string | null;
  status?: string | null;
}

function mapTmdb(movie: TmdbMovie): SearchResult {
  return {
    kind: "movie",
    provider: "tmdb",
    providerId: String(movie.id),
    title: movie.title,
    year: yearOf(movie.release_date),
    overview: movie.overview || null,
    poster: movie.poster_path ? `${TMDB_IMAGE}${movie.poster_path}` : null,
    status: movie.status ?? null,
    network: null,
    runtime: movie.runtime ?? null,
    genres: movie.genres?.map((g) => g.name) ?? [],
    imdbId: movie.imdb_id ?? null,
    tvdbId: null,
    releaseDate: movie.release_date ?? null,
  };
}

/**
 * Cinemeta is Stremio's public catalogue. It is keyed by IMDb id, needs no
 * credentials, and its search results are deliberately sparse — the detail
 * endpoint fills in the rest when a title is actually added.
 */
interface CinemetaMeta {
  id: string;
  imdb_id?: string;
  name: string;
  type: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  year?: string;
  released?: string;
  runtime?: string;
  genres?: string[];
  popularity?: number;
  imdbRating?: string | number;
  country?: string;
}

/** Release info arrives as "2024", "2011–2019" or occasionally "2019–". */
function yearFromInfo(value: string | undefined): number | null {
  if (!value) return null;
  const match = /(\d{4})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  return year > 1800 ? year : null;
}

/** Runtime arrives as "167 min". */
function runtimeFromText(value: string | undefined): number | null {
  if (!value) return null;
  const match = /(\d+)/.exec(value);
  return match ? Number(match[1]) : null;
}

function mapCinemeta(meta: CinemetaMeta, kind: MediaKind = "movie"): SearchResult {
  return {
    kind,
    provider: "cinemeta",
    providerId: meta.id,
    title: meta.name,
    year: yearFromInfo(meta.year ?? meta.releaseInfo ?? meta.released),
    overview: meta.description ?? null,
    poster: meta.poster ?? null,
    status: null,
    network: null,
    runtime: runtimeFromText(meta.runtime),
    genres: meta.genres ?? [],
    imdbId: meta.imdb_id ?? (meta.id.startsWith("tt") ? meta.id : null),
    tvdbId: null,
    releaseDate: meta.released ? meta.released.slice(0, 10) : null,
  };
}

export async function searchMovies(query: string, tmdbApiKey?: string): Promise<SearchResult[]> {
  if (tmdbApiKey?.trim()) {
    const data = await fetchJson<{ results: TmdbMovie[] }>(
      `${TMDB}/search/movie?api_key=${encodeURIComponent(tmdbApiKey.trim())}&query=${encodeURIComponent(query)}&include_adult=false`,
    );
    return data.results.map(mapTmdb);
  }

  const data = await fetchJson<{ metas: CinemetaMeta[] }>(
    `${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(query)}.json`,
  );
  // Not point-free: map would pass the index in as `kind`.
  return (data.metas ?? []).map((meta) => mapCinemeta(meta));
}

export async function getMovie(
  provider: string,
  providerId: string,
  tmdbApiKey?: string,
): Promise<SearchResult> {
  if (provider === "tmdb") {
    if (!tmdbApiKey?.trim()) throw new ProviderError("TMDB API key is not configured");
    const movie = await fetchJson<TmdbMovie>(
      `${TMDB}/movie/${encodeURIComponent(providerId)}?api_key=${encodeURIComponent(tmdbApiKey.trim())}`,
    );
    return mapTmdb(movie);
  }

  const data = await fetchJson<{ meta: CinemetaMeta }>(
    `${CINEMETA}/meta/movie/${encodeURIComponent(providerId)}.json`,
  );
  if (!data.meta) throw new ProviderError(`movie ${providerId} not found`);
  return mapCinemeta(data.meta);
}

/* ------------------------------------------------------------------ */
/* Discovery                                                            */
/* ------------------------------------------------------------------ */

/**
 * A Cinemeta catalog: `top` is what is popular now, `year` is newly released.
 * Keyless, IMDb-backed, and available for both films and series.
 */
export async function cinemetaCatalog(
  kind: MediaKind,
  catalog: "top" | "year",
): Promise<SearchResult[]> {
  const type = kind === "tv" ? "series" : "movie";
  const data = await fetchJson<{ metas: CinemetaMeta[] }>(
    `${CINEMETA}/catalog/${type}/${catalog}.json`,
  );

  const metas = data.metas ?? [];

  /*
   * The "new" catalogue is returned in release order, which buries the films
   * anyone has heard of under a long tail of tiny releases. It carries
   * popularity and an IMDb rating, so rank by those; a rating on its own is
   * not enough, since a 9.2 from eleven votes outranks a blockbuster.
   *
   * The "top" catalogue is already a popularity ranking and carries neither
   * field, so this leaves its order untouched.
   */
  const ranked = [...metas].sort((a, b) => {
    const byPopularity = (b.popularity ?? 0) - (a.popularity ?? 0);
    if (byPopularity !== 0) return byPopularity;
    return Number(b.imdbRating ?? 0) - Number(a.imdbRating ?? 0);
  });

  return ranked.map((meta) => mapCinemeta(meta, kind));
}

/**
 * Resolve an IMDb id to the TVmaze show.
 *
 * Discovery lists series by IMDb id, but tvarr tracks TV through TVmaze
 * because that is where the episode lists come from. TVmaze answers this
 * lookup with a 301 to the show, which fetch follows.
 */
export async function resolveTvByImdb(imdbId: string): Promise<SearchResult> {
  const show = await fetchJson<TvmazeShow>(
    `${TVMAZE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`,
  );
  if (!show?.id) throw new ProviderError(`no TVmaze entry for ${imdbId}`);
  return mapShow(show);
}

interface TvmazeScheduleEntry {
  season: number | null;
  number: number | null;
  airdate: string | null;
  airstamp: string | null;
  _embedded?: { show?: TvmazeShow };
}

/** Below this, TVmaze's popularity weight means almost nobody is watching. */
const MIN_PREMIERE_WEIGHT = 50;

/**
 * Premieres from today onwards — new series and returning seasons alike.
 *
 * TVmaze has no "upcoming shows" endpoint, so this reads the full future
 * schedule. Two decisions shape the result:
 *
 *   - Every first episode counts, not only first-episode-of-first-season. A
 *     new season of a big show is exactly what someone browsing "coming soon"
 *     wants, and the card says which season it is.
 *   - The list is ranked by TVmaze's popularity weight *before* being cut, then
 *     put back in date order. Cutting by date alone fills the row with local
 *     magazine shows that happen to air tomorrow.
 */
export async function upcomingPremieres(limit = 20): Promise<SearchResult[]> {
  const schedule = await fetchJson<TvmazeScheduleEntry[]>(`${TVMAZE}/schedule/full`);
  const today = new Date().toISOString().slice(0, 10);

  const premieres = schedule.filter((entry) => {
    const show = entry._embedded?.show;
    if (!show?.id || !show.image) return false;
    if (entry.number !== 1 || entry.season === null) return false;
    if (!entry.airdate || entry.airdate < today) return false;
    if ((show.weight ?? 0) < MIN_PREMIERE_WEIGHT) return false;
    // The full schedule spans every country; without this the list is mostly
    // shows nobody reading an English interface is looking for.
    return show.language === "English";
  });

  // Earliest premiere per show, so a show does not appear twice.
  const earliest = new Map<number, TvmazeScheduleEntry>();
  for (const entry of premieres) {
    const show = entry._embedded!.show!;
    const held = earliest.get(show.id);
    if (!held || (entry.airdate ?? "") < (held.airdate ?? "")) earliest.set(show.id, entry);
  }

  const ranked = [...earliest.values()]
    .sort((a, b) => (b._embedded!.show!.weight ?? 0) - (a._embedded!.show!.weight ?? 0))
    .slice(0, limit)
    .sort((a, b) => (a.airdate ?? "").localeCompare(b.airdate ?? ""));

  return ranked.map((entry) => {
    const show = entry._embedded!.show!;
    return {
      ...mapShow(show),
      // The premiere date is more useful here than the show's own metadata.
      releaseDate: entry.airdate ?? null,
      note: entry.season === 1 ? "New series" : `Season ${entry.season}`,
    };
  });
}

export interface SeasonSummary {
  season: number;
  episodes: number;
  firstAired: string | null;
  lastAired: string | null;
}

export interface TitleDetails extends SearchResult {
  /** TV only, from the episode list. */
  seasons: number | null;
  episodeCount: number | null;
  seasonBreakdown: SeasonSummary[];
  /** First aired / released, when known. */
  firstAired: string | null;
}

/**
 * Full metadata for something that is not in the library yet.
 *
 * Discovery lists are deliberately sparse — Cinemeta's catalogue omits
 * descriptions — so the preview screen asks the provider for the real record,
 * resolving a discovered series to TVmaze on the way.
 */
export async function getTitleDetails(
  kind: MediaKind,
  provider: string,
  providerId: string,
  tmdbApiKey?: string,
): Promise<TitleDetails> {
  if (kind === "movie") {
    const movie = await getMovie(provider, providerId, tmdbApiKey);
    return {
      ...movie,
      seasons: null,
      episodeCount: null,
      seasonBreakdown: [],
      firstAired: movie.releaseDate,
    };
  }

  const resolvedId =
    provider === "tvmaze" ? providerId : (await resolveTvByImdb(providerId)).providerId;

  const [show, episodes] = await Promise.all([
    getTvShow(resolvedId),
    // A missing episode list should not cost us the whole page.
    getTvEpisodes(resolvedId).catch(() => []),
  ]);

  const bySeason = new Map<number, SeasonSummary>();
  for (const episode of episodes) {
    const entry = bySeason.get(episode.season) ?? {
      season: episode.season,
      episodes: 0,
      firstAired: null,
      lastAired: null,
    };
    entry.episodes += 1;
    if (episode.airDate) {
      if (!entry.firstAired || episode.airDate < entry.firstAired) entry.firstAired = episode.airDate;
      if (!entry.lastAired || episode.airDate > entry.lastAired) entry.lastAired = episode.airDate;
    }
    bySeason.set(episode.season, entry);
  }

  const seasonBreakdown = [...bySeason.values()].sort((a, b) => a.season - b.season);

  return {
    ...show,
    seasons: seasonBreakdown.length || null,
    episodeCount: episodes.length || null,
    seasonBreakdown,
    firstAired: show.releaseDate,
  };
}

export async function tmdbList(
  path: "movie/popular" | "movie/upcoming",
  tmdbApiKey: string,
): Promise<SearchResult[]> {
  const data = await fetchJson<{ results: TmdbMovie[] }>(
    `${TMDB}/${path}?api_key=${encodeURIComponent(tmdbApiKey.trim())}&include_adult=false`,
  );
  return data.results.map(mapTmdb);
}

export async function search(
  kind: MediaKind,
  query: string,
  tmdbApiKey?: string,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return kind === "tv" ? searchTv(trimmed) : searchMovies(trimmed, tmdbApiKey);
}

/** Re-fetch metadata for an existing library entry. */
export async function refreshMetadata(
  kind: MediaKind,
  provider: string,
  providerId: string,
  tmdbApiKey?: string,
): Promise<SearchResult> {
  return kind === "tv"
    ? getTvShow(providerId)
    : getMovie(provider, providerId, tmdbApiKey);
}

export { ProviderError };
