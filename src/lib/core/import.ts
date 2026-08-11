/**
 * Moving finished downloads into the library.
 *
 * This is the only part of tvarr that touches files it did not create, so the
 * rules are conservative:
 *
 *   - hardlink by default, so the torrent keeps seeding and no bytes are copied
 *   - never overwrite an existing file
 *   - never delete anything the user did not ask to have moved
 *   - every destination is checked to be inside the configured library root
 *
 * `dryRun` produces the full plan without touching the disk, which is what the
 * settings screen previews.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { expandHome, nowIso, type Db } from "./db";
import { buildDestination, type Destination, type NamingTemplates } from "./naming";
import { buildTitleIndex, findMedia } from "./match";
import { describeQuality, parseRelease } from "./parse-release";
import * as repo from "./repo";
import { getConfig } from "./settings";
import type { Episode, Media, MediaKind } from "./types";

const VIDEO_EXTENSIONS = new Set([
  ".mkv",
  ".mp4",
  ".avi",
  ".m4v",
  ".ts",
  ".mov",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".flv",
]);

/** Subtitles travel with their video file. */
const SUBTITLE_EXTENSIONS = new Set([".srt", ".ass", ".ssa", ".sub", ".idx", ".vtt"]);

/** Anything matching this is a trailer or a sample, never the feature. */
const JUNK = /\b(sample|trailer|proof|screens?)\b/i;

export type ImportMode = "hardlink" | "copy" | "move";

export interface ImportPlanItem {
  source: string;
  destination: string;
  /** Relative to the library root, for display. */
  relative: string;
  sizeBytes: number;
  kind: MediaKind;
  mediaId: number;
  mediaTitle: string;
  episodeIds: number[];
  label: string;
  /** Subtitles that will follow the video file. */
  extras: Array<{ source: string; destination: string }>;
}

export interface ImportPlan {
  items: ImportPlanItem[];
  /** Files that were looked at but not imported, with the reason. */
  skipped: Array<{ file: string; reason: string }>;
}

export interface ImportOutcome {
  imported: ImportPlanItem[];
  skipped: Array<{ file: string; reason: string }>;
  failed: Array<{ file: string; reason: string }>;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Every video file under a path, following directories one level at a time. */
async function collectVideoFiles(
  root: string,
  minBytes: number,
): Promise<{ files: Array<{ path: string; size: number }>; skipped: Array<{ file: string; reason: string }> }> {
  const files: Array<{ path: string; size: number }> = [];
  const skipped: Array<{ file: string; reason: string }> = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 6) return;

    let stat;
    try {
      stat = await fs.stat(current);
    } catch {
      return;
    }

    if (stat.isFile()) {
      const extension = path.extname(current).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(extension)) return;
      if (JUNK.test(path.basename(current))) {
        skipped.push({ file: current, reason: "looks like a sample or trailer" });
        return;
      }
      if (stat.size < minBytes) {
        skipped.push({ file: current, reason: "below the minimum file size" });
        return;
      }
      files.push({ path: current, size: stat.size });
      return;
    }

    if (!stat.isDirectory()) return;

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      await walk(path.join(current, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return { files, skipped };
}

/** Subtitle files sitting beside a video, sharing its base name. */
async function findSubtitles(videoPath: string): Promise<string[]> {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .filter((entry) => SUBTITLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .filter((entry) => path.basename(entry.name, path.extname(entry.name)).toLowerCase().startsWith(base))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function templatesFor(kind: MediaKind, db: Db): { templates: NamingTemplates; libraryDir: string } {
  const config = getConfig(db);
  const section = kind === "tv" ? config.tv : config.movies;
  return {
    templates: {
      folder: section.folderTemplate,
      season: section.seasonTemplate,
      file: section.fileTemplate,
    },
    libraryDir: section.libraryDir,
  };
}

/**
 * Work out where each video file under `sourcePath` belongs.
 *
 * The release name is parsed with the same code that decides what to grab, so
 * a file that was downloaded because it matched a show is recognised as that
 * show on the way in.
 */
export async function planImport(
  sourcePath: string,
  db: Db,
  options: { releaseName?: string } = {},
): Promise<ImportPlan> {
  const config = getConfig(db);
  const source = path.resolve(expandHome(sourcePath));
  const minBytes = config.importing.minSizeMb * 1024 * 1024;

  const { files, skipped } = await collectVideoFiles(source, minBytes);
  if (!files.length) {
    return { items: [], skipped: skipped.length ? skipped : [{ file: source, reason: "no video files found" }] };
  }

  const index = buildTitleIndex(repo.listMedia({}, db));
  const items: ImportPlanItem[] = [];

  for (const file of files) {
    // The torrent name is a better description than a file called "01.mkv",
    // but the file name wins when it carries episode numbers of its own.
    const fromFile = parseRelease(path.basename(file.path));
    const fromRelease = options.releaseName ? parseRelease(options.releaseName) : null;
    const parsed =
      fromFile.season !== null || fromFile.episodes.length || !fromRelease ? fromFile : fromRelease;

    const media = findMedia(index, parsed) ?? (fromRelease ? findMedia(index, fromRelease) : null);
    if (!media) {
      skipped.push({ file: file.path, reason: "no followed title matches this file" });
      continue;
    }

    const { templates, libraryDir } = templatesFor(media.kind, db);
    if (!libraryDir.trim()) {
      skipped.push({
        file: file.path,
        reason: `no ${media.kind === "tv" ? "TV" : "movie"} library folder is configured`,
      });
      continue;
    }

    const episodes = media.kind === "tv" ? resolveEpisodes(media, parsed, fromRelease, db) : [];
    if (media.kind === "tv" && !episodes.length) {
      skipped.push({ file: file.path, reason: "could not tell which episode this is" });
      continue;
    }

    const first = episodes[0];
    const destination = buildDestination({
      kind: media.kind,
      libraryDir,
      templates,
      extension: path.extname(file.path).toLowerCase(),
      values: {
        title: media.title,
        year: media.year,
        season: first?.season ?? null,
        episode: first?.number ?? null,
        episodeEnd: episodes.length > 1 ? episodes[episodes.length - 1].number : null,
        episodeTitle: first?.title ?? null,
        quality: describeQuality(parsed),
        group: parsed.group,
      },
    });

    assertInsideRoot(destination, libraryDir);

    const subtitles = await findSubtitles(file.path);
    const extras = subtitles.map((subtitle) => ({
      source: subtitle,
      destination: path.join(
        destination.dir,
        path.basename(destination.file, path.extname(destination.file)) +
          path.extname(subtitle).toLowerCase(),
      ),
    }));

    items.push({
      source: file.path,
      destination: destination.file,
      relative: destination.relative,
      sizeBytes: file.size,
      kind: media.kind,
      mediaId: media.id,
      mediaTitle: media.title,
      episodeIds: episodes.map((episode) => episode.id),
      label:
        media.kind === "tv" && first
          ? `S${String(first.season).padStart(2, "0")}E${String(first.number).padStart(2, "0")}`
          : "Movie",
      extras,
    });
  }

  return { items, skipped };
}

function resolveEpisodes(
  media: Media,
  parsed: ReturnType<typeof parseRelease>,
  fallback: ReturnType<typeof parseRelease> | null,
  db: Db,
): Episode[] {
  const candidates = [parsed, fallback].filter(Boolean) as Array<ReturnType<typeof parseRelease>>;

  for (const candidate of candidates) {
    if (candidate.airDate) {
      const episode = repo.findEpisodeByAirDate(media.id, candidate.airDate, db);
      if (episode) return [episode];
    }
    if (candidate.season === null) continue;

    const seasonEpisodes = repo.listSeasonEpisodes(media.id, candidate.season, db);
    if (!seasonEpisodes.length) continue;

    if (candidate.episodes.length) {
      const matched = seasonEpisodes.filter((episode) => candidate.episodes.includes(episode.number));
      if (matched.length) return matched;
    }
  }
  return [];
}

/** Refuse to write outside the library root, whatever the templates produced. */
function assertInsideRoot(destination: Destination, libraryDir: string): void {
  const root = path.resolve(expandHome(libraryDir));
  const target = path.resolve(destination.file);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new ImportError(`refusing to write outside the library folder: ${target}`);
  }
}

/** Never clobber: add " (2)" and so on until the name is free. */
async function freePath(target: string): Promise<string> {
  const dir = path.dirname(target);
  const extension = path.extname(target);
  const base = path.basename(target, extension);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? target : path.join(dir, `${base} (${attempt})${extension}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new ImportError(`could not find a free name for ${base}`);
}

/**
 * Place one file.
 *
 * A hardlink across filesystems is impossible, so that case falls back to a
 * copy rather than failing — the download and the library often live on
 * different disks.
 */
async function place(source: string, target: string, mode: ImportMode): Promise<ImportMode> {
  if (mode === "move") {
    try {
      await fs.rename(source, target);
      return "move";
    } catch {
      // Cross-device rename fails; copy then remove.
      await fs.copyFile(source, target);
      await fs.rm(source, { force: true });
      return "move";
    }
  }

  if (mode === "hardlink") {
    try {
      await fs.link(source, target);
      return "hardlink";
    } catch {
      await fs.copyFile(source, target);
      return "copy";
    }
  }

  await fs.copyFile(source, target);
  return "copy";
}

/** Execute a plan. With `dryRun`, reports what would happen and writes nothing. */
export async function runImport(
  plan: ImportPlan,
  db: Db,
  options: { dryRun?: boolean } = {},
): Promise<ImportOutcome> {
  const config = getConfig(db);
  const mode = config.importing.mode;
  const outcome: ImportOutcome = { imported: [], skipped: [...plan.skipped], failed: [] };

  for (const item of plan.items) {
    if (options.dryRun) {
      outcome.imported.push(item);
      continue;
    }

    try {
      await fs.mkdir(path.dirname(item.destination), { recursive: true });
      const target = await freePath(item.destination);
      const used = await place(item.source, target, mode);

      for (const extra of item.extras) {
        try {
          await place(extra.source, await freePath(extra.destination), mode);
        } catch {
          // A missing subtitle is not worth failing the import over.
        }
      }

      const stamp = nowIso();
      if (item.kind === "movie") {
        repo.updateMedia(item.mediaId, { state: "done", grabbedAt: stamp }, db);
      } else {
        for (const episodeId of item.episodeIds) {
          repo.updateEpisode(episodeId, { state: "done", grabbedAt: stamp }, db);
        }
      }

      repo.addHistory(
        {
          mediaId: item.mediaId,
          episodeId: item.episodeIds[0] ?? null,
          event: "info",
          title: path.basename(item.source),
          reason: `imported ${item.label} to the library (${used})`,
          path: target,
        },
        db,
      );

      outcome.imported.push({ ...item, destination: target });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      outcome.failed.push({ file: item.source, reason });
      repo.addHistory(
        {
          mediaId: item.mediaId,
          event: "error",
          title: path.basename(item.source),
          reason: `import failed: ${reason}`,
        },
        db,
      );
    }
  }

  return outcome;
}

/** Plan and run in one step. */
export async function importPath(
  sourcePath: string,
  db: Db,
  options: { releaseName?: string; dryRun?: boolean } = {},
): Promise<ImportOutcome> {
  const plan = await planImport(sourcePath, db, { releaseName: options.releaseName });
  return runImport(plan, db, { dryRun: options.dryRun });
}
