/**
 * Scene release name parser.
 *
 * Feed items arrive as a single string like
 *   "Northwind.S05E03.1080p.WEB-DL.DDP5.1.H.264-NOVA"
 * and every downstream decision (which show, which episode, good enough
 * quality?) is made from what we can pull out of it here.
 */

import {
  RESOLUTIONS,
  type ParsedRelease,
  type Resolution,
  type Source,
} from "./types";

/** Strip punctuation and case so "Nadia's S.T.O.R.M." == "nadiasstorm". */
export function normalizeTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Same as {@link normalizeTitle} but keeps word boundaries, for display. */
export function cleanTitle(input: string): string {
  return input
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–]+|[\s\-–]+$/g, "")
    .trim();
}

const FILE_EXT = /\.(torrent|mkv|mp4|avi|m4v|ts|iso)$/i;

const RESOLUTION_PATTERNS: Array<[Resolution, RegExp]> = [
  ["2160p", /\b(2160p?|4k|uhd|ultra[\s._-]?hd)\b/i],
  ["1080p", /\b1080[pi]\b/i],
  ["720p", /\b720[pi]\b/i],
  ["576p", /\b576[pi]\b/i],
  ["480p", /\b480[pi]\b/i],
];

const SD_PATTERN = /\b(sd|sdtv|dvdrip|dvdscr|vhs|xvid|divx)\b/i;

/*
 * Order matters: the first pattern to match wins, so the pre-retail markers are
 * tested before the generic ones. A cinema rip that also says "1080p" must be
 * recognised as a cinema rip, not waved through as an unknown source.
 */
const SOURCE_PATTERNS: Array<[Source, RegExp]> = [
  ["cam", /\b(cam[\s._-]?rip|hd[\s._-]?cam|hq[\s._-]?cam|camts|cam)\b/i],
  ["telesync", /\b(telesync|hd[\s._-]?ts|ts[\s._-]?rip|pre[\s._-]?dvd|pdvd|ts)\b/i],
  // TeleCine: captured from the film print. Different method to a telesync,
  // same cinema-grade result, and routinely tagged only as "TC".
  ["telecine", /\b(telecine|hd[\s._-]?tc|tc[\s._-]?rip|tc)\b/i],
  ["screener", /\b(dvd[\s._-]?scr|bd[\s._-]?scr|screener|scr|workprint|r5)\b/i],
  ["remux", /\bremux\b/i],
  ["bluray", /\b(blu[\s._-]?ray|bd[\s._-]?rip|br[\s._-]?rip|bdmv|bd25|bd50)\b/i],
  ["webrip", /\bweb[\s._-]?rip\b/i],
  ["webdl", /\b(web[\s._-]?dl|webdl|web)\b/i],
  ["hdtv", /\b(hd[\s._-]?tv|pdtv|dsr|dtv)\b/i],
  ["dvd", /\b(dvd|dvd[\s._-]?r|ntsc|pal)\b/i],
];

const CODEC_PATTERNS: Array<[string, RegExp]> = [
  ["x265", /\b(x265|h[\s._-]?265|hevc)\b/i],
  ["x264", /\b(x264|h[\s._-]?264|avc)\b/i],
  ["av1", /\bav1\b/i],
  ["xvid", /\bxvid\b/i],
  ["divx", /\bdivx\b/i],
];

const HDR_PATTERN = /\b(hdr10\+?|hdr|dolby[\s._-]?vision|dovi|\bdv\b)\b/i;
const REPACK_PATTERN = /\brepack\d?\b/i;
const PROPER_PATTERN = /\bproper\b/i;

/** `S01E02`, `S01E02E03`, `S01E02-E04`, `S01 E02`. */
const SXXEXX = /\bs(\d{1,3})[\s._-]*((?:e\d{1,4}[\s._-]*(?:-[\s._-]*)?)+)/i;
/** `1x02`, `01x02x03`. */
const NxNN = /\b(\d{1,2})x(\d{2,4})((?:[\s._-]*x?\d{2,4})*)\b/i;
/** `Season 1 Episode 2`. */
const VERBOSE = /\bseason[\s._-]*(\d{1,3})[\s._-]*episode[\s._-]*(\d{1,4})\b/i;
/**
 * Season pack: `S01`, `Season 1`, `Series 2` with no episode marker.
 * The bare `s` form requires digits immediately after it so that a movie like
 * "Harbour's 9" is not read as season 9, and the lookahead only rejects a real
 * episode marker (`S03E01`) rather than any following digit (`S03.1080p`).
 */
const SEASON_ONLY =
  /(?:(?<!['’])\bs(\d{1,3})\b|\b(?:season|series)[\s._-]*(\d{1,3})\b)(?![\s._-]*e\d)/i;
/** Daily shows: `2024.01.15`. */
const AIR_DATE = /\b((?:19|20)\d{2})[\s._-](\d{2})[\s._-](\d{2})\b/;
/**
 * A four digit year sitting on its own. Uses lookaround so the surrounding
 * separators stay unconsumed and back-to-back years ("2049 2017") both match.
 */
const YEAR = /(?<=^|[([\s._-])((?:19|20)\d{2})(?=$|[)\]\s._-])/g;

const RELEASE_GROUP = /-([A-Za-z0-9_]{2,20})$/;
const BRACKET_GROUP = /[[{]([A-Za-z0-9_.-]{2,20})[\]}]\s*$/;

function detectResolution(s: string): Resolution {
  for (const [res, pattern] of RESOLUTION_PATTERNS) {
    if (pattern.test(s)) return res;
  }
  return SD_PATTERN.test(s) ? "sd" : "sd";
}

function detectSource(s: string): Source {
  for (const [src, pattern] of SOURCE_PATTERNS) {
    if (pattern.test(s)) return src;
  }
  return "unknown";
}

function detectCodec(s: string): string | null {
  for (const [codec, pattern] of CODEC_PATTERNS) {
    if (pattern.test(s)) return codec;
  }
  return null;
}

/** Expand `E01-E04` into 1,2,3,4; leave explicit `E01E02` lists alone. */
function expandEpisodes(token: string): number[] {
  const numbers = [...token.matchAll(/e?(\d{1,4})/gi)].map((m) => Number(m[1]));
  const isRange = /-/.test(token) && numbers.length === 2;
  if (isRange) {
    const [from, to] = numbers;
    if (to > from && to - from <= 50) {
      return Array.from({ length: to - from + 1 }, (_, i) => from + i);
    }
  }
  return [...new Set(numbers)];
}

/**
 * Find where the title stops and the metadata starts. Everything before the
 * earliest metadata token is the title.
 */
function titleBoundary(s: string, episodeIndex: number | null): number {
  const candidates: number[] = [];
  if (episodeIndex !== null && episodeIndex > 0) candidates.push(episodeIndex);

  for (const [, pattern] of [...RESOLUTION_PATTERNS, ...SOURCE_PATTERNS, ...CODEC_PATTERNS]) {
    const m = new RegExp(pattern.source, "i").exec(s);
    if (m && m.index > 0) candidates.push(m.index);
  }

  const airDate = AIR_DATE.exec(s);
  if (airDate && airDate.index > 0) candidates.push(airDate.index);

  return candidates.length ? Math.min(...candidates) : s.length;
}

/** Pull a trailing year out of the title portion, e.g. "Northwind 2021". */
function extractYear(titlePart: string): { title: string; year: number | null } {
  const matches = [...titlePart.matchAll(YEAR)];
  if (!matches.length) return { title: titlePart, year: null };

  // Prefer the last year — "Skyline 2049 2017" keeps 2017 as the year.
  const last = matches[matches.length - 1];
  const year = Number(last[1]);
  const now = new Date().getUTCFullYear();
  if (year < 1900 || year > now + 2) return { title: titlePart, year: null };

  // Only treat it as metadata when it sits at the end of the title.
  const tail = titlePart.slice(last.index + last[0].length).trim();
  if (tail.length > 0) return { title: titlePart, year: null };

  return { title: titlePart.slice(0, last.index), year };
}

export function parseRelease(raw: string): ParsedRelease {
  const withoutExt = raw.replace(FILE_EXT, "").trim();

  let group: string | null = null;
  const bracketGroup = BRACKET_GROUP.exec(withoutExt);
  if (bracketGroup) group = bracketGroup[1];

  // Work on a space-separated copy so `\b` boundaries behave predictably.
  const s = withoutExt.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();

  if (!group) {
    const trailing = RELEASE_GROUP.exec(s.replace(/\s+/g, ""));
    if (trailing) group = trailing[1];
  }

  let season: number | null = null;
  let episodes: number[] = [];
  let isSeasonPack = false;
  let airDate: string | null = null;
  let episodeIndex: number | null = null;

  const sxe = SXXEXX.exec(s);
  const nxnn = NxNN.exec(s);
  const verbose = VERBOSE.exec(s);
  const daily = AIR_DATE.exec(s);

  if (sxe) {
    season = Number(sxe[1]);
    episodes = expandEpisodes(sxe[2]);
    episodeIndex = sxe.index;
  } else if (verbose) {
    season = Number(verbose[1]);
    episodes = [Number(verbose[2])];
    episodeIndex = verbose.index;
  } else if (nxnn) {
    season = Number(nxnn[1]);
    episodes = expandEpisodes(`${nxnn[2]}${nxnn[3] ?? ""}`);
    episodeIndex = nxnn.index;
  } else {
    const pack = SEASON_ONLY.exec(s);
    if (pack) {
      season = Number(pack[1] ?? pack[2]);
      isSeasonPack = true;
      episodeIndex = pack.index;
    }
  }

  if (daily && !episodes.length) {
    airDate = `${daily[1]}-${daily[2]}-${daily[3]}`;
    // A dated release is episode-like even without an SxxExx marker.
    if (episodeIndex === null) episodeIndex = daily.index;
    isSeasonPack = false;
  }

  const boundary = titleBoundary(s, episodeIndex);
  const rawTitlePart = cleanTitle(s.slice(0, boundary));
  const { title, year } = extractYear(rawTitlePart);
  const finalTitle = cleanTitle(title) || rawTitlePart || s;

  const resolution = detectResolution(s);
  const looksLikeMovie = season === null && !episodes.length && airDate === null;

  return {
    raw,
    title: finalTitle,
    normalizedTitle: normalizeTitle(finalTitle),
    year,
    season,
    episodes,
    isSeasonPack: isSeasonPack && episodes.length === 0,
    airDate,
    resolution,
    source: detectSource(s),
    codec: detectCodec(s),
    hdr: HDR_PATTERN.test(s),
    repack: REPACK_PATTERN.test(s),
    proper: PROPER_PATTERN.test(s),
    group,
    looksLikeMovie,
  };
}

/** Human-readable quality summary, e.g. "1080p WEB-DL x264". */
export function describeQuality(parsed: ParsedRelease): string {
  const parts = [
    RESOLUTIONS.includes(parsed.resolution) && parsed.resolution !== "sd"
      ? parsed.resolution
      : "SD",
    parsed.source !== "unknown" ? parsed.source.toUpperCase() : null,
    parsed.hdr ? "HDR" : null,
  ].filter(Boolean);
  return parts.join(" ");
}
