/**
 * Deciding which sporting event a release is, and how sure we are.
 *
 * TV and film matching is a yes/no question because the release name carries
 * an unambiguous key — `S03E01`, or a title and a year. Sport has no such key.
 * A name might give the date and not the teams, or the teams and not the date,
 * or a number that means everything ("UFC 330") next to one that means nothing
 * ("Fight Night 245").
 *
 * So this scores instead of judging, against two thresholds:
 *
 *   MIN_SCORE   enough evidence to say which event this probably is. Shown in
 *               the release list with a one-click grab.
 *   AUTO_SCORE  enough to act on unattended.
 *
 * Everything in between is deliberately left for a person. Downloading the
 * wrong game is a worse outcome than downloading nothing, and a release that
 * scores 40 is genuinely a maybe — presenting it as one is the honest answer.
 */

import { hasPhrase, normalizeForMatch, type ParsedSportRelease } from "./parse-sport";
import type { Episode, SportSession, SportSubscription } from "./types";

/** Below this, the evidence does not identify an event at all. */
export const MIN_SCORE = 35;
/** At or above this, the match is acted on without asking. */
export const AUTO_SCORE = 55;

/** An event number is the one thing in a sports name that means exactly one event. */
const NUMBER_SCORE = 60;

const DATE_EXACT = 40;
/** A night game rolls over midnight UTC, so the day before is nearly as good. */
const DATE_NEAR = 30;
/** A race weekend spans three days and gets tagged with any of them. */
const DATE_WEEKEND = 12;

const IDENTITY_FULL_BONUS = 20;
const IDENTITY_WEIGHT = 40;

const SEASON_YEAR_SCORE = 10;

export interface SportVerdict {
  score: number;
  /** True when the score clears AUTO_SCORE. */
  confident: boolean;
  /** What the score is made of, shown in the interface. */
  reasons: string[];
}

export interface SportMatch extends SportVerdict {
  episode: Episode;
}

function dayNumber(value: string): number | null {
  const time = Date.parse(value.length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? Math.floor(time / 86_400_000) : null;
}

/**
 * Whether a release names this subject.
 *
 * The prefix rule is what lets a release name a place by its adjective —
 * "Coastlands" matching a Coastland group — without the demonym table that
 * this kind of matching otherwise turns into. Five characters is enough
 * shared prefix to be safe; below that, only an exact word counts.
 */
function groupMatches(normalized: string, group: string[]): boolean {
  const releaseWords = normalized.split(" ");

  for (const alias of group) {
    const needle = normalizeForMatch(alias);
    if (!needle) continue;
    if (hasPhrase(normalized, needle)) return true;

    if (needle.length >= 5 && !needle.includes(" ")) {
      const stem = needle.slice(0, 5);
      if (releaseWords.some((word) => word.length >= 5 && word.startsWith(stem))) return true;
    }
  }

  return false;
}

/**
 * Score one release against one event.
 *
 * Returns null when the release cannot be this event — a different number, or
 * a date too far away. That hard "no" matters more than the score: it is what
 * stops UFC 330 being filed as UFC 331, and Saturday's game as Tuesday's.
 */
export function scoreSportEvent(
  parsed: ParsedSportRelease,
  episode: Pick<Episode, "airDate" | "title" | "season" | "sport">,
): SportVerdict | null {
  const meta = episode.sport;
  const reasons: string[] = [];
  let score = 0;
  let identified = false;

  /* Event number: definitive both ways. */
  const eventNumber = meta?.eventNumber ?? null;
  if (parsed.eventNumber !== null && eventNumber !== null) {
    if (parsed.eventNumber !== eventNumber) return null;
    score += NUMBER_SCORE;
    identified = true;
    reasons.push(`event number ${eventNumber}`);
  }

  /* Date. */
  if (parsed.date && episode.airDate) {
    const releaseDay = dayNumber(parsed.date);
    const eventDay = dayNumber(episode.airDate);
    if (releaseDay !== null && eventDay !== null) {
      const distance = Math.abs(releaseDay - eventDay);
      if (distance > 2) return null;

      if (distance === 0) {
        score += DATE_EXACT;
        reasons.push("same date");
      } else if (distance === 1) {
        score += DATE_NEAR;
        reasons.push("one day out");
      } else {
        score += DATE_WEEKEND;
        reasons.push("same weekend");
      }
      identified = true;
    }
  }

  /* Who is playing. */
  const groups = meta?.identityGroups ?? [];
  if (groups.length) {
    const matched = groups.filter((group) => groupMatches(parsed.normalized, group)).length;
    if (matched > 0) {
      const coverage = matched / groups.length;
      score += Math.round(IDENTITY_WEIGHT * coverage);
      if (coverage === 1) score += IDENTITY_FULL_BONUS;
      identified = true;
      reasons.push(
        coverage === 1
          ? groups.length > 1
            ? "both named"
            : "named"
          : `${matched} of ${groups.length} named`,
      );
    }
  }

  /* A bare year is corroboration, never identification on its own. */
  if (!parsed.date && parsed.year !== null && parsed.year === episode.season) {
    score += SEASON_YEAR_SCORE;
    reasons.push(`${parsed.year} season`);
  }

  if (!identified) return null;

  return { score, confident: score >= AUTO_SCORE, reasons };
}

/** The event a release most likely belongs to, or null if none is plausible. */
export function bestSportMatch(
  parsed: ParsedSportRelease,
  episodes: Episode[],
): SportMatch | null {
  let best: SportMatch | null = null;

  for (const episode of episodes) {
    const verdict = scoreSportEvent(parsed, episode);
    if (!verdict || verdict.score < MIN_SCORE) continue;
    if (!best || verdict.score > best.score) best = { ...verdict, episode };
  }

  return best;
}

/**
 * Whether the subscription wants this part of the broadcast.
 *
 * `full-event` covers a release that says nothing about which part it is, so
 * turning it off is how someone says "only the main card, never the whole
 * night dumped in one file".
 */
export function sessionAllowed(
  subscription: Pick<SportSubscription, "sessions">,
  session: SportSession,
): boolean {
  return subscription.sessions.includes(session);
}

/** Whether a followed competition cares about this event at all. */
export function eventIsFollowed(
  subscription: Pick<SportSubscription, "teams">,
  competitors: string[],
): boolean {
  if (!subscription.teams.length) return true;
  return subscription.teams.some((team) => competitors.includes(team));
}
