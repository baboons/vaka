/**
 * The part that actually does the work: fetch feeds, decide what matches,
 * and drop the wanted releases into the blackhole folder.
 *
 * Everything here is process-agnostic — the watcher daemon calls it on a
 * timer, and the web UI calls the same functions for on-demand actions.
 */

import { getDb, nowIso, type Db } from "./db";
import { fetchFeed } from "./feed";
import { grabRelease, GrabError } from "./grab";
import {
  buildTitleIndex,
  episodesForRelease,
  evaluateQuality,
  findMedia,
  isUpgrade,
} from "./match";
import {
  bestSportMatch,
  eventIsFollowed,
  sessionAllowed,
  type SportMatch,
} from "./match-sport";
import { parseSportRelease, type ParsedSportRelease } from "./parse-sport";
import { describeQuality, parseRelease } from "./parse-release";
import * as providers from "./providers";
import * as repo from "./repo";
import { getConfig, getKindConfig, getSportsConfig } from "./settings";
import * as sports from "./sports";
import {
  SESSION_LABELS,
  type Episode,
  type FeedItem,
  type Media,
  type MediaKind,
  type ParsedRelease,
  type QualityProfile,
  type SportSession,
} from "./types";

export interface PollSummary {
  feeds: number;
  fetched: number;
  newItems: number;
  errors: string[];
}

export interface EvaluationSummary {
  considered: number;
  matched: number;
  grabbed: number;
  rejected: number;
  errors: number;
}

/* ------------------------------------------------------------------ */
/* Feed polling                                                         */
/* ------------------------------------------------------------------ */

export async function pollFeeds(db: Db = getDb()): Promise<PollSummary> {
  const feeds = repo.listFeeds(true, db);
  const summary: PollSummary = { feeds: feeds.length, fetched: 0, newItems: 0, errors: [] };

  for (const feed of feeds) {
    try {
      const { items } = await fetchFeed(feed.url, feed.id);
      const fresh = repo.saveFeedItems(items, db);
      summary.fetched += items.length;
      summary.newItems += fresh.length;
      repo.updateFeed(
        feed.id,
        {
          lastCheckedAt: nowIso(),
          lastStatus: "ok",
          lastError: null,
          itemCount: items.length,
        },
        db,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${feed.name}: ${message}`);
      repo.updateFeed(
        feed.id,
        { lastCheckedAt: nowIso(), lastStatus: "error", lastError: message },
        db,
      );
      repo.addHistory(
        { event: "error", feedId: feed.id, title: feed.name, reason: message },
        db,
      );
    }
  }

  return summary;
}

/* ------------------------------------------------------------------ */
/* Matching and grabbing                                                */
/* ------------------------------------------------------------------ */

interface Target {
  media: Media;
  /** Episodes this release would satisfy. Empty for movies. */
  episodes: Episode[];
  reason: string;
}

/**
 * Everything needed to ask "what is this release?".
 *
 * Two indexes, because the two questions are not the same one. A show or a
 * film is looked up by an exact normalized title; a sporting event is looked
 * up by competition and then *scored* against that competition's calendar,
 * since the release name carries no key that identifies one event.
 */
export interface LibraryIndex {
  titles: Map<string, Media[]>;
  sports: Map<string, Media[]>;
}

export function buildLibraryIndex(library: Media[]): LibraryIndex {
  const sportsIndex = new Map<string, Media[]>();

  for (const media of library) {
    if (media.kind !== "sport" || !media.sport?.league) continue;
    const bucket = sportsIndex.get(media.sport.league);
    if (bucket) bucket.push(media);
    else sportsIndex.set(media.sport.league, [media]);
  }

  return {
    titles: buildTitleIndex(library.filter((media) => media.kind !== "sport")),
    sports: sportsIndex,
  };
}

/**
 * Work out which episodes (if any) a release would satisfy, and whether the
 * library still wants them.
 */
function resolveTarget(
  media: Media,
  parsed: ParsedRelease,
  profile: QualityProfile,
  db: Db,
): { ok: true; target: Target } | { ok: false; reason: string } {
  if (media.kind === "movie") {
    if (media.state === "ignored") return { ok: false, reason: "title is ignored" };
    if (media.state === "wanted") {
      return { ok: true, target: { media, episodes: [], reason: "wanted" } };
    }
    const upgrade = isUpgrade(profile, media.grabbedQuality, parsed);
    return upgrade.ok
      ? { ok: true, target: { media, episodes: [], reason: upgrade.reason } }
      : { ok: false, reason: upgrade.reason };
  }

  // Daily shows are identified by air date rather than a season/episode pair.
  if (parsed.airDate) {
    const episode = repo.findEpisodeByAirDate(media.id, parsed.airDate, db);
    if (!episode) return { ok: false, reason: `no episode aired on ${parsed.airDate}` };
    return wantedEpisodes(media, [episode], parsed, profile);
  }

  if (parsed.season === null) return { ok: false, reason: "no season information" };

  const seasonEpisodes = repo.listSeasonEpisodes(media.id, parsed.season, db);
  if (!seasonEpisodes.length) {
    return { ok: false, reason: `season ${parsed.season} is not in the library` };
  }

  const covered = episodesForRelease(parsed, seasonEpisodes);
  if (!covered.length) return { ok: false, reason: "episode not found" };

  return wantedEpisodes(media, covered, parsed, profile);
}

function wantedEpisodes(
  media: Media,
  episodes: Episode[],
  parsed: ParsedRelease,
  profile: QualityProfile,
): { ok: true; target: Target } | { ok: false; reason: string } {
  const monitored = episodes.filter((episode) => episode.monitored);
  if (!monitored.length) return { ok: false, reason: "episode is not monitored" };

  const wanted = monitored.filter((episode) => episode.state === "wanted");
  if (wanted.length) {
    return { ok: true, target: { media, episodes: wanted, reason: "wanted" } };
  }

  // Everything is already in hand — only an upgrade is worth grabbing.
  const upgradable = monitored.filter(
    (episode) => isUpgrade(profile, episode.grabbedQuality, parsed).ok,
  );
  if (upgradable.length) {
    return { ok: true, target: { media, episodes: upgradable, reason: "upgrade" } };
  }

  return { ok: false, reason: isUpgrade(profile, monitored[0].grabbedQuality, parsed).reason };
}

/**
 * The event a sports release was matched to, re-read so its state is current.
 *
 * The event is already chosen by then — screening scored it — so this only
 * asks whether it is still wanted.
 */
function resolveSportTarget(
  media: Media,
  match: SportMatch,
  parsed: ParsedRelease,
  db: Db,
): { ok: true; target: Target } | { ok: false; reason: string } {
  const episode = repo.getEpisode(match.episode.id, db);
  if (!episode) return { ok: false, reason: "the event is no longer in the calendar" };
  return wantedEpisodes(media, [episode], parsed, media.quality);
}

/** A release that passed the quality filter and is waiting to be ranked. */
interface Candidate {
  item: FeedItem;
  parsed: ParsedRelease;
  media: Media;
  quality: string;
  score: number;
  /** Sports: the event this release was matched to, and how sure we were. */
  sport?: { match: SportMatch; session: string };
}

function logRejection(
  item: FeedItem,
  media: Media,
  quality: string,
  reason: string,
  db: Db,
): void {
  repo.addHistory(
    {
      mediaId: media.id,
      feedId: item.feedId,
      event: "rejected",
      title: item.title,
      quality,
      reason,
      guid: item.guid,
    },
    db,
  );
}

/**
 * First pass: work out whether an item is something we could want.
 *
 * Returns null when it matches nothing in the library — the common case, and
 * deliberately not logged, since a feed is mostly other people's shows.
 */
type Screened = { rejected: true } | { rejected: false; candidate: Candidate } | null;

function screenItem(
  item: FeedItem,
  index: LibraryIndex,
  feedKind: MediaKind | "any",
  db: Db,
): Screened {
  if (repo.hasGrabbed(item.guid, db)) return null;

  // Sport is tried first, but only when the release names a competition that
  // is actually followed — otherwise this falls straight through and a show
  // called "NFL Films Presents" is still matched as a show.
  const sportRelease = parseSportRelease(item.title);
  if (sportRelease.league && index.sports.has(sportRelease.league.id)) {
    if (feedKind === "any" || feedKind === "sport") {
      const screened = screenSportItem(
        item,
        sportRelease,
        index.sports.get(sportRelease.league.id)!,
        db,
      );
      if (screened) return screened;
    }
  }

  const parsed = parseRelease(item.title);
  const media = findMedia(index.titles, parsed);
  if (!media) return null;
  if (feedKind !== "any" && media.kind !== feedKind) return null;
  if (!media.monitored) return null;

  const quality = describeQuality(parsed);
  const decision = evaluateQuality(media.quality, parsed, item);

  if (!decision.ok) {
    logRejection(item, media, quality, decision.reason, db);
    return { rejected: true };
  }

  return { rejected: false, candidate: { item, parsed, media, quality, score: decision.score } };
}

/**
 * Screen a release against a followed competition.
 *
 * The two-threshold rule lives here. A release that scores well enough to
 * identify an event but not well enough to be sure is *not* grabbed — it is
 * recorded so it shows up under the competition's releases with a Grab button
 * next to it. Downloading the wrong game is worse than downloading nothing,
 * and unlike `S03E01` a sports name genuinely does leave room for doubt.
 */
function screenSportItem(
  item: FeedItem,
  sportRelease: ParsedSportRelease,
  candidates: Media[],
  db: Db,
): Screened {
  const parsed = parseRelease(item.title);
  const quality = describeQuality(parsed);

  for (const media of candidates) {
    if (!media.monitored || !media.sport) continue;

    const events = repo.listEpisodes(media.id, db);
    const match = bestSportMatch(sportRelease, events);
    if (!match) continue;

    const sessionLabel = SESSION_LABELS[sportRelease.session];

    if (!sessionAllowed(media.sport, sportRelease.session)) {
      logRejection(item, media, quality, `${sessionLabel.toLowerCase()} is not wanted`, db);
      return { rejected: true };
    }

    // Season packs mean nothing here; a whole-season sports torrent is just a
    // large event, and the check would only ever reject by accident.
    const decision = evaluateQuality(
      { ...media.quality, allowSeasonPacks: true },
      parsed,
      item,
    );
    if (!decision.ok) {
      logRejection(item, media, quality, decision.reason, db);
      return { rejected: true };
    }

    const eventName = match.episode.title ?? `event ${match.episode.number}`;

    if (!match.confident && !media.sport.autoGrabUncertain) {
      repo.addHistory(
        {
          mediaId: media.id,
          episodeId: match.episode.id,
          feedId: item.feedId,
          event: "info",
          title: item.title,
          quality,
          reason:
            `probably ${eventName} (${match.score}/100, ${match.reasons.join(", ")}) — ` +
            `waiting for you to confirm it under Releases`,
          guid: item.guid,
        },
        db,
      );
      return { rejected: true };
    }

    return {
      rejected: false,
      candidate: {
        item,
        parsed,
        media,
        quality,
        // Confidence leads the ranking so the best-identified release of an
        // event wins, with the usual quality score breaking ties.
        score: match.score * 1000 + decision.score,
        sport: { match, session: sessionLabel },
      },
    };
  }

  return null;
}

/**
 * Second pass: grab candidates best-first.
 *
 * Ordering by score is what makes the preferred quality win. Once a release is
 * taken, the episodes it covers are marked grabbed, so the weaker duplicates
 * that follow are turned away with "already have 2160p" rather than
 * overwriting it — no need to reason about which release arrived first.
 */
async function processCandidates(
  candidates: Candidate[],
  db: Db,
): Promise<{ grabbed: number; rejected: number; errors: number }> {
  const totals = { grabbed: 0, rejected: 0, errors: 0 };
  const ranked = [...candidates].sort((a, b) => b.score - a.score);

  for (const candidate of ranked) {
    const { item, parsed, media, quality } = candidate;

    // State may have changed while working through higher-scoring releases.
    const current = repo.getMedia(media.id, db) ?? media;
    const resolved = candidate.sport
      ? resolveSportTarget(current, candidate.sport.match, parsed, db)
      : resolveTarget(current, parsed, current.quality, db);

    if (!resolved.ok) {
      logRejection(item, current, quality, resolved.reason, db);
      totals.rejected += 1;
      continue;
    }

    const outcome = await grabTarget(item, resolved.target, quality, db);
    if (outcome === "grabbed") totals.grabbed += 1;
    else totals.errors += 1;
  }

  return totals;
}

async function grabTarget(
  item: FeedItem,
  target: Target,
  quality: string,
  db: Db,
): Promise<"grabbed" | "error"> {
  const config = getConfig(db);
  const kindConfig = getKindConfig(target.media.kind, db);

  try {
    const result = await grabRelease(item, target.media, kindConfig, {
      writeMagnetFiles: config.general.writeMagnetFiles,
    });

    const stamp = nowIso();
    if (target.media.kind === "movie") {
      repo.updateMedia(
        target.media.id,
        { state: "grabbed", grabbedQuality: quality, grabbedAt: stamp },
        db,
      );
    } else {
      for (const episode of target.episodes) {
        repo.updateEpisode(
          episode.id,
          { state: "grabbed", grabbedQuality: quality, grabbedAt: stamp },
          db,
        );
      }
    }

    repo.addHistory(
      {
        mediaId: target.media.id,
        episodeId: target.episodes[0]?.id ?? null,
        feedId: item.feedId,
        event: "grabbed",
        title: item.title,
        quality,
        reason: describeTarget(target),
        path: result.path,
        guid: item.guid,
      },
      db,
    );
    return "grabbed";
  } catch (error) {
    const message =
      error instanceof GrabError || error instanceof Error ? error.message : String(error);
    repo.addHistory(
      {
        mediaId: target.media.id,
        feedId: item.feedId,
        event: "error",
        title: item.title,
        quality,
        reason: message,
        guid: item.guid,
      },
      db,
    );
    return "error";
  }
}

/** What went into the download folder, and why, for the activity log. */
function describeTarget(target: Target): string {
  if (target.media.kind === "movie") return target.reason;
  if (target.media.kind === "sport") {
    const event = target.episodes[0];
    return event?.title ? `${event.title} (${target.reason})` : target.reason;
  }
  return `${describeEpisodes(target.episodes)} (${target.reason})`;
}

function describeEpisodes(episodes: Episode[]): string {
  if (!episodes.length) return "";
  if (episodes.length === 1) {
    return `S${pad(episodes[0].season)}E${pad(episodes[0].number)}`;
  }
  const season = episodes[0].season;
  const numbers = episodes.map((e) => e.number);
  return `S${pad(season)}E${pad(Math.min(...numbers))}-E${pad(Math.max(...numbers))}`;
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Process every feed item that has not been evaluated yet. Called after each
 * poll; items are marked processed so a restart does not redo the work.
 */
export async function evaluatePendingItems(db: Db = getDb()): Promise<EvaluationSummary> {
  const config = getConfig(db);
  const items = repo.listPendingItems(config.general.grabDelayMinutes, 500, db);
  const summary: EvaluationSummary = {
    considered: items.length,
    matched: 0,
    grabbed: 0,
    rejected: 0,
    errors: 0,
  };
  if (!items.length) return summary;

  const index = buildLibraryIndex(repo.listMedia({ monitoredOnly: true }, db));
  const kinds = repo.feedKinds(db);
  const processed: number[] = [];
  const candidates: Candidate[] = [];

  for (const item of items) {
    try {
      const screened = screenItem(item, index, kinds.get(item.feedId) ?? "any", db);
      if (screened) {
        summary.matched += 1;
        if (screened.rejected) summary.rejected += 1;
        else candidates.push(screened.candidate);
      }
    } catch (error) {
      summary.errors += 1;
      repo.addHistory(
        {
          feedId: item.feedId,
          event: "error",
          title: item.title,
          reason: error instanceof Error ? error.message : String(error),
          guid: item.guid,
        },
        db,
      );
    }
    if (item.id) processed.push(item.id);
  }

  const totals = await processCandidates(candidates, db);
  summary.grabbed += totals.grabbed;
  summary.rejected += totals.rejected;
  summary.errors += totals.errors;

  repo.markItemsProcessed(processed, db);
  return summary;
}

/**
 * Re-scan every cached feed item for one title. Used when a title is newly
 * added (its releases may already be in the cache) and by "search now".
 */
export async function searchForMedia(
  mediaId: number,
  db: Db = getDb(),
): Promise<EvaluationSummary> {
  const media = repo.getMedia(mediaId, db);
  const summary: EvaluationSummary = {
    considered: 0,
    matched: 0,
    grabbed: 0,
    rejected: 0,
    errors: 0,
  };
  if (!media) return summary;

  const index = buildLibraryIndex([media]);
  const items = repo.listFeedItemsForKind(media.kind, db);
  summary.considered = items.length;

  const kinds = repo.feedKinds(db);
  const candidates: Candidate[] = [];

  for (const item of items) {
    const screened = screenItem(item, index, kinds.get(item.feedId) ?? "any", db);
    if (!screened) continue;
    summary.matched += 1;
    if (screened.rejected) summary.rejected += 1;
    else candidates.push(screened.candidate);
  }

  const totals = await processCandidates(candidates, db);
  summary.grabbed += totals.grabbed;
  summary.rejected += totals.rejected;
  summary.errors += totals.errors;

  return summary;
}

export interface CachedRelease {
  item: FeedItem;
  quality: string;
  /** How the release was read: season/episode, or that it looks like a film. */
  label: string;
  seeders: number | null;
  sizeBytes: number | null;
  /** Whether the quality profile accepts it, and why not when it does not. */
  decision: { ok: boolean; reason: string; score: number };
  publishedAt: string | null;
  /**
   * Sports only: how sure we are this is the event named, and what made us
   * think so. Present because for sport that judgement is the interesting
   * part, and a release below the auto-grab line is shown here on purpose.
   */
  confidence?: { score: number; confident: boolean; reasons: string[] };
}

/**
 * Every cached release that resolves to this title, judged against its
 * profile. This is what answers "why hasn't this downloaded yet?" — the
 * release is either absent from the feed or listed here with a reason.
 */
export function listCachedReleases(mediaId: number, db: Db = getDb()): CachedRelease[] {
  const media = repo.getMedia(mediaId, db);
  if (!media) return [];

  if (media.kind === "sport") return listCachedSportReleases(media, db);

  const index = buildTitleIndex([media]);
  const kinds = repo.feedKinds(db);
  const releases: CachedRelease[] = [];

  for (const item of repo.listFeedItemsForKind(media.kind, db)) {
    const feedKind = kinds.get(item.feedId) ?? "any";
    if (feedKind !== "any" && feedKind !== media.kind) continue;

    const parsed = parseRelease(item.title);
    if (findMedia(index, parsed)?.id !== media.id) continue;

    releases.push({
      item,
      quality: describeQuality(parsed),
      label: parsed.airDate
        ? parsed.airDate
        : parsed.isSeasonPack && parsed.season !== null
          ? `Season ${parsed.season}`
          : parsed.season !== null && parsed.episodes.length
            ? describeEpisodeNumbers(parsed.season, parsed.episodes)
            : "Movie",
      seeders: item.seeders,
      sizeBytes: item.sizeBytes,
      decision: evaluateQuality(media.quality, parsed, item),
      publishedAt: item.publishedAt,
    });
  }

  return releases.sort((a, b) => {
    if (a.decision.ok !== b.decision.ok) return a.decision.ok ? -1 : 1;
    return b.decision.score - a.decision.score;
  });
}

/**
 * Cached releases for a competition, with the confidence behind each match.
 *
 * This screen is doing more work for sport than it does elsewhere: for a show
 * it explains why something was turned down, and for a competition it is also
 * where the probable-but-unconfirmed matches wait to be grabbed by hand.
 */
function listCachedSportReleases(media: Media, db: Db): CachedRelease[] {
  const subscription = media.sport;
  if (!subscription) return [];

  const events = repo.listEpisodes(media.id, db);
  const kinds = repo.feedKinds(db);
  const releases: CachedRelease[] = [];

  for (const item of repo.listFeedItemsForKind("sport", db)) {
    const feedKind = kinds.get(item.feedId) ?? "any";
    if (feedKind !== "any" && feedKind !== "sport") continue;

    const sportRelease = parseSportRelease(item.title);
    if (sportRelease.league?.id !== subscription.league) continue;

    const match = bestSportMatch(sportRelease, events);
    if (!match) continue;

    const parsed = parseRelease(item.title);
    const quality = evaluateQuality(
      { ...media.quality, allowSeasonPacks: true },
      parsed,
      item,
    );

    const wantsSession = sessionAllowed(subscription, sportRelease.session);
    const sessionLabel = SESSION_LABELS[sportRelease.session];

    const decision = !wantsSession
      ? { ok: false, reason: `${sessionLabel.toLowerCase()} is not wanted`, score: 0 }
      : !quality.ok
        ? quality
        : match.confident || subscription.autoGrabUncertain
          ? quality
          : {
              ok: false,
              reason: `not sure enough to grab on its own (${match.reasons.join(", ")})`,
              score: quality.score,
            };

    releases.push({
      item,
      quality: describeQuality(parsed),
      label: match.episode.title ?? sessionLabel,
      seeders: item.seeders,
      sizeBytes: item.sizeBytes,
      decision,
      publishedAt: item.publishedAt,
      confidence: {
        score: match.score,
        confident: match.confident,
        reasons: match.reasons,
      },
    });
  }

  return releases.sort((a, b) => {
    if (a.decision.ok !== b.decision.ok) return a.decision.ok ? -1 : 1;
    const byConfidence = (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0);
    if (byConfidence !== 0) return byConfidence;
    return b.decision.score - a.decision.score;
  });
}

function describeEpisodeNumbers(season: number, episodes: number[]): string {
  if (episodes.length === 1) return `S${pad(season)}E${pad(episodes[0])}`;
  return `S${pad(season)}E${pad(Math.min(...episodes))}-E${pad(Math.max(...episodes))}`;
}

/** Force a grab the user asked for explicitly, bypassing the quality filter. */
export async function grabItemManually(
  itemId: number,
  mediaId: number,
  db: Db = getDb(),
): Promise<{ ok: boolean; message: string }> {
  const item = repo.getFeedItem(itemId, db);
  const media = repo.getMedia(mediaId, db);
  if (!item) return { ok: false, message: "release is no longer cached" };
  if (!media) return { ok: false, message: "title not found" };

  const parsed = parseRelease(item.title);
  const quality = describeQuality(parsed);

  let episodes: Episode[] = [];
  if (media.kind === "sport") {
    const match = bestSportMatch(parseSportRelease(item.title), repo.listEpisodes(media.id, db));
    if (!match) {
      return { ok: false, message: "this release does not look like any event on the calendar" };
    }
    episodes = [match.episode];
  } else if (media.kind === "tv" && parsed.season !== null) {
    const seasonEpisodes = repo.listSeasonEpisodes(media.id, parsed.season, db);
    episodes = episodesForRelease(parsed, seasonEpisodes);
  } else if (media.kind === "tv" && parsed.airDate) {
    const episode = repo.findEpisodeByAirDate(media.id, parsed.airDate, db);
    if (episode) episodes = [episode];
  }

  const outcome = await grabTarget(
    item,
    { media, episodes, reason: "grabbed manually" },
    quality,
    db,
  );
  return outcome === "grabbed"
    ? { ok: true, message: `Sent ${item.title} to the download folder` }
    : { ok: false, message: "Grab failed — see activity for details" };
}

/* ------------------------------------------------------------------ */
/* Library management                                                   */
/* ------------------------------------------------------------------ */

export type MonitorMode = "all" | "future" | "none";

export interface AddMediaInput {
  result: providers.SearchResult;
  quality: QualityProfile;
  monitorMode?: MonitorMode;
  folder?: string | null;
  searchTerms?: string[];
}

export interface AddSportInput {
  /** Catalogue id, e.g. "ufc" or "eng.1". */
  leagueId: string;
  /** Competitors to follow. Empty means every event in the competition. */
  teams: string[];
  sessions: SportSession[];
  autoGrabUncertain: boolean;
  quality: QualityProfile;
  folder?: string | null;
}

/**
 * Follow a competition, and pull in its calendar.
 *
 * Unlike a show, a competition has no metadata record to fetch — it is an
 * entry in the catalogue plus a choice about which of it to follow. The
 * calendar is the interesting part, and it is fetched here so the library
 * screen has something to show immediately.
 */
export async function addSport(input: AddSportInput, db: Db = getDb()): Promise<Media> {
  const league = sports.findLeague(input.leagueId);
  if (!league) throw new Error(`unknown competition: ${input.leagueId}`);

  const media = repo.insertMedia(
    {
      kind: "sport",
      provider: "espn",
      providerId: league.id,
      title: league.name,
      overview: null,
      poster: league.logo,
      status: null,
      network: league.fullName,
      genres: [league.group],
      quality: input.quality,
      folder: input.folder ?? null,
      sport: {
        league: league.id,
        teams: input.teams,
        sessions: input.sessions,
        autoGrabUncertain: input.autoGrabUncertain,
      },
    },
    db,
  );

  await syncSportEvents(media, db);
  repo.updateMedia(media.id, { refreshedAt: nowIso() }, db);
  repo.enqueueJob("search_media", { mediaId: media.id }, db);

  return repo.getMedia(media.id, db)!;
}

export interface SportSyncSummary {
  inserted: number;
  updated: number;
  /** Events dropped because they involve nobody being followed. */
  filtered: number;
}

/**
 * Pull a competition's calendar into the library.
 *
 * The team filter is applied here rather than at match time on purpose: a
 * followed NHL team plays 82 games, and the league schedules 1,300. Writing
 * only the followed ones keeps the calendar the size of what someone actually
 * asked for, and keeps matching fast.
 */
export async function syncSportEvents(
  media: Media,
  db: Db = getDb(),
): Promise<SportSyncSummary> {
  const subscription = media.sport;
  if (!subscription) return { inserted: 0, updated: 0, filtered: 0 };

  const config = getSportsConfig(db);
  const now = Date.now();
  const from = new Date(now - config.lookbehindDays * 86_400_000);
  const to = new Date(now + config.lookaheadDays * 86_400_000);

  const events = await sports.fetchEvents(subscription.league, from, to);

  const wanted = events.filter((event) => eventIsFollowed(subscription, event.competitors));
  const rows = wanted.map((event) => ({
    mediaId: media.id,
    providerId: event.id,
    season: event.seasonYear,
    title: event.name,
    airDate: event.date,
    // Everything in the window is wanted: a release always lands after the
    // broadcast, so a past event is the normal case rather than a backlog.
    monitored: true,
    sport: {
      eventNumber: event.eventNumber,
      competitors: event.competitors,
      identityGroups: event.identityGroups,
    },
  }));

  const totals = repo.upsertSportEvents(rows, db);
  return { ...totals, filtered: events.length - wanted.length };
}

/** Add a show or movie to the library and pull in its episode list. */
export async function addMedia(input: AddMediaInput, db: Db = getDb()): Promise<Media> {
  const { result } = input;

  const media = repo.insertMedia(
    {
      kind: result.kind,
      provider: result.provider,
      providerId: result.providerId,
      imdbId: result.imdbId,
      tvdbId: result.tvdbId,
      title: result.title,
      year: result.year,
      overview: result.overview,
      poster: result.poster,
      status: result.status,
      network: result.network,
      runtime: result.runtime,
      genres: result.genres,
      quality: input.quality,
      searchTerms: input.searchTerms ?? [],
      folder: input.folder ?? null,
      releaseDate: result.releaseDate,
    },
    db,
  );

  if (result.kind === "tv") {
    await syncEpisodes(media, input.monitorMode ?? "future", db);
  }

  repo.updateMedia(media.id, { refreshedAt: nowIso() }, db);

  // Cross off whatever Plex already holds *before* searching, so adding a show
  // you own most of does not immediately queue its whole back catalogue.
  // Jobs run in id order, so this lands first.
  if (getConfig(db).plex.enabled) {
    repo.enqueueJob("sync_plex", { mediaId: media.id }, db);
  }

  // Releases for this title may already be sitting in the feed cache.
  repo.enqueueJob("search_media", { mediaId: media.id }, db);

  return repo.getMedia(media.id, db)!;
}

/**
 * Pull the episode list from the provider.
 *
 * `monitorMode` only applies to episodes we have not seen before, so a
 * scheduled refresh never re-monitors something the user turned off.
 */
export async function syncEpisodes(
  media: Media,
  monitorMode: MonitorMode | null,
  db: Db = getDb(),
): Promise<number> {
  const episodes = await providers.getTvEpisodes(media.providerId);
  const known = new Set(
    repo.listEpisodes(media.id, db).map((episode) => `${episode.season}x${episode.number}`),
  );
  const now = Date.now();

  const rows = episodes.map((episode) => {
    const isKnown = known.has(`${episode.season}x${episode.number}`);
    const airedInFuture = episode.airDate ? new Date(episode.airDate).getTime() > now : true;

    let monitored = true;
    if (!isKnown && monitorMode === "none") monitored = false;
    else if (!isKnown && monitorMode === "future") monitored = airedInFuture;

    return {
      mediaId: media.id,
      providerId: episode.providerId,
      season: episode.season,
      number: episode.number,
      title: episode.title,
      airDate: episode.airDate,
      runtime: episode.runtime,
      // Existing rows keep their flag; upsert only writes it on insert.
      monitored,
    };
  });

  repo.upsertEpisodes(rows, db);
  return rows.length;
}

export async function refreshMedia(mediaId: number, db: Db = getDb()): Promise<void> {
  const media = repo.getMedia(mediaId, db);
  if (!media) return;

  // A competition has no metadata record to refresh — its calendar is the
  // thing that changes.
  if (media.kind === "sport") {
    await syncSportEvents(media, db);
    repo.updateMedia(media.id, { refreshedAt: nowIso() }, db);
    return;
  }

  const config = getConfig(db);
  const fresh = await providers.refreshMetadata(
    media.kind,
    media.provider,
    media.providerId,
    config.general.tmdbApiKey,
  );

  repo.updateMedia(
    media.id,
    {
      title: fresh.title,
      year: fresh.year,
      overview: fresh.overview,
      poster: fresh.poster,
      status: fresh.status,
      network: fresh.network,
      runtime: fresh.runtime,
      genres: fresh.genres,
      releaseDate: fresh.releaseDate,
      refreshedAt: nowIso(),
    },
    db,
  );

  if (media.kind === "tv") {
    // Newly announced episodes inherit the show's monitoring by default.
    await syncEpisodes(media, media.monitored ? "all" : "none", db);
  }
}

export async function refreshAll(db: Db = getDb()): Promise<{ refreshed: number; errors: number }> {
  const library = repo.listMedia({}, db);
  let refreshed = 0;
  let errors = 0;

  for (const media of library) {
    try {
      await refreshMedia(media.id, db);
      refreshed += 1;
    } catch (error) {
      errors += 1;
      repo.addHistory(
        {
          mediaId: media.id,
          event: "error",
          title: media.title,
          reason: `metadata refresh failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        db,
      );
    }
  }

  return { refreshed, errors };
}

/** Default quality profile for a library, used when adding a title. */
export function defaultQualityFor(kind: MediaKind, db: Db = getDb()): QualityProfile {
  return getKindConfig(kind, db).quality;
}
