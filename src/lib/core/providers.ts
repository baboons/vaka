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

function mapCinemeta(meta: CinemetaMeta): SearchResult {
  return {
    kind: "movie",
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
  return (data.metas ?? []).map(mapCinemeta);
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
