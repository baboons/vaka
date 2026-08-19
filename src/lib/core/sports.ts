/**
 * Sports competitions, and the schedule they publish.
 *
 * The catalogue below is deliberately a fixed list rather than a searchable
 * remote index. There is no registry of "every competition a torrent group
 * might post", and an open-ended search would let someone follow a league
 * whose releases tvarr cannot recognise. Each entry pairs a competition with
 * the tokens its releases actually carry, which is the only reason matching
 * works at all.
 *
 * Schedules come from ESPN's public site API: no key, no account, and it
 * covers every competition listed here with dates, ids and competitor names.
 */

import { cached } from "./cache";
import { getDb, type Db } from "./db";
import { defaultSessions, type SportFormat } from "./types";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

const REQUEST_TIMEOUT_MS = 15_000;

/** ESPN returns nothing useful for ranges longer than about a month. */
const CHUNK_DAYS = 28;

export interface LeagueDefinition {
  /** Stable id used in the database and in URLs. */
  id: string;
  /** Short name, as a release would write it. */
  name: string;
  fullName: string;
  /** ESPN sport and league slugs. */
  sport: string;
  league: string;
  format: SportFormat;
  /**
   * Tokens a release uses for this competition. Matched as whole words on a
   * separator-normalized copy of the name, so "Premier League" also matches
   * "Premier.League".
   */
  aliases: string[];
  /**
   * Tokens that rule the match out even when an alias hit.
   *
   * This is the whole reason "F1" does not swallow F1 Academy and Formula E:
   * the alias is genuinely present in those names, and only an exclusion can
   * tell them apart.
   */
  exclude?: string[];
  logo: string;
  /** Heading it appears under when browsing. */
  group: string;
}

export const LEAGUES: LeagueDefinition[] = [
  /* Combat sports ---------------------------------------------------- */
  {
    id: "ufc",
    name: "UFC",
    fullName: "Ultimate Fighting Championship",
    sport: "mma",
    league: "ufc",
    format: "card",
    aliases: ["ufc", "dana whites contender series", "dwcs"],
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/ufc.png",
    group: "Combat sports",
  },
  {
    id: "pfl",
    name: "PFL",
    fullName: "Professional Fighters League",
    sport: "mma",
    league: "pfl",
    format: "card",
    aliases: ["pfl", "professional fighters league"],
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/pfl.png",
    group: "Combat sports",
  },
  {
    id: "bellator",
    name: "Bellator",
    fullName: "Bellator MMA",
    sport: "mma",
    league: "bellator",
    format: "card",
    aliases: ["bellator"],
    logo: "https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-mma.png",
    group: "Combat sports",
  },

  /* Football (soccer) ------------------------------------------------ */
  {
    id: "eng.1",
    name: "Premier League",
    fullName: "English Premier League",
    sport: "soccer",
    league: "eng.1",
    format: "fixture",
    aliases: ["epl", "premier league", "english premier league", "premierleague"],
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
    group: "Football",
  },
  {
    id: "uefa.champions",
    name: "Champions League",
    fullName: "UEFA Champions League",
    sport: "soccer",
    league: "uefa.champions",
    format: "fixture",
    aliases: ["ucl", "champions league", "uefa champions league"],
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png",
    group: "Football",
  },
  {
    id: "uefa.europa",
    name: "Europa League",
    fullName: "UEFA Europa League",
    sport: "soccer",
    league: "uefa.europa",
    format: "fixture",
    aliases: ["uel", "europa league", "uefa europa league"],
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2310.png",
    group: "Football",
  },
  {
    id: "esp.1",
    name: "LaLiga",
    fullName: "Spanish LaLiga",
    sport: "soccer",
    league: "esp.1",
    format: "fixture",
    aliases: ["laliga", "la liga", "spanish la liga", "primera division"],
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png",
    group: "Football",
  },
  {
    id: "ita.1",
    name: "Serie A",
    fullName: "Italian Serie A",
    sport: "soccer",
    league: "ita.1",
    format: "fixture",
    aliases: ["serie a", "italian serie a"],
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png",
    group: "Football",
  },
  {
    id: "ger.1",
    name: "Bundesliga",
    fullName: "German Bundesliga",
    sport: "soccer",
    league: "ger.1",
    format: "fixture",
    aliases: ["bundesliga", "german bundesliga"],
    // The Austrian and second-tier leagues share the name.
    exclude: ["2 bundesliga", "zweite", "austrian"],
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png",
    group: "Football",
  },
  {
    id: "fra.1",
    name: "Ligue 1",
    fullName: "French Ligue 1",
    sport: "soccer",
    league: "fra.1",
    format: "fixture",
    aliases: ["ligue 1", "french ligue 1"],
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png",
    group: "Football",
  },
  {
    id: "usa.1",
    name: "MLS",
    fullName: "Major League Soccer",
    sport: "soccer",
    league: "usa.1",
    format: "fixture",
    aliases: ["mls", "major league soccer"],
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/19.png",
    group: "Football",
  },

  /* North American leagues ------------------------------------------- */
  {
    id: "nhl",
    name: "NHL",
    fullName: "National Hockey League",
    sport: "hockey",
    league: "nhl",
    format: "fixture",
    aliases: ["nhl", "national hockey league"],
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png",
    group: "North America",
  },
  {
    id: "nba",
    name: "NBA",
    fullName: "National Basketball Association",
    sport: "basketball",
    league: "nba",
    format: "fixture",
    aliases: ["nba", "national basketball association"],
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png",
    group: "North America",
  },
  {
    id: "wnba",
    name: "WNBA",
    fullName: "Women's National Basketball Association",
    sport: "basketball",
    league: "wnba",
    format: "fixture",
    aliases: ["wnba"],
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/wnba.png",
    group: "North America",
  },
  {
    id: "nfl",
    name: "NFL",
    fullName: "National Football League",
    sport: "football",
    league: "nfl",
    format: "fixture",
    aliases: ["nfl", "national football league"],
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png",
    group: "North America",
  },
  {
    id: "mlb",
    name: "MLB",
    fullName: "Major League Baseball",
    sport: "baseball",
    league: "mlb",
    format: "fixture",
    aliases: ["mlb", "major league baseball"],
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png",
    group: "North America",
  },
  {
    id: "college-football",
    name: "College Football",
    fullName: "NCAA Football",
    sport: "football",
    league: "college-football",
    format: "fixture",
    aliases: ["ncaaf", "ncaa football", "college football"],
    logo: "https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-football-college.png",
    group: "North America",
  },

  /* Motorsport ------------------------------------------------------- */
  {
    id: "f1",
    name: "Formula 1",
    fullName: "FIA Formula One World Championship",
    sport: "racing",
    league: "f1",
    format: "race",
    aliases: ["f1", "formula 1", "formula1", "formula one"],
    // F1 Academy, F2, F3 and Formula E all contain an F1-shaped token.
    exclude: ["academy", "formula e", "formulae", "f1 academy", "w series"],
    logo: "https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/f1.png",
    group: "Motorsport",
  },
  {
    id: "indycar",
    name: "IndyCar",
    fullName: "NTT IndyCar Series",
    sport: "racing",
    league: "irl",
    format: "race",
    aliases: ["indycar", "indy car", "ntt indycar"],
    logo: "https://a.espncdn.com/combiner/i?img=/i/espn/teamlogos/500/indycar_series.png",
    group: "Motorsport",
  },
  {
    id: "nascar",
    name: "NASCAR Cup",
    fullName: "NASCAR Cup Series",
    sport: "racing",
    league: "nascar-premier",
    format: "race",
    aliases: ["nascar", "nascar cup", "nascar cup series"],
    logo: "https://a.espncdn.com/combiner/i?img=/redesign/assets/img/icons/ESPN-icon-NASCAR.png",
    group: "Motorsport",
  },
];

export function findLeague(id: string): LeagueDefinition | null {
  return LEAGUES.find((entry) => entry.id === id) ?? null;
}

/** Catalogue search. Matches the name, the full name and the release aliases. */
export function searchLeagues(query: string): LeagueDefinition[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...LEAGUES];

  return LEAGUES.filter((entry) =>
    [entry.name, entry.fullName, entry.group, ...entry.aliases].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Schedules                                                            */
/* ------------------------------------------------------------------ */

export interface SportEvent {
  /** ESPN event id — stable, and the key each event row is stored under. */
  id: string;
  /** Scheduled start, ISO 8601 UTC. */
  date: string;
  name: string;
  shortName: string;
  seasonYear: number;
  /** "UFC 330" -> 330. Null for anything not numbered. */
  eventNumber: number | null;
  /** Display names, for the team filter and for showing what an event is. */
  competitors: string[];
  /**
   * Ways to name the subjects of this event, one group per subject.
   *
   * Matching counts how many *groups* a release names, not how many strings,
   * so "Bruins" and "Boston Bruins" and "BOS" all count once. Coverage across
   * groups is what separates "the right game" from "a game involving Boston".
   */
  identityGroups: string[][];
}

export class SportProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SportProviderError";
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "tvarr/1.0" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SportProviderError(`request failed: ${reason}`);
  }
  if (!response.ok) throw new SportProviderError(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

interface EspnCompetitor {
  homeAway?: string;
  team?: {
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    location?: string;
    name?: string;
  };
  athlete?: { displayName?: string; shortName?: string };
}

interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  shortName?: string;
  season?: { year?: number };
  competitions?: Array<{ competitors?: EspnCompetitor[] }>;
}

interface EspnTeam {
  id?: string;
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
  location?: string;
  name?: string;
}

interface EspnTeamEntry {
  team?: EspnTeam;
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Words that identify no one, so they never count as a match on their own. */
const NOISE = new Set([
  "grand",
  "prix",
  "gp",
  "the",
  "of",
  "and",
  "at",
  "vs",
  "v",
  "cup",
  "series",
  "season",
  "week",
  "round",
  "race",
  "day",
  "night",
  "fc",
  "afc",
  "united",
  "city",
  "town",
  "club",
  "open",
  "championship",
  "presented",
  "by",
]);

/** Sponsor prefixes ESPN bolts onto race names, e.g. "Qatar Airways". */
const SPONSOR_WORDS = new Set([
  "qatar",
  "airways",
  "heineken",
  "aramco",
  "lenovo",
  "msc",
  "pirelli",
  "rolex",
  "emirates",
  "louis",
  "vuitton",
  "crypto",
  "com",
  "stc",
  "gulf",
  "air",
  "singapore",
  "petronas",
]);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** Every way this team is written, longest first so display names win. */
export function teamAliases(team: {
  displayName?: string;
  shortDisplayName?: string;
  location?: string;
  name?: string;
  abbreviation?: string;
}): string[] {
  return [team.displayName, team.shortDisplayName, team.location, team.name, team.abbreviation]
    .filter((value): value is string => Boolean(value && value.trim().length >= 2))
    .map((value) => value.trim())
    .filter((value, index, all) => all.indexOf(value) === index);
}

/**
 * Read the subjects out of a card's title.
 *
 * "UFC 330: Makhachev vs. Machado Garry" describes two fighters; both the
 * full name and the surname are kept, because releases use either.
 */
export function fighterGroups(name: string): string[][] {
  const subject = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
  const sides = subject.split(/\s+vs\.?\s+|\s+v\.?\s+/i).map((side) => side.trim());
  if (sides.length < 2) return [];

  return sides
    .filter(Boolean)
    .map((side) => {
      const parts = side.split(/\s+/);
      const surname = parts[parts.length - 1];
      // A one-word name is its own surname; keeping both would just be the
      // same alias twice.
      return [...new Set([side, surname])].filter((value) => value.length >= 3);
    })
    .filter((group) => group.length > 0);
}

/** The distinctive part of a race name — normally the country or circuit. */
export function raceGroup(name: string): string[][] {
  const grandPrix = /([A-Za-z]+)\s+Grand\s+Prix/i.exec(name);
  if (grandPrix) return [[grandPrix[1]]];

  const distinctive = words(name).filter(
    (word) => word.length >= 4 && !NOISE.has(word) && !SPONSOR_WORDS.has(word),
  );
  return distinctive.length ? [distinctive] : [];
}

function eventNumberOf(league: LeagueDefinition, event: EspnEvent): number | null {
  const source = event.shortName ?? event.name ?? "";
  for (const alias of [league.name, ...league.aliases]) {
    const pattern = new RegExp(
      `${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")}\\s*#?(\\d{1,4})\\b`,
      "i",
    );
    const match = pattern.exec(source);
    if (match) return Number(match[1]);
  }
  return null;
}

function mapEvent(league: LeagueDefinition, event: EspnEvent): SportEvent | null {
  if (!event.id || !event.date) return null;

  const rawCompetitors = event.competitions?.[0]?.competitors ?? [];
  const teams = rawCompetitors
    .map((competitor) => competitor.team)
    .filter((team): team is EspnTeam => Boolean(team?.displayName));

  const name = event.name ?? event.shortName ?? "Event";

  let identityGroups: string[][];
  if (league.format === "fixture" && teams.length) {
    identityGroups = teams.map(teamAliases);
  } else if (league.format === "card") {
    identityGroups = fighterGroups(name);
  } else {
    identityGroups = raceGroup(name);
  }

  return {
    id: event.id,
    date: event.date,
    name,
    shortName: event.shortName ?? name,
    seasonYear: event.season?.year ?? Number(event.date.slice(0, 4)),
    eventNumber: eventNumberOf(league, event),
    competitors: teams.length
      ? teams.map((team) => team.displayName as string)
      : identityGroups.map((group) => group[0]),
    identityGroups,
  };
}

/**
 * Every scheduled event between two dates.
 *
 * ESPN silently truncates long ranges — asking for a whole NHL season returns
 * a couple of dozen games — so the window is walked a month at a time and the
 * results merged by event id.
 */
export async function fetchEvents(
  leagueId: string,
  from: Date,
  to: Date,
): Promise<SportEvent[]> {
  const league = findLeague(leagueId);
  if (!league) throw new SportProviderError(`unknown competition: ${leagueId}`);

  const seen = new Map<string, SportEvent>();

  for (let start = new Date(from); start <= to; ) {
    const end = new Date(
      Math.min(start.getTime() + CHUNK_DAYS * 86_400_000, to.getTime()),
    );

    const url =
      `${ESPN}/${league.sport}/${league.league}/scoreboard` +
      `?dates=${yyyymmdd(start)}-${yyyymmdd(end)}&limit=1000`;

    const data = await fetchJson<{ events?: EspnEvent[] }>(url);
    for (const raw of data.events ?? []) {
      const event = mapEvent(league, raw);
      if (event && !seen.has(event.id)) seen.set(event.id, event);
    }

    start = new Date(end.getTime() + 86_400_000);
  }

  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface LeagueTeam {
  id: string;
  name: string;
  abbreviation: string | null;
}

/** The teams that can be followed within a competition. Cached for a week. */
export async function listTeams(leagueId: string, db: Db = getDb()): Promise<LeagueTeam[]> {
  const league = findLeague(leagueId);
  if (!league || league.format !== "fixture") return [];

  const result = await cached(
    `sport:teams:${leagueId}`,
    7 * 24 * 60 * 60,
    async () => {
      const data = await fetchJson<{
        sports?: Array<{ leagues?: Array<{ teams?: EspnTeamEntry[] }> }>;
      }>(`${ESPN}/${league.sport}/${league.league}/teams`);

      const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
      return teams
        .map((entry) => entry.team)
        .filter((team): team is EspnTeam => Boolean(team?.displayName))
        .map((team) => ({
          id: team.id ?? (team.displayName as string),
          name: team.displayName as string,
          abbreviation: team.abbreviation ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    db,
  );

  return result.value;
}

/** A newly followed competition, before anything is known about its calendar. */
export function subscriptionFor(league: LeagueDefinition) {
  return {
    league: league.id,
    teams: [],
    sessions: defaultSessions(league.format),
    autoGrabUncertain: false,
  };
}
