/**
 * Reading an existing library and working out the convention it already uses.
 *
 * Imposing tvarr's defaults on a library someone has curated for years is the
 * wrong default, so the settings screen scans what is there and proposes
 * templates that match it. The user still decides.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { expandHome } from "./db";
import { defaultTemplates, type NamingTemplates } from "./naming";
import type { MediaKind } from "./types";

/** Enough to characterise a library without walking a 10,000-file tree. */
const MAX_TITLE_DIRS = 60;

/**
 * A width of 1 means the library writes "Season 1", which is a plain token —
 * only wider forms need an explicit padding spec.
 */
function seasonToken(width: number): string {
  return width > 1 ? `{season:${"0".repeat(width)}}` : "{season}";
}

const SEASON_PATTERNS: Array<{ regex: RegExp; template: (width: number) => string }> = [
  { regex: /^season\s+(\d+)$/i, template: (w) => `Season ${seasonToken(w)}` },
  { regex: /^s(\d+)$/i, template: (w) => `S${seasonToken(w)}` },
  { regex: /^series\s+(\d+)$/i, template: (w) => `Series ${seasonToken(w)}` },
];

const YEAR_IN_FOLDER = /\((19|20)\d{2}\)\s*$/;

export interface LibraryReport {
  kind: MediaKind;
  /** Absolute path that was scanned. */
  dir: string;
  exists: boolean;
  /** Why the scan produced nothing useful. */
  problem: string | null;
  titleCount: number;
  /** Examples, for showing the user what was read. */
  samples: string[];
  /** How many title folders carry "(YYYY)". */
  withYear: number;
  /** TV only: season folder styles that were found. */
  seasonStyles: Array<{ example: string; count: number }>;
  /** Movies only: files sitting loose in the root rather than in a folder. */
  looseFiles: number;
  /** What tvarr suggests based on the above. */
  proposed: NamingTemplates;
  /** Plain-English summary of what was found. */
  summary: string;
}

async function listDirectory(dir: string) {
  return fs.readdir(dir, { withFileTypes: true });
}

/**
 * Inspect a library root and propose templates that match what is already
 * there. Never writes anything.
 */
export async function inspectLibrary(
  kind: MediaKind,
  libraryDir: string,
): Promise<LibraryReport> {
  const dir = path.resolve(expandHome((libraryDir ?? "").trim() || "."));
  const base: LibraryReport = {
    kind,
    dir,
    exists: false,
    problem: null,
    titleCount: 0,
    samples: [],
    withYear: 0,
    seasonStyles: [],
    looseFiles: 0,
    proposed: defaultTemplates(kind),
    summary: "",
  };

  if (!libraryDir?.trim()) {
    return { ...base, problem: "No library folder is set yet.", summary: "" };
  }

  let entries;
  try {
    entries = await listDirectory(dir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...base, problem: reason, summary: "" };
  }

  base.exists = true;

  const titleDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .slice(0, MAX_TITLE_DIRS);

  base.looseFiles = entries.filter(
    (entry) => entry.isFile() && /\.(mkv|mp4|avi|m4v|ts|mov|wmv)$/i.test(entry.name),
  ).length;

  base.titleCount = titleDirs.length;
  base.samples = titleDirs.slice(0, 5).map((entry) => entry.name);
  base.withYear = titleDirs.filter((entry) => YEAR_IN_FOLDER.test(entry.name)).length;

  if (kind === "tv") {
    const styles = new Map<string, { example: string; count: number; width: number; template: string }>();

    for (const titleDir of titleDirs) {
      let children;
      try {
        children = await listDirectory(path.join(dir, titleDir.name));
      } catch {
        continue;
      }

      for (const child of children) {
        if (!child.isDirectory()) continue;
        for (const { regex, template } of SEASON_PATTERNS) {
          const match = regex.exec(child.name);
          if (!match) continue;
          // "Season 1" and "Season 01" are different conventions.
          const width = match[1].length;
          const key = `${regex.source}:${width}`;
          const existing = styles.get(key);
          if (existing) existing.count += 1;
          else
            styles.set(key, {
              example: child.name,
              count: 1,
              width,
              template: template(width),
            });
          break;
        }
      }
    }

    const ranked = [...styles.values()].sort((a, b) => b.count - a.count);
    base.seasonStyles = ranked.map(({ example, count }) => ({ example, count }));

    if (ranked.length) base.proposed.season = ranked[0].template;
  }

  // A library that never writes the year in folder names should keep not
  // writing it — Plex matches either way.
  const yearIsUsual = base.titleCount > 0 && base.withYear >= Math.ceil(base.titleCount / 2);
  if (!yearIsUsual && base.titleCount >= 3) {
    base.proposed.folder = "{title}";
    base.proposed.file =
      kind === "tv" ? "{title} - S{season:00}E{episode:00} - {episodeTitle}" : "{title}";
  }

  base.summary = describe(base);
  return base;
}

function describe(report: LibraryReport): string {
  if (!report.titleCount && !report.looseFiles) {
    return "The folder is empty, so tvarr will use the standard Plex layout.";
  }

  const parts: string[] = [];
  parts.push(
    `Found ${report.titleCount} folder${report.titleCount === 1 ? "" : "s"}${
      report.looseFiles ? ` and ${report.looseFiles} loose video file(s)` : ""
    }.`,
  );

  if (report.titleCount) {
    parts.push(
      report.withYear >= Math.ceil(report.titleCount / 2)
        ? "Most folders include the year, so new ones will too."
        : "Folders here do not include the year, so tvarr will leave it out.",
    );
  }

  if (report.kind === "tv") {
    if (report.seasonStyles.length) {
      const [top] = report.seasonStyles;
      parts.push(`Seasons are named like “${top.example}”, which is what tvarr will create.`);
      if (report.seasonStyles.length > 1) {
        parts.push(
          `Other styles are also present (${report.seasonStyles
            .slice(1)
            .map((style) => `“${style.example}”`)
            .join(", ")}); the most common one wins.`,
        );
      }
    } else {
      parts.push("No season folders were found, so the standard “Season 01” will be used.");
    }
  }

  if (report.kind === "movie" && report.looseFiles > report.titleCount) {
    parts.push("Films sit directly in the folder here, but tvarr always makes a folder per film — that is what Plex expects.");
  }

  return parts.join(" ");
}
