/**
 * Turning a downloaded file into a path Plex understands.
 *
 * Plex infers everything from the path, so the templates below are the whole
 * contract:
 *
 *   TV      /TV/The Bear (2022)/Season 03/The Bear (2022) - S03E01 - Title.mkv
 *   Movies  /Movies/Dune Part Two (2024)/Dune Part Two (2024).mkv
 *
 * Templates are stored in settings rather than hardcoded, because plenty of
 * libraries have their own long-standing convention and renaming an existing
 * library is not something anyone wants to be forced into.
 */

import path from "node:path";

import type { MediaKind } from "./types";

export interface NamingTemplates {
  /** Folder for the title itself, e.g. "The Bear (2022)". */
  folder: string;
  /** TV only, e.g. "Season 03". */
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

export function defaultTemplates(kind: MediaKind): NamingTemplates {
  return kind === "tv" ? { ...PLEX_TV_TEMPLATES } : { ...PLEX_MOVIE_TEMPLATES };
}

export interface NamingValues {
  title: string;
  year?: number | null;
  season?: number | null;
  episode?: number | null;
  /** Multi-episode files render as E01-E02. */
  episodeEnd?: number | null;
  episodeTitle?: string | null;
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
 *         {episodeTitle} {quality} {group}
 *
 * A token with no value collapses, and any separator left stranded by that
 * collapse is tidied up — so a movie with no year yields "Dune Part Two", not
 * "Dune Part Two ()".
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

  if (kind === "tv" && templates.season && values.season !== null && values.season !== undefined) {
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
  const values: NamingValues =
    kind === "tv"
      ? {
          title: "The Bear",
          year: 2022,
          season: 3,
          episode: 1,
          episodeTitle: "Tomorrow",
          quality: "1080p WEB-DL",
          group: "NTb",
        }
      : {
          title: "Dune Part Two",
          year: 2024,
          quality: "2160p WEB-DL",
          group: "FLUX",
        };

  return buildDestination({
    kind,
    libraryDir: libraryDir || (kind === "tv" ? "/TV" : "/Movies"),
    templates,
    values,
    extension: ".mkv",
  }).relative;
}
