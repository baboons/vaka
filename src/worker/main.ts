#!/usr/bin/env node
/**
 * The tvarr watcher.
 *
 * A long-running background process (launchd on macOS, systemd on Linux) that
 * polls the configured RSS feeds, matches new releases against the library and
 * writes wanted ones into the blackhole folder. It runs independently of the
 * web UI — the UI is only for managing what it should be looking for.
 *
 * The two processes communicate through the SQLite database: the UI queues
 * jobs, the watcher claims them on its next tick and reports back a heartbeat.
 */

import { pruneCacheVersions } from "../lib/core/cache";
import { closeDb, getDb } from "../lib/core/db";
import {
  evaluatePendingItems,
  grabItemManually,
  pollFeeds,
  refreshAll,
  refreshMedia,
  searchForMedia,
} from "../lib/core/engine";
import { describeScan, scanAll } from "../lib/core/import-runner";
import { syncPlexSafely } from "../lib/core/plex";
import * as repo from "../lib/core/repo";
import { getConfig, getWorkerState, isWorkerOnline, saveWorkerState } from "../lib/core/settings";
import type { Job } from "../lib/core/types";

/** How often the loop wakes up to look for queued work. */
const TICK_MS = 5_000;
/** How often the heartbeat is written, so the UI can show the watcher is up. */
const HEARTBEAT_MS = 30_000;
/** Housekeeping (pruning old feed items and job rows). */
const MAINTENANCE_MS = 6 * 60 * 60 * 1000;

const LEVEL_COLOURS: Record<string, string> = {
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
  ok: "\u001b[32m",
};

const RESET = "\u001b[0m";
const DIM = "\u001b[90m";

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;

function log(level: keyof typeof LEVEL_COLOURS, message: string): void {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const label = level.toUpperCase().padEnd(5);
  const line = useColour
    ? `${DIM}${stamp}${RESET} ${LEVEL_COLOURS[level]}${label}${RESET} ${message}`
    : `${stamp} ${label} ${message}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

let stopping = false;
let nextPollAt = 0;
let nextRefreshAt = 0;
let nextHeartbeatAt = 0;
let nextMaintenanceAt = 0;
let nextPlexSyncAt = 0;
let nextImportAt = 0;

async function runPoll(reason: string): Promise<void> {
  const db = getDb();
  log("info", `checking feeds (${reason})`);

  const poll = await pollFeeds(db);
  for (const error of poll.errors) log("error", error);

  if (poll.newItems > 0) {
    log(
      "info",
      `${poll.newItems} new release${poll.newItems === 1 ? "" : "s"} across ${poll.feeds} feed${
        poll.feeds === 1 ? "" : "s"
      }`,
    );
  }

  const evaluation = await evaluatePendingItems(db);
  if (evaluation.grabbed > 0) {
    log("ok", `grabbed ${evaluation.grabbed}`);
  }
  if (evaluation.considered > 0) {
    log(
      "info",
      `evaluated ${evaluation.considered} (${evaluation.grabbed} grabbed, ` +
        `${evaluation.rejected} rejected, ${evaluation.errors} failed)`,
    );
  }

  saveWorkerState({ lastPollAt: new Date().toISOString(), lastError: null }, db);
}

async function runJob(job: Job): Promise<string> {
  const db = getDb();

  switch (job.type) {
    case "poll_feeds": {
      await runPoll("requested");
      return "feeds checked";
    }
    case "search_media": {
      const mediaId = Number(job.payload.mediaId);
      const media = repo.getMedia(mediaId, db);
      const summary = await searchForMedia(mediaId, db);
      log(
        "info",
        `searched cached releases for ${media?.title ?? mediaId}: ` +
          `${summary.grabbed} grabbed of ${summary.considered} considered`,
      );
      return `${summary.grabbed} grabbed, ${summary.rejected} rejected`;
    }
    case "refresh_media": {
      const mediaId = Number(job.payload.mediaId);
      await refreshMedia(mediaId, db);
      // New episodes may already have releases waiting in the cache.
      await searchForMedia(mediaId, db);
      return "metadata refreshed";
    }
    case "refresh_all": {
      const result = await refreshAll(db);
      log("info", `refreshed ${result.refreshed} titles (${result.errors} failed)`);
      return `${result.refreshed} refreshed, ${result.errors} failed`;
    }
    case "grab_item": {
      const result = await grabItemManually(
        Number(job.payload.itemId),
        Number(job.payload.mediaId),
        db,
      );
      if (!result.ok) throw new Error(result.message);
      log("ok", result.message);
      return result.message;
    }
    case "sync_plex": {
      const mediaId = job.payload.mediaId ? Number(job.payload.mediaId) : undefined;
      const result = await syncPlexSafely({ mediaId }, db);
      if (!result.ok) throw new Error(result.message);
      log("ok", `plex: ${result.message}`);
      return result.message;
    }
    case "import_scan": {
      const summary = await scanAll(db);
      for (const error of summary.errors) log("error", `import: ${error}`);
      const message = describeScan(summary);
      if (summary.files > 0) log("ok", `import: ${message}`);
      return message;
    }
    default:
      throw new Error(`unknown job type: ${job.type}`);
  }
}

async function drainJobs(): Promise<void> {
  const db = getDb();
  for (let processed = 0; processed < 25 && !stopping; processed += 1) {
    const job = repo.claimNextJob(db);
    if (!job) return;

    log("info", `job #${job.id} ${job.type}`);
    try {
      const result = await runJob(job);
      repo.finishJob(job.id, "done", result, db);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `job #${job.id} ${job.type} failed: ${message}`);
      repo.finishJob(job.id, "failed", message, db);
    }
  }
}

async function tick(): Promise<void> {
  const db = getDb();
  const config = getConfig(db);
  const now = Date.now();

  await drainJobs();

  // Ahead of the feed poll on purpose: crossing off what Plex already holds
  // has to happen before releases are judged, or the first run after a
  // restart would grab a back catalogue you already own.
  if (config.plex.enabled && now >= nextPlexSyncAt) {
    nextPlexSyncAt = now + config.plex.syncIntervalMinutes * 60_000;
    const result = await syncPlexSafely({}, db);
    if (!result.ok) {
      log("error", `plex: ${result.message}`);
    } else if (result.summary && result.summary.markedEpisodes + result.summary.markedMovies > 0) {
      log("ok", `plex: ${result.message}`);
    }
  }

  if (now >= nextPollAt) {
    const interval = config.general.pollIntervalMinutes * 60_000;
    nextPollAt = now + interval;
    try {
      await runPoll("scheduled");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `poll failed: ${message}`);
      saveWorkerState({ lastError: message }, db);
    }
    saveWorkerState({ nextPollAt: new Date(nextPollAt).toISOString() }, db);
  }

  if (now >= nextRefreshAt) {
    const interval = config.general.refreshIntervalHours * 3_600_000;
    // Skip the refresh on the very first tick; startup already has work to do.
    if (nextRefreshAt !== 0) {
      try {
        const result = await refreshAll(db);
        log("info", `metadata refresh: ${result.refreshed} updated, ${result.errors} failed`);
      } catch (error) {
        log("error", `metadata refresh failed: ${String(error)}`);
      }
    }
    nextRefreshAt = now + interval;
  }

  // Importing runs on its own, faster cadence: a download finishing has
  // nothing to do with when the feeds are next due.
  if (config.importing.enabled && now >= nextImportAt) {
    nextImportAt = now + config.importing.scanIntervalMinutes * 60_000;
    try {
      const summary = await scanAll(db);
      for (const error of summary.errors) log("error", `import: ${error}`);
      if (summary.files > 0) log("ok", `import: ${describeScan(summary)}`);
    } catch (error) {
      log("error", `import scan failed: ${String(error)}`);
    }
  }

  if (now >= nextMaintenanceAt) {
    if (nextMaintenanceAt !== 0) {
      const removed = repo.pruneFeedItems(config.general.feedRetentionDays, db);
      repo.pruneJobs(200, db);
      pruneCacheVersions(db);
      if (removed) log("info", `pruned ${removed} cached feed items`);
    }
    nextMaintenanceAt = now + MAINTENANCE_MS;
  }

  if (now >= nextHeartbeatAt) {
    nextHeartbeatAt = now + HEARTBEAT_MS;
    saveWorkerState({ heartbeatAt: new Date().toISOString() }, db);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const db = getDb();
  const force = process.argv.includes("--force");

  const existing = getWorkerState(db);
  if (
    !force &&
    isWorkerOnline(existing) &&
    existing.pid &&
    existing.pid !== process.pid &&
    isProcessAlive(existing.pid)
  ) {
    log("error", `another watcher is already running (pid ${existing.pid}). Use --force to override.`);
    process.exit(1);
  }

  const requeued = repo.requeueStaleJobs(db);
  if (requeued) log("warn", `re-queued ${requeued} job(s) left over from a previous run`);

  saveWorkerState(
    {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      lastError: null,
    },
    db,
  );

  const config = getConfig(db);
  const feeds = repo.listFeeds(true, db);
  const library = repo.listMedia({ monitoredOnly: true }, db);

  log("ok", `tvarr watcher started (pid ${process.pid})`);
  log(
    "info",
    `${library.length} monitored title${library.length === 1 ? "" : "s"}, ` +
      `${feeds.length} enabled feed${feeds.length === 1 ? "" : "s"}, ` +
      `checking every ${config.general.pollIntervalMinutes} min`,
  );
  log("info", `TV folder:     ${config.tv.downloadDir}`);
  log("info", `Movie folder:  ${config.movies.downloadDir}`);

  if (!feeds.length) {
    log("warn", "no enabled feeds configured — add one in Settings and the watcher will pick it up");
  }

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `tick failed: ${message}`);
      saveWorkerState({ lastError: message }, db);
    }
    await sleep(TICK_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timers.add(timer);
  });
}

const timers = new Set<NodeJS.Timeout>();

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log("warn", `received ${signal}, shutting down`);
  for (const timer of timers) clearTimeout(timer);
  try {
    saveWorkerState({ pid: null, heartbeatAt: null });
  } catch {
    // The database may already be closed; nothing useful to do here.
  }
  closeDb();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  log("error", error instanceof Error ? error.stack ?? error.message : String(error));
  closeDb();
  process.exit(1);
});
