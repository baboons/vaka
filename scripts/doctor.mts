#!/usr/bin/env tsx
/**
 * Explains why a finished download did or did not end up in the library.
 *
 *   pnpm run doctor                 check config, then explain every download
 *   pnpm run doctor --retry <text>  forget records matching <text> so they retry
 *   pnpm run doctor --now           run an import scan immediately
 *
 * Read-only unless --retry or --now is given.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { dataDir, expandHome, getDb } from "../src/lib/core/db";
import { planImport } from "../src/lib/core/import";
import { describeScan, scanAll } from "../src/lib/core/import-runner";
import * as repo from "../src/lib/core/repo";
import { getConfig } from "../src/lib/core/settings";
import * as transmission from "../src/lib/core/transmission";

const args = process.argv.slice(2);
const retryIndex = args.indexOf("--retry");
const retryTerm = retryIndex >= 0 ? args[retryIndex + 1] : null;
const runNow = args.includes("--now");

const OK = "\u001b[32m✓\u001b[0m";
const BAD = "\u001b[31m✗\u001b[0m";
const WARN = "\u001b[33m!\u001b[0m";
const DIM = "\u001b[90m";
const RESET = "\u001b[0m";

const db = getDb();
const config = getConfig(db);

function heading(text: string) {
  console.log(`\n\u001b[1m${text}\u001b[0m`);
}

async function folderState(dir: string): Promise<string> {
  if (!dir.trim()) return `${BAD} not set`;
  const resolved = path.resolve(expandHome(dir.trim()));
  try {
    await fs.access(resolved, fs.constants.W_OK);
    return `${OK} ${resolved}`;
  } catch (error) {
    return `${BAD} ${resolved} — ${error instanceof Error ? error.message : "unusable"}`;
  }
}

/* ------------------------------------------------------------------ */

if (retryTerm) {
  const term = retryTerm.toLowerCase();
  const matches = repo
    .listImports(1000, db)
    .filter(
      (record) =>
        (record.name ?? "").toLowerCase().includes(term) ||
        record.sourceKey.toLowerCase().includes(term),
    );

  if (!matches.length) {
    console.log(`\nNothing recorded matches "${retryTerm}".\n`);
    process.exit(0);
  }

  for (const record of matches) {
    repo.forgetImport(record.sourceKey, db);
    console.log(`  forgot  ${record.name ?? record.sourceKey}`);
  }
  console.log(
    `\n${matches.length} record(s) cleared — they will be retried on the next scan.` +
      `\nRun \`pnpm run doctor --now\` to do it immediately.\n`,
  );
  process.exit(0);
}

heading("Configuration");
console.log(`  Data dir        ${dataDir()}`);
console.log(
  `  Importing       ${config.importing.enabled ? `${OK} on` : `${BAD} OFF — nothing will be filed`}` +
    `   ${DIM}mode: ${config.importing.mode}, ignore < ${config.importing.minSizeMb} MB${RESET}`,
);
console.log(`  TV library      ${await folderState(config.tv.libraryDir)}`);
console.log(`  Movie library   ${await folderState(config.movies.libraryDir)}`);
console.log(
  `  Watch folder    ${config.importing.watchDir.trim() ? await folderState(config.importing.watchDir) : `${DIM}none${RESET}`}`,
);
console.log(
  `  Transmission    ${config.transmission.enabled ? `${OK} on` : `${DIM}off${RESET}`}   ${DIM}${config.transmission.url}${RESET}`,
);

if (!config.importing.enabled) {
  console.log(
    `\n  ${WARN} Importing is switched off. Turn on "File finished downloads into my` +
      `\n    library" under Settings → Import.\n`,
  );
}

/* ------------------------------------------------------------------ */

let torrents: transmission.TransmissionTorrent[] = [];

if (config.transmission.enabled) {
  heading("Transmission");
  try {
    const status = await transmission.testConnection(config.transmission);
    console.log(
      `  ${OK} Transmission ${status.version} — ${status.total} torrents, ${status.completed} finished`,
    );
    console.log(`  ${DIM}its download dir: ${status.downloadDir}${RESET}`);
    torrents = await transmission.listCompleted(config.transmission);
  } catch (error) {
    console.log(`  ${BAD} ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* ------------------------------------------------------------------ */

heading("Finished downloads");

const ledger = new Map(repo.listImports(1000, db).map((record) => [record.sourceKey, record]));

interface Candidate {
  key: string;
  name: string;
  source: string;
}

const candidates: Candidate[] = torrents.map((torrent) => ({
  key: `transmission:${torrent.hashString}`,
  name: torrent.name,
  source: transmission.localPathFor(torrent, config.transmission),
}));

if (config.importing.watchDir.trim()) {
  const root = path.resolve(expandHome(config.importing.watchDir.trim()));
  try {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const source = path.join(root, entry.name);
      if (candidates.some((candidate) => candidate.source === source)) continue;
      candidates.push({ key: `path:${source}`, name: entry.name, source });
    }
  } catch (error) {
    console.log(`  ${BAD} cannot read the watch folder — ${String(error)}`);
  }
}

if (!candidates.length) {
  console.log(
    `  ${DIM}Nothing to look at. Enable Transmission or set a watch folder.${RESET}\n`,
  );
  process.exit(0);
}

for (const candidate of candidates) {
  const record = ledger.get(candidate.key);
  const short = candidate.name.length > 74 ? `${candidate.name.slice(0, 71)}…` : candidate.name;

  if (record?.status === "done") {
    console.log(`  ${OK} ${short}`);
    console.log(`      ${DIM}filed ${record.fileCount} file(s)${RESET}`);
    for (const file of record.libraryPaths.slice(0, 3)) {
      console.log(`      ${DIM}→ ${file}${RESET}`);
    }
    continue;
  }

  if (record?.status === "adopted") {
    console.log(`  ${DIM}—  ${short}${RESET}`);
    console.log(`      ${DIM}left alone: ${record.detail ?? "adopted"}${RESET}`);
    console.log(
      `      ${DIM}file it anyway: pnpm run doctor --retry "${candidate.name.slice(0, 32)}"${RESET}`,
    );
    continue;
  }

  // Anything not finished is re-planned live rather than reported from the
  // ledger: the old verdict may predate the setting that has since been fixed.
  const previously = record ? `${record.status}: ${record.detail ?? "no reason"}` : null;

  try {
    await fs.access(candidate.source);
  } catch {
    console.log(`  ${BAD} ${short}`);
    console.log(`      tvarr cannot see ${candidate.source}`);
    console.log(`      ${DIM}set a path mapping under Settings → Import → Transmission${RESET}`);
    continue;
  }

  const plan = await planImport(candidate.source, db, { releaseName: candidate.name });

  if (plan.items.length) {
    console.log(`  ${WARN} ${short}`);
    if (previously) console.log(`      ${DIM}earlier verdict: ${previously}${RESET}`);
    console.log(`      ${DIM}would now go to:${RESET}`);
    for (const item of plan.items) console.log(`      → ${item.destination}`);
    if (record) {
      console.log(
        `      ${DIM}retry it: pnpm run doctor --retry "${candidate.name.slice(0, 32)}" --now${RESET}`,
      );
    }
  } else {
    console.log(`  ${BAD} ${short}`);
    for (const skip of plan.skipped.slice(0, 3)) {
      console.log(`      ${skip.reason}  ${DIM}(${path.basename(skip.file)})${RESET}`);
    }
    if (record && record.attempts >= 5) {
      console.log(`      ${DIM}given up after ${record.attempts} attempts${RESET}`);
    }
  }
}

if (runNow) {
  heading("Running an import scan");
  const summary = await scanAll(db);
  console.log(`  ${describeScan(summary)}`);
  for (const error of summary.errors) console.log(`  ${BAD} ${error}`);
}

console.log(
  `\n${DIM}--now runs a scan, --retry <text> clears a record so it is tried again.${RESET}\n`,
);
