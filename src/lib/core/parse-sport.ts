/**
 * Reading a sports release name.
 *
 * Sports releases have no equivalent of `S03E01`. What they do carry, in some
 * combination, is a competition name, a date, sometimes an event number, the
 * names of whoever is playing, and which part of the broadcast this is:
 *
 *   UFC.330.Main.Card.1080p.WEB-DL.H264-GRP
 *   EPL.2026.08.21.Westford.City.vs.Eastport.1080p.HDTV
 *   Formula1.2026.Coastal.GP.Race.1080p
 *   NHL.RS.2026.03.10.Falcons.vs.Harriers.720p
 *
 * None of those is reliable on its own, so this file only extracts; deciding
 * which event a release belongs to is scoring, and lives in `match-sport.ts`.
 */

import { LEAGUES, type LeagueDefinition } from "./sports";
import { SPORT_SESSIONS, type SportSession } from "./types";

/** Separators collapsed to spaces so `\b` behaves and "WEB-DL" stays one token. */
export function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-word test on an already normalized haystack. */
export function hasPhrase(normalized: string, phrase: string): boolean {
  const needle = normalizeForMatch(phrase);
  if (!needle) return false;
  return new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(normalized);
}

/*
 * Ordered most specific first: "early prelims" must be tested before "prelims",
 * and "qualifying" before "race", or a release gets filed as the wrong half of
 * the weekend.
 *
 * These run against the separator-normalized name, not the raw one — scene
 * names join words with dots, so a pattern written with spaces would quietly
 * never match "UFC.319.Early.Prelims".
 */
const SESSION_PATTERNS: Array<[SportSession, RegExp]> = [
  [
    "extra",
    /\b(weigh ?ins?|press conference|presser|countdown|embedded|pre ?show|post (?:show|fight ?show)|media day|face ?offs?|open workouts?|build ?up|preview show)\b/,
  ],
  [
    "highlights",
    /\b(extended highlights|highlights|condensed(?: game)?|recap|mini match|all goals)\b/,
  ],
  ["early-prelims", /\b(early prelims?|early preliminary)\b/],
  ["prelims", /\b(prelims?|preliminary(?: card)?|undercard)\b/],
  ["main-card", /\b(main card|main event|ppv|pay per view)\b/],
  ["sprint", /\b(sprint(?: race| shootout| qualifying)?)\b/],
  ["qualifying", /\b(qualifying|quali)\b/],
  ["practice", /\b(practice ?[123]?|fp[123]|free practice|shakedown)\b/],
  // Deliberately not "grand prix": that is the event's own name, not a
  // statement about which session this file contains.
  ["race", /\b(race|main race|feature race)\b/],
];

export interface ParsedSportRelease {
  raw: string;
  /** Lowercased, separator-normalized copy — everything is matched on this. */
  normalized: string;
  /** Competition this release names, if it names one we know. */
  league: LeagueDefinition | null;
  /** "UFC 330" -> 330. */
  eventNumber: number | null;
  /** YYYY-MM-DD, when the name carries a full date. */
  date: string | null;
  /** A bare four-digit year, when there is no full date. */
  year: number | null;
  /**
   * Which part of the broadcast. `full-event` is the default: a release that
   * says nothing is the event itself, not a highlight reel.
   */
  session: SportSession;
  /** True when the session was stated rather than assumed. */
  sessionStated: boolean;
}

/** `2026.03.14`, `2026-03-14`. */
const DATE = /\b((?:19|20)\d{2})[\s._-](\d{1,2})[\s._-](\d{1,2})\b/;
/** `14.03.2026` — European order, used by some European sports groups. */
const DATE_DMY = /\b(\d{2})[\s._-](\d{2})[\s._-]((?:19|20)\d{2})\b/;
const YEAR = /\b((?:19|20)\d{2})\b/;

function pad(value: string): string {
  return value.padStart(2, "0");
}

function detectDate(raw: string): string | null {
  const ymd = DATE.exec(raw);
  if (ymd) {
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${ymd[1]}-${pad(ymd[2])}-${pad(ymd[3])}`;
    }
  }

  const dmy = DATE_DMY.exec(raw);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${dmy[3]}-${pad(dmy[2])}-${pad(dmy[1])}`;
    }
  }

  return null;
}

/**
 * Which competition this release is for.
 *
 * The longest matching alias wins, so "UEFA Champions League" is not read as
 * some other competition that happens to share a shorter token, and a league's
 * exclusions are checked against the whole name rather than the matched part.
 */
export function detectLeague(normalized: string): LeagueDefinition | null {
  let best: { league: LeagueDefinition; length: number } | null = null;

  for (const league of LEAGUES) {
    if (league.exclude?.some((token) => hasPhrase(normalized, token))) continue;

    for (const alias of league.aliases) {
      if (!hasPhrase(normalized, alias)) continue;
      const length = normalizeForMatch(alias).length;
      if (!best || length > best.length) best = { league, length };
    }
  }

  return best?.league ?? null;
}

function detectSession(normalized: string): { session: SportSession; stated: boolean } {
  for (const [session, pattern] of SESSION_PATTERNS) {
    if (pattern.test(normalized)) return { session, stated: true };
  }
  return { session: "full-event", stated: false };
}

/**
 * The number in "UFC 330".
 *
 * It only counts directly after a competition alias: plenty of releases carry
 * loose numbers (720p, DDP5 1, a year) and reading one of those as an event
 * number would confidently match the wrong night.
 */
function detectEventNumber(normalized: string, league: LeagueDefinition | null): number | null {
  if (!league) return null;

  // "UFC Fight Night 245" numbers a series of unnumbered cards, not a PPV.
  if (/\bfight night\b/.test(normalized)) return null;

  for (const alias of [league.name, ...league.aliases]) {
    const needle = normalizeForMatch(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(^| )${needle} ?(\\d{1,4})( |$)`).exec(normalized);
    if (match) {
      const value = Number(match[2]);
      // A four-digit number after the name is a year, not an event number.
      if (value >= 1900 && value <= 2100) continue;
      return value;
    }
  }

  return null;
}

export function parseSportRelease(raw: string): ParsedSportRelease {
  const normalized = normalizeForMatch(raw);
  const league = detectLeague(normalized);
  const date = detectDate(raw);
  const { session, stated } = detectSession(normalized);

  const yearMatch = YEAR.exec(raw);
  const year = !date && yearMatch ? Number(yearMatch[1]) : date ? Number(date.slice(0, 4)) : null;

  return {
    raw,
    normalized,
    league,
    eventNumber: detectEventNumber(normalized, league),
    date,
    year,
    session,
    sessionStated: stated,
  };
}

/** Whether a name looks like sport at all, used to skip the TV/movie path. */
export function looksLikeSport(raw: string): boolean {
  return detectLeague(normalizeForMatch(raw)) !== null;
}

export { SPORT_SESSIONS };
