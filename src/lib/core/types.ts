/**
 * Shared domain types for tvarr.
 *
 * A single `media` row models both a TV show and a movie; `kind` discriminates.
 * TV shows own `episodes` rows, movies do not — a movie is wanted as a whole.
 */

export type MediaKind = "tv" | "movie";

/** Ordered worst -> best. Index doubles as the ranking score. */
export const RESOLUTIONS = ["sd", "480p", "576p", "720p", "1080p", "2160p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Ordered worst -> best. */
export const SOURCES = [
  "cam",
  "telesync",
  "screener",
  "dvd",
  "hdtv",
  "webrip",
  "webdl",
  "bluray",
  "remux",
  "unknown",
] as const;
export type Source = (typeof SOURCES)[number];

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  sd: "SD",
  "480p": "480p",
  "576p": "576p",
  "720p": "720p (HD)",
  "1080p": "1080p (Full HD)",
  "2160p": "2160p (4K)",
};

export const SOURCE_LABELS: Record<Source, string> = {
  cam: "CAM",
  telesync: "TS",
  screener: "Screener",
  dvd: "DVD",
  hdtv: "HDTV",
  webrip: "WEBRip",
  webdl: "WEB-DL",
  bluray: "BluRay",
  remux: "Remux",
  unknown: "Unknown",
};

/**
 * What the user is willing to download, and what they'd rather have.
 * Stored as JSON on each media row so a single show can deviate from the
 * per-kind default without affecting anything else.
 */
export interface QualityProfile {
  /** Resolutions that may be grabbed. Empty means "anything". */
  allowed: Resolution[];
  /** Target resolution. Used for upgrade decisions and scoring ties. */
  preferred: Resolution | null;
  /** Keep grabbing better releases until `preferred` is reached. */
  upgrade: boolean;
  /** Allowed sources. Empty means "anything". */
  sources: Source[];
  /** Reject anything below this seeder count (0 disables the check). */
  minSeeders: number;
  /** Reject releases larger than this, in GB (0 disables the check). */
  maxSizeGb: number;
  /** Reject releases smaller than this, in MB (0 disables the check). */
  minSizeMb: number;
  /** Release title must contain all of these (case-insensitive). */
  requiredWords: string[];
  /** Release title must contain none of these (case-insensitive). */
  bannedWords: string[];
  /** Scoring bonus, e.g. a favourite release group. */
  preferredWords: string[];
  /** For TV: allow grabbing a whole-season torrent. */
  allowSeasonPacks: boolean;
}

export const DEFAULT_TV_PROFILE: QualityProfile = {
  allowed: ["720p", "1080p"],
  preferred: "1080p",
  upgrade: false,
  sources: [],
  minSeeders: 1,
  maxSizeGb: 0,
  minSizeMb: 0,
  requiredWords: [],
  bannedWords: ["cam", "hdcam", "telesync"],
  preferredWords: [],
  allowSeasonPacks: false,
};

export const DEFAULT_MOVIE_PROFILE: QualityProfile = {
  allowed: ["1080p", "2160p"],
  preferred: "1080p",
  upgrade: false,
  sources: ["webdl", "bluray", "remux", "webrip"],
  minSeeders: 3,
  maxSizeGb: 0,
  minSizeMb: 0,
  requiredWords: [],
  bannedWords: ["cam", "hdcam", "telesync", "hdts", "screener"],
  preferredWords: [],
  allowSeasonPacks: false,
};

/** Everything the parser can pull out of a scene-style release name. */
export interface ParsedRelease {
  /** Raw release title, unchanged. */
  raw: string;
  /** Title portion, cleaned of separators. */
  title: string;
  /** Lowercased, punctuation-stripped title for comparisons. */
  normalizedTitle: string;
  year: number | null;
  season: number | null;
  /** Episode numbers found. Multi-episode releases yield more than one. */
  episodes: number[];
  /** Season pack: a season was found but no episode numbers. */
  isSeasonPack: boolean;
  /** Date-based release, e.g. a nightly talk show. */
  airDate: string | null;
  resolution: Resolution;
  source: Source;
  codec: string | null;
  hdr: boolean;
  repack: boolean;
  proper: boolean;
  group: string | null;
  /** True when nothing episode-like was found, so it may be a movie. */
  looksLikeMovie: boolean;
}

export type MediaState = "wanted" | "grabbed" | "done" | "ignored";
export type EpisodeState = "wanted" | "grabbed" | "done" | "skipped";

export interface Media {
  id: number;
  kind: MediaKind;
  provider: string;
  providerId: string;
  imdbId: string | null;
  tvdbId: string | null;
  title: string;
  sortTitle: string;
  year: number | null;
  overview: string | null;
  poster: string | null;
  status: string | null;
  network: string | null;
  runtime: number | null;
  genres: string[];
  monitored: boolean;
  quality: QualityProfile;
  /** Extra titles to match against, e.g. a localized or shortened name. */
  searchTerms: string[];
  /** Overrides the destination folder derived from settings. */
  folder: string | null;
  /** Movies only; TV progress lives on the episode rows. */
  state: MediaState;
  grabbedQuality: string | null;
  grabbedAt: string | null;
  releaseDate: string | null;
  addedAt: string;
  refreshedAt: string | null;
}

export interface Episode {
  id: number;
  mediaId: number;
  providerId: string | null;
  season: number;
  number: number;
  title: string | null;
  airDate: string | null;
  runtime: number | null;
  monitored: boolean;
  state: EpisodeState;
  grabbedQuality: string | null;
  grabbedAt: string | null;
}

export interface Feed {
  id: number;
  name: string;
  url: string;
  /** Restricts which library a feed's items may match. */
  kind: MediaKind | "any";
  enabled: boolean;
  lastCheckedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  itemCount: number;
  createdAt: string;
}

/** One entry from an RSS feed, normalized across the formats in the wild. */
export interface FeedItem {
  id?: number;
  feedId: number;
  guid: string;
  title: string;
  /** .torrent URL, when the feed offers one. */
  link: string | null;
  magnet: string | null;
  publishedAt: string | null;
  sizeBytes: number | null;
  seeders: number | null;
  leechers: number | null;
  firstSeenAt?: string;
}

export type HistoryEvent = "grabbed" | "rejected" | "error" | "info";

export interface HistoryRow {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
  feedId: number | null;
  event: HistoryEvent;
  title: string | null;
  quality: string | null;
  reason: string | null;
  path: string | null;
  guid: string | null;
  createdAt: string;
  /** Joined for display. */
  mediaTitle?: string | null;
  mediaKind?: MediaKind | null;
}

export type JobType =
  | "poll_feeds"
  | "refresh_media"
  | "refresh_all"
  | "search_media"
  | "grab_item"
  | "sync_plex";

export type JobState = "pending" | "running" | "done" | "failed";

export interface Job {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  state: JobState;
  result: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Result of testing one feed item against one library entry. */
export interface MatchDecision {
  ok: boolean;
  reason: string;
  score: number;
}
