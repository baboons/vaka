/**
 * Application configuration.
 *
 * TV and movies are configured independently — each has its own download
 * folder and its own quality profile — because wanting 4K films but 1080p
 * episodes (or vice versa) is the normal case, not the exception.
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

/** Per-library settings. One of these for TV, one for movies. */
const kindConfigSchema = z.object({
  /** Blackhole directory watched by the torrent client. */
  downloadDir: z.string().default(""),
  /** Put each title in its own subfolder inside `downloadDir`. */
  createFolders: z.boolean().default(false),
  /** Default profile applied to newly added titles. */
  quality: qualitySchema.default(DEFAULT_TV_PROFILE),
  /** Grab episodes/movies that aired before they were added to the library. */
  grabBacklog: z.boolean().default(false),

  /* Where finished downloads are filed, and under what names. */

  /** Plex library root, e.g. /media/TV. Empty disables importing for this kind. */
  libraryDir: z.string().default(""),
  folderTemplate: z.string().default("{title} ({year})"),
  /** TV only. */
  seasonTemplate: z.string().default("Season {season:00}"),
  fileTemplate: z.string().default("{title} ({year})"),
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
 * Read-only: tvarr never writes to Plex, it only asks what is on the shelves.
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
});

/** Transmission's RPC endpoint, so tvarr knows when a download finished. */
const transmissionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default("http://localhost:9091/transmission/rpc"),
  username: z.string().default(""),
  password: z.string().default(""),
  /**
   * Transmission reports paths as its own process sees them. When tvarr runs
   * elsewhere (a container, another host), rewrite that prefix to the local
   * one — e.g. "/downloads" -> "/mnt/nas/downloads".
   */
  remotePathPrefix: z.string().default(""),
  localPathPrefix: z.string().default(""),
  /** Only import torrents that finished within this window, on first run. */
  importExisting: z.boolean().default(false),
});

export type KindConfig = z.infer<typeof kindConfigSchema>;
export type GeneralConfig = z.infer<typeof generalConfigSchema>;
export type PlexConfig = z.infer<typeof plexConfigSchema>;
export type ImportConfig = z.infer<typeof importConfigSchema>;
export type TransmissionConfig = z.infer<typeof transmissionConfigSchema>;

export interface AppConfig {
  tv: KindConfig;
  movies: KindConfig;
  general: GeneralConfig;
  plex: PlexConfig;
  importing: ImportConfig;
  transmission: TransmissionConfig;
}

function defaultDownloadDir(kind: MediaKind): string {
  return path.join(os.homedir(), "Downloads", "tvarr", kind === "tv" ? "tv" : "movies");
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
      createFolders: true,
      quality: DEFAULT_TV_PROFILE,
      grabBacklog: false,
      libraryDir: "",
      ...defaultTemplateFields("tv"),
    },
    movies: {
      downloadDir: defaultDownloadDir("movie"),
      createFolders: false,
      quality: DEFAULT_MOVIE_PROFILE,
      grabBacklog: true,
      libraryDir: "",
      ...defaultTemplateFields("movie"),
    },
    general: generalConfigSchema.parse({}),
    plex: plexConfigSchema.parse({}),
    importing: importConfigSchema.parse({}),
    transmission: transmissionConfigSchema.parse({}),
  };
}

function readSection<T>(db: Db, key: string, schema: z.ZodType<T>, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
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

/** Config for one library, chosen by kind. */
export function getKindConfig(kind: MediaKind, db: Db = getDb()): KindConfig {
  const config = getConfig(db);
  return kind === "tv" ? config.tv : config.movies;
}

export function saveKindConfig(kind: MediaKind, value: KindConfig, db: Db = getDb()): void {
  writeSection(db, kind === "tv" ? "tv" : "movies", kindConfigSchema.parse(value));
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
