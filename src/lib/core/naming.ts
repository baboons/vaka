/**
 * Turning a downloaded file into a path Plex understands.
 *
 * Plex infers everything from the path, so the templates below are the whole
 * contract:
 *
 *   TV      /TV/Harbour Lights (2022)/Season 03/Harbour Lights (2022) - S03E01 - Title.mkv
 *   Movies  /Movies/Deep Field Part Two (2024)/Deep Field Part Two (2024).mkv
 *   Sports  /Sports/Title Fight/2026/Title Fight - 2026-08-15 - 330 Barrow.mkv
 *
 * Templates are stored in settings rather than hardcoded, because plenty of
 * libraries have their own long-standing convention and renaming an existing
 * library is not something anyone wants to be forced into.
 */

import path from "node:path";

import type { MediaKind } from "./types";

export interface NamingTemplates {
  /** Folder for the title itself, e.g. "Harbour Lights (2022)". */
  folder: string;
  /** Grouping folder inside the title: "Season 03", or a year for sports. */
  season: string;
  /** File name without extension. */
  file: string;
}

export const PLEX_TV_TEMPLATES: NamingTemplates = {
  folder: "{title} ({year})",
  season: "Season {season:00}",
  file: "{title} ({year}) - S{season:00}E{episode:00} - {episodeTitle}",
};

export const PLEX_MOVIE_TEMPLATES: NamingTemplates = {
  folder: "{title} ({year})",
  season: "",
  file: "{title} ({year})",
};

/**
 * Sports are grouped by competition and then by year.
 *
 * The date leads the file name because that is how anyone scans a folder of
 * events, and because a competition's own titles repeat ("Fight Night") in a
 * way episode titles do not.
 *
 *   /Sports/Title Fight/2026/Title Fight - 2026-08-15 - 330 Barrow vs Ashgrove.mkv
 */
export const PLEX_SPORT_TEMPLATES: NamingTemplates = {
  folder: "{title}",
  season: "{season}",
  file: "{title} - {airDate} - {episodeTitle}",
};

export function defaultTemplates(kind: MediaKind): NamingTemplates {
  if (kind === "tv") return { ...PLEX_TV_TEMPLATES };
  if (kind === "sport") return { ...PLEX_SPORT_TEMPLATES };
  return { ...PLEX_MOVIE_TEMPLATES };
}

export interface NamingValues {
  title: string;
  year?: number | null;
  season?: number | null;
  episode?: number | null;
  /** Multi-episode files render as E01-E02. */
  episodeEnd?: number | null;
  episodeTitle?: string | null;
  /** YYYY-MM-DD. Sports events are identified by when they happened. */
  airDate?: string | null;
  quality?: string | null;
  group?: string | null;
}

/** Characters no common filesystem tolerates, plus the ones Plex dislikes. */
export function sanitizeSegment(input: string, fallback = "Unknown"): string {
  const cleaned = input
    .replace(/[/\\]+/g, " - ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    // A leading or trailing dot breaks Windows shares (which plenty of Plex
    // libraries live on) and hides the file on Unix. Stranded dashes are
    // swept up too, since replacing separators tends to leave them behind.
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .trim();
  return cleaned.slice(0, 180).trim() || fallback;
}

function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, "0");
}

/**
 * Render one template.
 *
 * Tokens: {title} {year} {season} {season:00} {episode} {episode:00}
 *         {episodeTitle} {airDate} {quality} {group}
 *
 * A token with no value collapses, and any separator left stranded by that
 * collapse is tidied up — so a movie with no year yields "Deep Field Part Two", not
 * "Deep Field Part Two ()".
 */
export function renderTemplate(template: string, values: NamingValues): string {
  const rendered = template.replace(
    /\{(\w+)(?::(0+))?\}/g,
    (_match, token: string, padding?: string) => {
      const width = padding?.length ?? 0;

      switch (token) {
        case "title":
          return values.title ?? "";
        case "year":
          return values.year ? String(values.year) : "";
        case "season":
          return values.season === null || values.season === undefined
            ? ""
            : pad(values.season, width);
        case "episode": {
          if (values.episode === null || values.episode === undefined) return "";
          const first = pad(values.episode, width);
          if (values.episodeEnd && values.episodeEnd !== values.episode) {
            return `${first}-E${pad(values.episodeEnd, width)}`;
          }
          return first;
        }
        case "episodeTitle":
          return values.episodeTitle ?? "";
        case "airDate":
          return values.airDate ? values.airDate.slice(0, 10) : "";
        case "quality":
          return values.quality ?? "";
        case "group":
          return values.group ?? "";
        default:
          return "";
      }
    },
  );

  return tidy(rendered);
}

/** Clean up separators orphaned by an empty token. */
function tidy(input: string): string {
  return input
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s*-\s*-\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+-\s*$/g, "")
    .replace(/^\s*-\s+/g, "")
    .trim();
}

export interface DestinationInput {
  kind: MediaKind;
  libraryDir: string;
  templates: NamingTemplates;
  values: NamingValues;
  /** Including the dot, e.g. ".mkv". */
  extension: string;
}

export interface Destination {
  /** Absolute path of the file to create. */
  file: string;
  /** Directory that must exist first. */
  dir: string;
  /** Path relative to the library root, for display. */
  relative: string;
}

/**
 * Build the full destination path.
 *
 * Season folders are part of the path, so they get created along the way —
 * that is all "create Season NN if needed" amounts to.
 */
export function buildDestination(input: DestinationInput): Destination {
  const { kind, templates, values, extension } = input;
  const root = path.resolve(input.libraryDir);

  const segments: string[] = [];

  const folder = sanitizeSegment(renderTemplate(templates.folder, values), values.title);
  if (folder) segments.push(folder);

  // Movies live directly in their own folder; everything else is grouped by
  // season — a year, for a competition.
  if (kind !== "movie" && templates.season && values.season !== null && values.season !== undefined) {
    const season = sanitizeSegment(renderTemplate(templates.season, values), "Season");
    if (season) segments.push(season);
  }

  const base = sanitizeSegment(renderTemplate(templates.file, values), values.title);
  const dir = path.join(root, ...segments);

  return {
    dir,
    file: path.join(dir, `${base}${extension}`),
    relative: path.join(...segments, `${base}${extension}`),
  };
}

/** A preview of what a template would produce, for the settings screen. */
export function previewDestination(
  kind: MediaKind,
  libraryDir: string,
  templates: NamingTemplates,
): string {
  const samples: Record<MediaKind, NamingValues> = {
    tv: {
      title: "Harbour Lights",
      year: 2022,
      season: 3,
      episode: 1,
      episodeTitle: "Low Tide",
      quality: "1080p WEB-DL",
      group: "NOVA",
    },
    movie: {
      title: "Deep Field Part Two",
      year: 2024,
      quality: "2160p WEB-DL",
      group: "ZEPH",
    },
    sport: {
      title: "Title Fight",
      season: 2026,
      episode: 12,
      episodeTitle: "330 Barrow vs Ashgrove",
      airDate: "2026-08-15",
      quality: "1080p WEB-DL",
      group: "ORBIT",
    },
  };

  const roots: Record<MediaKind, string> = {
    tv: "/TV",
    movie: "/Movies",
    sport: "/Sports",
  };

  return buildDestination({
    kind,
    libraryDir: libraryDir || roots[kind],
    templates,
    values: samples[kind],
    extension: ".mkv",
  }).relative;
}
