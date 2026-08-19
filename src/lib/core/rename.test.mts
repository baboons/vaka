/**
 * Taking over data written before the app was renamed from tvarr to Vaka.
 *
 * The failure this guards against is not a crash — it is the app quietly
 * creating an empty database beside a full one, which looks exactly like the
 * library having been wiped.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import Database from "better-sqlite3";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vaka-rename-"));
process.env.VAKA_DATA_DIR = path.join(tempRoot, "unused");

const { getDb, closeDb, dataDir } = await import("./db");

after(async () => {
  closeDb();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

/** A data directory as an older version would have left it. */
async function legacyDir(name: string, options: { leaveWal?: boolean } = {}) {
  const dir = path.join(tempRoot, name);
  await fs.mkdir(dir, { recursive: true });

  const db = new Database(path.join(dir, "tvarr.db"));
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE relic (id INTEGER PRIMARY KEY, title TEXT)");
  db.prepare("INSERT INTO relic (title) VALUES (?)").run("Ted Lasso");
  if (options.leaveWal) {
    // Close without checkpointing, so the commit lives only in the -wal.
    db.pragma("wal_checkpoint(PASSIVE)");
    db.prepare("INSERT INTO relic (title) VALUES (?)").run("The Bear");
  }
  db.close();

  return dir;
}

function useDataDir(dir: string) {
  closeDb();
  process.env.VAKA_DATA_DIR = dir;
}

test("a legacy database is adopted wherever the data directory points", async () => {
  // The case a service unit installed under the old name produces: the folder
  // is pinned by TVARR_DATA_DIR, so nothing moves, and only the file is renamed.
  const dir = await legacyDir("pinned");
  useDataDir(dir);

  const db = getDb();
  assert.equal(dataDir(), dir);

  const rows = db.prepare("SELECT title FROM relic").all() as Array<{ title: string }>;
  assert.deepEqual(
    rows.map((row) => row.title),
    ["Ted Lasso"],
    "the existing library came across rather than a blank database being made",
  );

  const files = await fs.readdir(dir);
  assert.ok(files.includes("vaka.db"));
  assert.ok(!files.includes("tvarr.db"), "the old name is gone, not duplicated");
});

test("commits still sitting in the write-ahead log survive the rename", async () => {
  // SQLite finds the -wal by file name. Renaming the database without folding
  // the log in first would silently drop whatever had not been checkpointed.
  const dir = await legacyDir("with-wal", { leaveWal: true });
  useDataDir(dir);

  const rows = getDb().prepare("SELECT title FROM relic ORDER BY id").all() as Array<{
    title: string;
  }>;
  assert.deepEqual(rows.map((row) => row.title), ["Ted Lasso", "The Bear"]);
});

test("an existing Vaka database is never overwritten by an older one", async () => {
  const dir = await legacyDir("both");
  const current = new Database(path.join(dir, "vaka.db"));
  current.exec("CREATE TABLE relic (id INTEGER PRIMARY KEY, title TEXT)");
  current.prepare("INSERT INTO relic (title) VALUES (?)").run("Severance");
  current.close();

  useDataDir(dir);

  const rows = getDb().prepare("SELECT title FROM relic").all() as Array<{ title: string }>;
  assert.deepEqual(rows.map((row) => row.title), ["Severance"]);

  // The old file is left alone rather than deleted — it is still the user's.
  assert.ok((await fs.readdir(dir)).includes("tvarr.db"));
});

test("a directory with nothing to adopt is left to start clean", async () => {
  const dir = path.join(tempRoot, "fresh");
  useDataDir(dir);

  getDb();
  assert.ok((await fs.readdir(dir)).includes("vaka.db"));
});
