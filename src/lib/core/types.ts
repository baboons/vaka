/**
 * Shared domain types for Vaka.
 *
 * A single `media` row models a TV show, a movie or a sports competition;
 * `kind` discriminates. TV shows own `episodes` rows and so do competitions —
 * an event is an episode with a date instead of a number. Movies do not: a
 * movie is wanted as a whole.
 */

export type MediaKind = "tv" | "movie" | "sport";

export const MEDIA_KINDS = ["tv", "movie", "sport"] as const;

/** Singular noun for one entry of a library, for prose in the interface. */
export const KIND_NOUNS: Record<MediaKind, string> = {
  tv: "show",
  movie: "movie",
  sport: "competition",
};

export const KIND_LABELS: Record<MediaKind, string> = {
  tv: "TV shows",
  movie: "Movies",
  sport: "Sports",
};

/** Ordered worst -> best. Index doubles as the ranking score. */
export const RESOLUTIONS = ["sd", "480p", "576p", "720p", "1080p", "2160p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * Ordered worst -> best.
 *
 * The first four are the "pre-retail" family — filmed in a cinema, captured
 * from a print, or an early review copy. They are separate entries because a
 * profile should be able to accept one without the others, but in practice
 * anyone excluding one wants all of them gone.
 */
export const SOURCES = [
  "cam",
  "telesync",
  "telecine",
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
  telecine: "TC",
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
  // Belt and braces alongside the source filter, for anyone who clears it.
  // Safe as whole words: "tc" no longer matches "Catch" or "The Watch".
  bannedWords: ["cam", "hdcam", "telesync", "hdts", "telecine", "tc", "screener"],
  preferredWords: [],
  allowSeasonPacks: false,
};

export const DEFAULT_SPORT_PROFILE: QualityProfile = {
  allowed: ["720p", "1080p"],
  preferred: "1080p",
  // Sport is broadcast once; a better rip of last night's game is not worth
  // the second download, and re-grabbing would fight with the seeding rules.
  upgrade: false,
  sources: [],
  minSeeders: 1,
  maxSizeGb: 0,
  minSizeMb: 0,
  requiredWords: [],
  bannedWords: [],
  preferredWords: [],
  allowSeasonPacks: false,
};

/* ------------------------------------------------------------------ */
/* Sports                                                               */
/* ------------------------------------------------------------------ */

/**
 * Which part of an event a release contains.
 *
 * A single fight card or race weekend is posted several times over — prelims
 * and main card as separate torrents, then highlights, then the weigh-in —
 * and most of those are not what anyone means by "get me the fight". Reading
 * the part out of the name is what stops a 40-minute highlight reel being
 * filed as the event.
 */
export const SPORT_SESSIONS = [
  "full-event",
  "main-card",
  "prelims",
  "early-prelims",
  "race",
  "sprint",
  "qualifying",
  "practice",
  "highlights",
  "extra",
] as const;
export type SportSession = (typeof SPORT_SESSIONS)[number];

export const SESSION_LABELS: Record<SportSession, string> = {
  "full-event": "Full event",
  "main-card": "Main card",
  prelims: "Prelims",
  "early-prelims": "Early prelims",
  race: "Race",
  sprint: "Sprint",
  qualifying: "Qualifying",
  practice: "Practice",
  highlights: "Highlights",
  extra: "Build-up & extras",
};

export const SESSION_HINTS: Record<SportSession, string> = {
  "full-event": "The whole broadcast, however it is labelled",
  "main-card": "Numbered fights, the televised card",
  prelims: "Undercard before the main card",
  "early-prelims": "The first fights of the night",
  race: "The race itself",
  sprint: "Sprint race",
  qualifying: "Qualifying session",
  practice: "Free practice sessions",
  highlights: "Condensed games, extended highlights, recaps",
  extra: "Weigh-ins, press conferences, countdown shows",
};

/** How a competition's events are shaped, which decides how they are named. */
export type SportFormat = "card" | "fixture" | "race";

/**
 * What a release is checked against for one event.
 *
 * Worked out once, when the calendar is synced, and stored on the event row.
 * Deriving it later from a display title would lose the abbreviations and
 * short names that half of all releases actually use.
 */
export interface SportEventMeta {
  /** "UFC 330" -> 330. */
  eventNumber: number | null;
  /** Display names, for showing what the event is. */
  competitors: string[];
  /**
   * One group per subject of the event — the two teams, the two fighters, the
   * circuit. A group matches if a release names it any of its ways, and it is
   * how many *groups* are named that decides confidence.
   */
  identityGroups: string[][];
}

/**
 * A competition someone follows, stored on the media row.
 *
 * `teams` is the difference between following the NHL (1,300 games a season)
 * and following the Bruins. It filters at sync time, so unfollowed fixtures
 * are never written to the database at all.
 */
export interface SportSubscription {
  /** Catalogue entry, e.g. "ufc" or "eng.1". */
  league: string;
  /** Competitor display names. Empty means every event in the competition. */
  teams: string[];
  /** Parts of an event that may be grabbed. */
  sessions: SportSession[];
  /**
   * Grab a release even when the match is only probable.
   *
   * Off by default: sports release names carry no equivalent of `S03E01`, so
   * a middling score means "this is plausibly the right event", and the
   * honest thing to do with a maybe is to show it rather than download it.
   */
  autoGrabUncertain: boolean;
}

export const DEFAULT_SPORT_SUBSCRIPTION: SportSubscription = {
  league: "",
  teams: [],
  sessions: ["full-event"],
  autoGrabUncertain: false,
};

/** Default sessions for a competition, by the shape of its events. */
export function defaultSessions(format: SportFormat): SportSession[] {
  if (format === "card") return ["full-event", "main-card", "prelims"];
  if (format === "race") return ["full-event", "race"];
  return ["full-event"];
}

/** Sessions worth offering for a competition of this shape. */
export function sessionsFor(format: SportFormat): SportSession[] {
  const common: SportSession[] = ["full-event"];
  if (format === "card") {
    return [...common, "main-card", "prelims", "early-prelims", "highlights", "extra"];
  }
  if (format === "race") {
    return [...common, "race", "sprint", "qualifying", "practice", "highlights", "extra"];
  }
  return [...common, "highlights", "extra"];
}

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
  /** Sports only: which competition this is, and which of it to follow. */
  sport: SportSubscription | null;
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
  /** Sports: the season year. */
  season: number;
  number: number;
  title: string | null;
  airDate: string | null;
  runtime: number | null;
  monitored: boolean;
  state: EpisodeState;
  grabbedQuality: string | null;
  grabbedAt: string | null;
  /** Sports only: what a release has to match to be this event. */
  sport: SportEventMeta | null;
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
  | "sync_plex"
  | "import_scan"
  | "sync_sports";

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
