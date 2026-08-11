/**
 * Deciding whether a feed item is something we want.
 *
 * Kept free of database access so the rules can be tested in isolation: the
 * caller supplies the library, these functions answer "which title is this?"
 * and "is this good enough?".
 */

import { normalizeTitle } from "./parse-release";
import {
  RESOLUTIONS,
  SOURCES,
  type Episode,
  type FeedItem,
  type MatchDecision,
  type Media,
  type ParsedRelease,
  type QualityProfile,
  type Resolution,
} from "./types";

export function resolutionRank(resolution: Resolution): number {
  return RESOLUTIONS.indexOf(resolution);
}

export function sourceRank(source: string): number {
  const index = SOURCES.indexOf(source as (typeof SOURCES)[number]);
  return index < 0 ? 0 : index;
}

/** Title variants a release might use for this entry. */
export function titleKeys(media: Pick<Media, "title" | "year" | "searchTerms">): string[] {
  const keys = new Set<string>();
  const base = normalizeTitle(media.title);
  if (base) keys.add(base);
  if (media.year) {
    keys.add(`${base}${media.year}`);
    const withoutYear = normalizeTitle(media.title.replace(/\(?\b(19|20)\d{2}\)?/g, ""));
    if (withoutYear) keys.add(withoutYear);
  }
  for (const term of media.searchTerms ?? []) {
    const normalized = normalizeTitle(term);
    if (normalized) keys.add(normalized);
  }
  return [...keys];
}

/** Lookup table from every known title variant to the entries using it. */
export function buildTitleIndex(library: Media[]): Map<string, Media[]> {
  const index = new Map<string, Media[]>();
  for (const media of library) {
    for (const key of titleKeys(media)) {
      const bucket = index.get(key);
      if (bucket) bucket.push(media);
      else index.set(key, [media]);
    }
  }
  return index;
}

/**
 * Resolve a parsed release to a library entry.
 *
 * The release title is matched exactly against the normalized index — fuzzy
 * matching sounds helpful but grabs the wrong show often enough to be a
 * liability, so an unknown title is simply skipped.
 */
export function findMedia(
  index: Map<string, Media[]>,
  parsed: ParsedRelease,
): Media | null {
  const candidates = new Set<Media>();

  const direct = index.get(parsed.normalizedTitle);
  if (direct) direct.forEach((m) => candidates.add(m));

  // The parser splits a trailing year off the title; a show whose canonical
  // name includes that year ("Doctor Who 2005") is indexed under both.
  if (parsed.year) {
    const withYear = index.get(`${parsed.normalizedTitle}${parsed.year}`);
    if (withYear) withYear.forEach((m) => candidates.add(m));
  }

  if (!candidates.size) return null;

  const list = [...candidates];

  // A release carrying season/episode markers belongs to a show, and one
  // without them to a movie. This is what keeps "Fargo" the film apart from
  // "Fargo" the series when both are in the library.
  const wantedKind = parsed.looksLikeMovie ? "movie" : "tv";
  const byKind = list.filter((m) => m.kind === wantedKind);
  const pool = byKind.length ? byKind : list;

  if (pool.length === 1) return pool[0];

  // Several entries share a title — use the year to disambiguate.
  if (parsed.year) {
    const exact = pool.find((m) => m.year === parsed.year);
    if (exact) return exact;
    const close = pool.find((m) => m.year !== null && Math.abs(m.year - parsed.year!) <= 1);
    if (close) return close;
  }

  return pool[0];
}

function containsWord(haystack: string, word: string): boolean {
  const needle = word.trim().toLowerCase();
  if (!needle) return false;
  // Compare on a separator-normalized string so "web dl" matches "WEB-DL".
  const normalized = haystack.toLowerCase().replace(/[._-]+/g, " ");
  return normalized.includes(needle.replace(/[._-]+/g, " "));
}

/**
 * Apply a quality profile to a release. Returns why it was rejected so the
 * activity log can explain what the watcher is doing.
 */
export function evaluateQuality(
  profile: QualityProfile,
  parsed: ParsedRelease,
  item: Pick<FeedItem, "seeders" | "sizeBytes">,
): MatchDecision {
  const title = parsed.raw;

  for (const banned of profile.bannedWords) {
    if (containsWord(title, banned)) {
      return { ok: false, reason: `contains banned word "${banned}"`, score: 0 };
    }
  }

  for (const required of profile.requiredWords) {
    if (!containsWord(title, required)) {
      return { ok: false, reason: `missing required word "${required}"`, score: 0 };
    }
  }

  if (profile.allowed.length && !profile.allowed.includes(parsed.resolution)) {
    return {
      ok: false,
      reason: `${parsed.resolution} is not an accepted quality`,
      score: 0,
    };
  }

  // An unrecognised source is allowed through: plenty of feeds use sloppy
  // names, and resolution is the filter that actually matters.
  if (
    profile.sources.length &&
    parsed.source !== "unknown" &&
    !profile.sources.includes(parsed.source)
  ) {
    return { ok: false, reason: `source ${parsed.source} is not accepted`, score: 0 };
  }

  if (profile.minSeeders > 0 && item.seeders !== null && item.seeders < profile.minSeeders) {
    return {
      ok: false,
      reason: `only ${item.seeders} seeders (minimum ${profile.minSeeders})`,
      score: 0,
    };
  }

  if (profile.maxSizeGb > 0 && item.sizeBytes) {
    const gb = item.sizeBytes / 1024 ** 3;
    if (gb > profile.maxSizeGb) {
      return {
        ok: false,
        reason: `${gb.toFixed(1)} GB exceeds the ${profile.maxSizeGb} GB limit`,
        score: 0,
      };
    }
  }

  if (profile.minSizeMb > 0 && item.sizeBytes) {
    const mb = item.sizeBytes / 1024 ** 2;
    if (mb < profile.minSizeMb) {
      return {
        ok: false,
        reason: `${mb.toFixed(0)} MB is below the ${profile.minSizeMb} MB minimum`,
        score: 0,
      };
    }
  }

  if (parsed.isSeasonPack && !profile.allowSeasonPacks) {
    return { ok: false, reason: "season packs are disabled", score: 0 };
  }

  return { ok: true, reason: "accepted", score: scoreRelease(profile, parsed, item) };
}

/**
 * Rank an acceptable release against its rivals. Resolution dominates, then
 * how close it is to the preferred quality, then source, then seeders.
 */
export function scoreRelease(
  profile: QualityProfile,
  parsed: ParsedRelease,
  item: Pick<FeedItem, "seeders">,
): number {
  let score = resolutionRank(parsed.resolution) * 1000;

  if (profile.preferred && parsed.resolution === profile.preferred) score += 500;

  score += sourceRank(parsed.source) * 40;

  if (parsed.proper) score += 60;
  if (parsed.repack) score += 50;
  if (parsed.hdr) score += 20;

  for (const word of profile.preferredWords) {
    if (containsWord(parsed.raw, word)) score += 150;
  }

  // Seeders break ties without ever outweighing a quality difference.
  score += Math.min(item.seeders ?? 0, 200) * 0.25;

  return Math.round(score);
}

/**
 * Whether a release improves on what we already grabbed. Without upgrades
 * enabled, anything already in hand is left alone.
 */
export function isUpgrade(
  profile: QualityProfile,
  currentQuality: string | null,
  parsed: ParsedRelease,
): MatchDecision {
  if (!profile.upgrade) {
    // Naming the quality covers both cases honestly: something tvarr grabbed,
    // and something that was simply already on the shelf (" · Plex").
    return {
      ok: false,
      reason: currentQuality ? `already have ${currentQuality}` : "already have it",
      score: 0,
    };
  }

  const current = (currentQuality ?? "").toLowerCase();
  const currentResolution =
    RESOLUTIONS.find((r) => current.includes(r)) ?? ("sd" as Resolution);

  if (resolutionRank(parsed.resolution) <= resolutionRank(currentResolution)) {
    return {
      ok: false,
      reason: `already have ${currentResolution}`,
      score: 0,
    };
  }

  if (profile.preferred && resolutionRank(currentResolution) >= resolutionRank(profile.preferred)) {
    return { ok: false, reason: `already at preferred quality`, score: 0 };
  }

  return { ok: true, reason: `upgrade from ${currentResolution}`, score: 0 };
}

/**
 * Which episodes a release covers. A single release may map to several rows
 * (multi-episode files) or to a whole season.
 */
export function episodesForRelease(
  parsed: ParsedRelease,
  seasonEpisodes: Episode[],
): Episode[] {
  if (parsed.season === null) return [];
  if (parsed.isSeasonPack) return seasonEpisodes;
  return seasonEpisodes.filter((episode) => parsed.episodes.includes(episode.number));
}
