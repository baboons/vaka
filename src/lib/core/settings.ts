/**
 * Application configuration.
 *
 * TV, movies and sports are configured independently — each has its own
 * download folder and its own quality profile — because wanting 4K films but
 * 1080p episodes (or vice versa) is the normal case, not the exception.
 *
 * Stored as a handful of JSON blobs in the `settings` table and validated on
 * read, so a config written by an older version still loads.
 */

import path from "node:path";
import os from "node:os";

import { z } from "zod";

import { getDb, type Db } from "./db";
import { defaultTemplates } from "./naming";
import {
  DEFAULT_MOVIE_PROFILE,
  DEFAULT_SPORT_PROFILE,
  DEFAULT_TV_PROFILE,
  RESOLUTIONS,
  SOURCES,
  type MediaKind,
  type QualityProfile,
} from "./types";

const qualitySchema = z.object({
  allowed: z.array(z.enum(RESOLUTIONS)).default([]),
  preferred: z.enum(RESOLUTIONS).nullable().default(null),
  upgrade: z.boolean().default(false),
  sources: z.array(z.enum(SOURCES)).default([]),
  minSeeders: z.number().int().min(0).default(0),
  maxSizeGb: z.number().min(0).default(0),
  minSizeMb: z.number().min(0).default(0),
  requiredWords: z.array(z.string()).default([]),
  bannedWords: z.array(z.string()).default([]),
  preferredWords: z.array(z.string()).default([]),
  allowSeasonPacks: z.boolean().default(false),
});

/** Per-library settings. One of these for each of TV, movies and sports. */
const kindConfigSchema = z.object({
  /**
   * Blackhole directory watched by the torrent client.
   *
   * `.torrent` files are always written directly here. Torrent clients watch
   * one directory and do not descend into subfolders, so grouping by title
   * would simply mean nothing ever gets picked up.
   */
  downloadDir: z.string().default(""),
  /** Default profile applied to newly added titles. */
  quality: qualitySchema.default(DEFAULT_TV_PROFILE),
  /** Grab episodes/movies that aired before they were added to the library. */
  grabBacklog: z.boolean().default(false),

  /* Where finished downloads are filed, and under what names. */

  /** Plex library root, e.g. /media/TV. Empty disables importing for this kind. */
  libraryDir: z.string().default(""),
  folderTemplate: z.string().default("{title} ({year})"),
  /** Grouping folder inside the title. Unused for movies. */
  seasonTemplate: z.string().default("Season {season:00}"),
  fileTemplate: z.string().default("{title} ({year})"),
});

/**
 * Sports add a calendar to the usual per-library settings.
 *
 * The window is bounded in both directions on purpose: a whole NHL season is
 * 1,300 fixtures, and nobody needs last October's games sitting in the
 * database waiting for a release that will never come.
 */
const sportsConfigSchema = kindConfigSchema.extend({
  /** How far ahead to pull fixtures. */
  lookaheadDays: z.number().int().min(1).max(365).default(60),
  /** How far back to keep looking for a release of something already played. */
  lookbehindDays: z.number().int().min(0).max(365).default(21),
  /** Hours between calendar refreshes. */
  syncIntervalHours: z.number().int().min(1).max(168).default(12),
});

const generalConfigSchema = z.object({
  /** Minutes between feed polls. */
  pollIntervalMinutes: z.number().int().min(1).max(1440).default(15),
  /** Hours between metadata refreshes (new episodes, air dates). */
  refreshIntervalHours: z.number().int().min(1).max(168).default(12),
  /** Delete cached feed items older than this. */
  feedRetentionDays: z.number().int().min(1).max(365).default(14),
  /** Optional: better movie metadata. Without it, iTunes search is used. */
  tmdbApiKey: z.string().default(""),
  /**
   * When a feed only offers a magnet link, write a `.magnet` file next to
   * where the `.torrent` would have gone. Not every client watches for these.
   */
  writeMagnetFiles: z.boolean().default(true),
  /** Wait this long after an item first appears before grabbing it. */
  grabDelayMinutes: z.number().int().min(0).max(1440).default(0),
});

/**
 * Optional Plex server, used to cross off anything you already have.
 *
 * Read-only: Vaka never writes to Plex, it only asks what is on the shelves.
 */
const plexConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Base URL of the server, e.g. http://192.168.1.10:32400 */
  url: z.string().default(""),
  /** X-Plex-Token. */
  token: z.string().default(""),
  /** Minutes between library scans. */
  syncIntervalMinutes: z.number().int().min(5).max(1440).default(60),
});

/**
 * Filing finished downloads into the library.
 *
 * Hardlinking is the default because it costs no disk space and leaves the
 * torrent seeding from the original file; moving breaks seeding, so it has to
 * be chosen deliberately.
 */
const importConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Watched for finished downloads when no torrent client is connected. */
  watchDir: z.string().default(""),
  mode: z.enum(["hardlink", "copy", "move"]).default("hardlink"),
  /** Ignore anything smaller — samples, artwork, stray clips. */
  minSizeMb: z.number().int().min(0).max(100_000).default(50),
  /** Minutes between sweeps of the watch folder. */
  scanIntervalMinutes: z.number().int().min(1).max(1440).default(5),

  /**
   * Retiring a torrent once its seeding obligation is met.
   *
   * With a hardlink the download and the library file are one and the same on
   * disk, so this frees no space — it ends seeding and clears the download
   * folder. It does reclaim space when the hardlink fell back to a copy.
   */
  cleanupEnabled: z.boolean().default(false),
  /** Seed at least this many days. 0 ignores time. */
  cleanupAfterDays: z.number().min(0).max(3650).default(14),
  /** Seed to at least this ratio. 0 ignores ratio. */
  cleanupMinRatio: z.number().min(0).max(1000).default(1),
  /** Require both thresholds rather than whichever comes first. */
  cleanupRequireBoth: z.boolean().default(false),
});

/** Transmission's RPC endpoint, so Vaka knows when a download finished. */
const transmissionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default("http://localhost:9091/transmission/rpc"),
  username: z.string().default(""),
  password: z.string().default(""),
  /**
   * Transmission reports paths as its own process sees them. When Vaka runs
   * elsewhere (a container, another host), rewrite that prefix to the local
   * one — e.g. "/downloads" -> "/mnt/nas/downloads".
   */
  remotePathPrefix: z.string().default(""),
  localPathPrefix: z.string().default(""),
  /** Only import torrents that finished within this window, on first run. */
  importExisting: z.boolean().default(false),
});

export type KindConfig = z.infer<typeof kindConfigSchema>;
export type SportsConfig = z.infer<typeof sportsConfigSchema>;
export type GeneralConfig = z.infer<typeof generalConfigSchema>;
export type PlexConfig = z.infer<typeof plexConfigSchema>;
export type ImportConfig = z.infer<typeof importConfigSchema>;
export type TransmissionConfig = z.infer<typeof transmissionConfigSchema>;

export interface AppConfig {
  tv: KindConfig;
  movies: KindConfig;
  sports: SportsConfig;
  general: GeneralConfig;
  plex: PlexConfig;
  importing: ImportConfig;
  transmission: TransmissionConfig;
}

const DOWNLOAD_FOLDER: Record<MediaKind, string> = {
  tv: "tv",
  movie: "movies",
  sport: "sports",
};

function defaultDownloadDir(kind: MediaKind): string {
  return path.join(os.homedir(), "Downloads", "vaka", DOWNLOAD_FOLDER[kind]);
}

/** The standard Plex layout, until a library scan proposes something else. */
function defaultTemplateFields(kind: MediaKind) {
  const templates = defaultTemplates(kind);
  return {
    folderTemplate: templates.folder,
    seasonTemplate: templates.season,
    fileTemplate: templates.file,
  };
}

export function defaultConfig(): AppConfig {
  return {
    tv: {
      downloadDir: defaultDownloadDir("tv"),
      quality: DEFAULT_TV_PROFILE,
      grabBacklog: false,
      libraryDir: "",
      ...defaultTemplateFields("tv"),
    },
    movies: {
      downloadDir: defaultDownloadDir("movie"),
      quality: DEFAULT_MOVIE_PROFILE,
      grabBacklog: true,
      libraryDir: "",
      ...defaultTemplateFields("movie"),
    },
    sports: {
      downloadDir: defaultDownloadDir("sport"),
      quality: DEFAULT_SPORT_PROFILE,
      // An event that has already happened is exactly what people want; the
      // release always lands after the broadcast.
      grabBacklog: true,
      libraryDir: "",
      ...defaultTemplateFields("sport"),
      lookaheadDays: 60,
      lookbehindDays: 21,
      syncIntervalHours: 12,
    },
    general: generalConfigSchema.parse({}),
    plex: plexConfigSchema.parse({}),
    importing: importConfigSchema.parse({}),
    transmission: transmissionConfigSchema.parse({}),
  };
}

function readRaw(db: Db, key: string): Record<string, unknown> | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Read a settings section, filling gaps from `fallback` rather than from the
 * schema's own defaults.
 *
 * This matters when a field is added in a later version: a config saved before
 * then has no value for it, and the schema default cannot know whether it is
 * being applied to the TV section or the movie one. Merging the caller's
 * kind-correct defaults underneath keeps TV files named as episodes.
 */
function readSection<T>(db: Db, key: string, schema: z.ZodType<T>, fallback: T): T {
  const stored = readRaw(db, key);
  if (!stored) return fallback;

  const merged =
    fallback && typeof fallback === "object"
      ? { ...(fallback as Record<string, unknown>), ...stored }
      : stored;

  const parsed = schema.safeParse(merged);
  return parsed.success ? parsed.data : fallback;
}

function writeSection(db: Db, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}

export function getConfig(db: Db = getDb()): AppConfig {
  const defaults = defaultConfig();
  return {
    tv: readSection(db, "tv", kindConfigSchema, defaults.tv),
    movies: readSection(db, "movies", kindConfigSchema, defaults.movies),
    sports: readSection(db, "sports", sportsConfigSchema, defaults.sports),
    general: readSection(db, "general", generalConfigSchema, defaults.general),
    plex: readSection(db, "plex", plexConfigSchema, defaults.plex),
    importing: readSection(db, "importing", importConfigSchema, defaults.importing),
    transmission: readSection(
      db,
      "transmission",
      transmissionConfigSchema,
      defaults.transmission,
    ),
  };
}

export function savePlexConfig(value: PlexConfig, db: Db = getDb()): void {
  writeSection(db, "plex", plexConfigSchema.parse(value));
}

export function saveImportConfig(value: ImportConfig, db: Db = getDb()): void {
  writeSection(db, "importing", importConfigSchema.parse(value));
}

export function saveTransmissionConfig(value: TransmissionConfig, db: Db = getDb()): void {
  writeSection(db, "transmission", transmissionConfigSchema.parse(value));
}

const SECTION_KEYS: Record<MediaKind, "tv" | "movies" | "sports"> = {
  tv: "tv",
  movie: "movies",
  sport: "sports",
};

/** Config for one library, chosen by kind. */
export function getKindConfig(kind: MediaKind, db: Db = getDb()): KindConfig {
  const config = getConfig(db);
  if (kind === "tv") return config.tv;
  if (kind === "sport") return config.sports;
  return config.movies;
}

export function getSportsConfig(db: Db = getDb()): SportsConfig {
  return getConfig(db).sports;
}

/**
 * Save one library's settings.
 *
 * Sports carry extra fields the shared form knows nothing about, so they are
 * merged back over what is already stored rather than being dropped.
 */
export function saveKindConfig(kind: MediaKind, value: KindConfig, db: Db = getDb()): void {
  if (kind === "sport") {
    const merged = { ...getSportsConfig(db), ...value };
    writeSection(db, "sports", sportsConfigSchema.parse(merged));
    return;
  }
  writeSection(db, SECTION_KEYS[kind], kindConfigSchema.parse(value));
}

export function saveSportsConfig(value: SportsConfig, db: Db = getDb()): void {
  writeSection(db, "sports", sportsConfigSchema.parse(value));
}

export function saveGeneralConfig(value: GeneralConfig, db: Db = getDb()): void {
  writeSection(db, "general", generalConfigSchema.parse(value));
}

export function defaultProfileFor(kind: MediaKind, db: Db = getDb()): QualityProfile {
  return getKindConfig(kind, db).quality;
}

export function parseQualityProfile(input: unknown): QualityProfile {
  const parsed = qualitySchema.safeParse(input);
  return parsed.success ? parsed.data : { ...DEFAULT_TV_PROFILE };
}

export {
  qualitySchema,
  kindConfigSchema,
  sportsConfigSchema,
  generalConfigSchema,
  plexConfigSchema,
  importConfigSchema,
  transmissionConfigSchema,
};

/* ------------------------------------------------------------------ */
/* Plex sync state                                                      */
/* ------------------------------------------------------------------ */

const plexStateSchema = z.object({
  lastSyncAt: z.string().nullable().default(null),
  lastStatus: z.enum(["ok", "error"]).nullable().default(null),
  lastError: z.string().nullable().default(null),
  serverName: z.string().nullable().default(null),
  /** Counts from the last successful sync, for the settings screen. */
  matchedTitles: z.number().int().default(0),
  markedEpisodes: z.number().int().default(0),
  markedMovies: z.number().int().default(0),
});

export type PlexState = z.infer<typeof plexStateSchema>;

export function getPlexState(db: Db = getDb()): PlexState {
  return readSection(db, "plexState", plexStateSchema, plexStateSchema.parse({}));
}

export function savePlexState(patch: Partial<PlexState>, db: Db = getDb()): void {
  writeSection(db, "plexState", { ...getPlexState(db), ...patch });
}

/* ------------------------------------------------------------------ */
/* Watcher heartbeat                                                    */
/* ------------------------------------------------------------------ */

const workerStateSchema = z.object({
  pid: z.number().int().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  heartbeatAt: z.string().nullable().default(null),
  lastPollAt: z.string().nullable().default(null),
  nextPollAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
});

export type WorkerState = z.infer<typeof workerStateSchema>;

export function getWorkerState(db: Db = getDb()): WorkerState {
  return readSection(db, "worker", workerStateSchema, workerStateSchema.parse({}));
}

export function saveWorkerState(patch: Partial<WorkerState>, db: Db = getDb()): void {
  const current = getWorkerState(db);
  writeSection(db, "worker", { ...current, ...patch });
}

/** The daemon beats every 30s, so anything older than 90s is considered down. */
export function isWorkerOnline(state: WorkerState, staleSeconds = 90): boolean {
  if (!state.heartbeatAt) return false;
  const age = Date.now() - new Date(state.heartbeatAt).getTime();
  return Number.isFinite(age) && age < staleSeconds * 1000;
}
