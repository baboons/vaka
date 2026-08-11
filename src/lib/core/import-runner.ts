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
 * without being imported unless `importExisting` is on — connecting tvarr to a
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

    if (adoptWithoutImporting) {
      repo.recordImport(
        {
          sourceKey: key,
          name: torrent.name,
          status: "skipped",
          detail: "already complete when tvarr was connected",
        },
        db,
      );
      summary.skipped += 1;
      continue;
    }

    const source = transmission.localPathFor(torrent, config.transmission);

    try {
      await fs.access(source);
    } catch {
      repo.recordImport(
        {
          sourceKey: key,
          name: torrent.name,
          path: source,
          status: "failed",
          detail: `tvarr cannot see ${source} — check the path mapping`,
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

/** Both sources, for the scheduler and the "import now" action. */
export async function scanAll(db: Db = getDb()): Promise<ScanSummary> {
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
  return summary;
}

export function describeScan(summary: ScanSummary): string {
  if (!summary.considered) return "Nothing new to import";
  const parts = [`${summary.files} file${summary.files === 1 ? "" : "s"} imported`];
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  return parts.join(", ");
}
