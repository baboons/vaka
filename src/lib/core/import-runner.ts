/**
 * Finding finished downloads and handing them to the importer.
 *
 * Two sources, either or both:
 *   - Transmission, polled over RPC for torrents that have completed
 *   - a watch folder, for anything that lands there by other means
 *
 * Every download is recorded once it has been dealt with, so a torrent that
 * seeds for a week is not re-imported on every sweep.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { expandHome, getDb, type Db } from "./db";
import { importPath, type ImportOutcome } from "./import";
import * as repo from "./repo";
import { getConfig } from "./settings";
import * as transmission from "./transmission";

export interface ScanSummary {
  considered: number;
  imported: number;
  files: number;
  skipped: number;
  failed: number;
  errors: string[];
}

function empty(): ScanSummary {
  return { considered: 0, imported: 0, files: 0, skipped: 0, failed: 0, errors: [] };
}

function absorb(summary: ScanSummary, outcome: ImportOutcome): void {
  summary.files += outcome.imported.length;
  summary.skipped += outcome.skipped.length;
  summary.failed += outcome.failed.length;
}

/**
 * Import everything Transmission has finished.
 *
 * On the very first run, existing completed torrents are recorded as seen
 * without being imported unless `importExisting` is on — connecting vaka to a
 * client with a year of history should not suddenly move a year of files.
 */
export async function scanTransmission(db: Db = getDb()): Promise<ScanSummary> {
  const config = getConfig(db);
  const summary = empty();
  if (!config.transmission.enabled || !config.importing.enabled) return summary;

  let completed: transmission.TransmissionTorrent[];
  try {
    completed = await transmission.listCompleted(config.transmission);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(message);
    return summary;
  }

  const firstRun = repo.listImports(1, db).length === 0;
  const adoptWithoutImporting = firstRun && !config.transmission.importExisting;

  for (const torrent of completed) {
    const key = `transmission:${torrent.hashString}`;
    if (repo.wasImported(key, db)) continue;
    summary.considered += 1;

    // Adoption is for downloads that were already there when vaka arrived —
    // never for something vaka grabbed itself, however recently the client
    // finished it. Without this, connecting a client on the same day vaka
    // grabbed an episode silently skips that episode forever.
    if (adoptWithoutImporting && !repo.wasGrabbedByVaka(torrent.name, db)) {
      repo.recordImport(
        {
          sourceKey: key,
          name: torrent.name,
          // "adopted" is deliberate and final; "skipped" gets retried.
          status: "adopted",
          detail: "already complete when vaka was connected",
        },
        db,
      );
      summary.skipped += 1;
      continue;
    }

    const source = transmission.localPathFor(torrent, config.transmission);

    // A watch folder pointing at Transmission's own download directory would
    // otherwise file the same download twice, under two different keys.
    if (repo.wasPathImported(source, db)) {
      repo.recordImport(
        {
          sourceKey: key,
          name: torrent.name,
          path: source,
          status: "adopted",
          detail: "already filed from the watch folder",
        },
        db,
      );
      continue;
    }

    try {
      await fs.access(source);
    } catch {
      repo.recordImport(
        {
          sourceKey: key,
          name: torrent.name,
          path: source,
          status: "failed",
          detail: `vaka cannot see ${source} — check the path mapping`,
        },
        db,
      );
      summary.failed += 1;
      summary.errors.push(`cannot reach ${source}`);
      continue;
    }

    const outcome = await importPath(source, db, { releaseName: torrent.name });
    absorb(summary, outcome);
    if (outcome.imported.length) summary.imported += 1;

    repo.recordImport(
      {
        sourceKey: key,
        name: torrent.name,
        path: source,
        fileCount: outcome.imported.length,
        libraryPaths: outcome.imported.map((item) => item.destination),
        status: outcome.imported.length ? "done" : outcome.failed.length ? "failed" : "skipped",
        detail: outcome.imported.length
          ? null
          : (outcome.failed[0]?.reason ?? outcome.skipped[0]?.reason ?? "nothing to import"),
      },
      db,
    );
  }

  return summary;
}

/** Import anything sitting in the configured watch folder. */
export async function scanWatchDir(db: Db = getDb()): Promise<ScanSummary> {
  const config = getConfig(db);
  const summary = empty();
  if (!config.importing.enabled || !config.importing.watchDir.trim()) return summary;

  const root = path.resolve(expandHome(config.importing.watchDir.trim()));

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
    return summary;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    // Partial downloads are not ready to be filed.
    if (/\.(part|!qb|bts|tmp)$/i.test(entry.name)) continue;

    const source = path.join(root, entry.name);
    const key = `path:${source}`;
    if (repo.wasImported(key, db)) continue;

    // Transmission may already have filed this exact path.
    if (repo.wasPathImported(source, db)) {
      repo.recordImport(
        {
          sourceKey: key,
          name: entry.name,
          path: source,
          status: "adopted",
          detail: "already filed from the torrent client",
        },
        db,
      );
      continue;
    }

    summary.considered += 1;

    const outcome = await importPath(source, db, { releaseName: entry.name });
    absorb(summary, outcome);
    if (outcome.imported.length) summary.imported += 1;

    repo.recordImport(
      {
        sourceKey: key,
        name: entry.name,
        path: source,
        fileCount: outcome.imported.length,
        libraryPaths: outcome.imported.map((item) => item.destination),
        status: outcome.imported.length ? "done" : outcome.failed.length ? "failed" : "skipped",
        detail: outcome.imported.length
          ? null
          : (outcome.failed[0]?.reason ?? outcome.skipped[0]?.reason ?? "nothing to import"),
      },
      db,
    );
  }

  return summary;
}

/* ------------------------------------------------------------------ */
/* Retiring torrents once they have seeded enough                       */
/* ------------------------------------------------------------------ */

export interface CleanupSummary {
  checked: number;
  cleaned: number;
  freedBytes: number;
  errors: string[];
}

export interface SeedingThresholds {
  afterDays: number;
  minRatio: number;
  requireBoth: boolean;
}

/**
 * Has this torrent seeded enough to retire?
 *
 * With `requireBoth` off — the default, and how trackers usually phrase their
 * rules — either threshold is enough. A threshold set to 0 is ignored, and if
 * both are 0 nothing is ever cleaned up.
 */
export function hasSeededEnough(
  torrent: { uploadRatio: number; secondsSeeding: number },
  thresholds: SeedingThresholds,
): { met: boolean; reason: string } {
  const days = Math.max(0, torrent.secondsSeeding) / 86400;
  const ratio = Math.max(0, torrent.uploadRatio);

  const checks: Array<{ met: boolean; label: string }> = [];
  if (thresholds.afterDays > 0) {
    checks.push({
      met: days >= thresholds.afterDays,
      label: `seeded ${days.toFixed(1)} of ${thresholds.afterDays} days`,
    });
  }
  if (thresholds.minRatio > 0) {
    checks.push({
      met: ratio >= thresholds.minRatio,
      label: `ratio ${ratio.toFixed(2)} of ${thresholds.minRatio}`,
    });
  }

  if (!checks.length) return { met: false, reason: "no thresholds set" };

  const met = thresholds.requireBoth
    ? checks.every((check) => check.met)
    : checks.some((check) => check.met);

  return { met, reason: checks.map((check) => check.label).join(", ") };
}

/**
 * Remove torrents vaka imported once they have seeded enough.
 *
 * Two things make this safe to run unattended:
 *   - only torrents recorded in the imports ledger are considered, so nothing
 *     the user added by hand is ever touched
 *   - the library copy is confirmed to still exist first, so a file that was
 *     moved or deleted from the library is never left with no copy at all
 */
export async function cleanupSeeded(db: Db = getDb()): Promise<CleanupSummary> {
  const config = getConfig(db);
  const summary: CleanupSummary = { checked: 0, cleaned: 0, freedBytes: 0, errors: [] };

  if (!config.importing.cleanupEnabled || !config.transmission.enabled) return summary;
  if (config.importing.cleanupAfterDays <= 0 && config.importing.cleanupMinRatio <= 0) {
    return summary;
  }

  const candidates = repo.listCleanupCandidates(db);
  if (!candidates.length) return summary;

  const byHash = new Map(
    candidates
      .filter((record) => record.sourceKey.startsWith("transmission:"))
      .map((record) => [record.sourceKey.slice("transmission:".length), record]),
  );
  if (!byHash.size) return summary;

  let torrents: transmission.TransmissionTorrent[];
  try {
    torrents = await transmission.listTorrents(config.transmission);
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
    return summary;
  }

  const thresholds: SeedingThresholds = {
    afterDays: config.importing.cleanupAfterDays,
    minRatio: config.importing.cleanupMinRatio,
    requireBoth: config.importing.cleanupRequireBoth,
  };

  for (const torrent of torrents) {
    const record = byHash.get(torrent.hashString);
    if (!record) continue;
    summary.checked += 1;

    const verdict = hasSeededEnough(torrent, thresholds);
    if (!verdict.met) continue;

    const libraryFiles = record.libraryPaths;

    // Imports recorded before cleanup existed have no destinations stored, so
    // there is nothing to verify. Retire them from consideration quietly
    // rather than erroring on every sweep for the rest of time.
    if (!libraryFiles.length) {
      repo.markImportCleaned(
        record.sourceKey,
        "left alone — imported before vaka tracked library paths",
        db,
      );
      continue;
    }

    // The whole point of the import was the library copy. If it is gone,
    // deleting the download would leave nothing at all.
    const present = await Promise.all(
      libraryFiles.map(async (file) => {
        try {
          await fs.access(file);
          return true;
        } catch {
          return false;
        }
      }),
    );

    if (present.some((exists) => !exists)) {
      const message = `library copy missing, left ${torrent.name} alone`;
      summary.errors.push(message);
      repo.addHistory({ event: "error", title: torrent.name, reason: `cleanup skipped — ${message}` }, db);
      continue;
    }

    try {
      await transmission.removeTorrent(config.transmission, torrent.id, true);
      repo.markImportCleaned(record.sourceKey, `retired after seeding (${verdict.reason})`, db);
      summary.cleaned += 1;
      summary.freedBytes += torrent.totalSize ?? 0;

      repo.addHistory(
        {
          event: "info",
          title: torrent.name,
          reason: `seeding finished (${verdict.reason}) — removed from Transmission, library copy kept`,
        },
        db,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${torrent.name}: ${message}`);
    }
  }

  return summary;
}

/** Both sources plus cleanup, for the scheduler and the "import now" action. */
export async function scanAll(db: Db = getDb()): Promise<ScanSummary & { cleaned: number }> {
  const summary = empty();
  for (const scan of [scanTransmission, scanWatchDir]) {
    const result = await scan(db);
    summary.considered += result.considered;
    summary.imported += result.imported;
    summary.files += result.files;
    summary.skipped += result.skipped;
    summary.failed += result.failed;
    summary.errors.push(...result.errors);
  }

  // Retiring finished torrents happens on the same pass; it is cheap and
  // needs the same connection.
  const cleanup = await cleanupSeeded(db);
  summary.errors.push(...cleanup.errors);

  return { ...summary, cleaned: cleanup.cleaned };
}

export function describeScan(summary: ScanSummary & { cleaned?: number }): string {
  const parts: string[] = [];
  if (summary.considered) {
    parts.push(`${summary.files} file${summary.files === 1 ? "" : "s"} imported`);
    if (summary.skipped) parts.push(`${summary.skipped} skipped`);
    if (summary.failed) parts.push(`${summary.failed} failed`);
  }
  if (summary.cleaned) {
    parts.push(`${summary.cleaned} torrent${summary.cleaned === 1 ? "" : "s"} retired`);
  }
  return parts.length ? parts.join(", ") : "Nothing new to import";
}
