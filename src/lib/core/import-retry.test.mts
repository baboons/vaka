/**
 * Regressions from a real setup where nothing got filed.
 *
 * Every case here was reported by a user whose downloads sat in the completed
 * folder while tvarr recorded a reason and never looked again.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tvarr-retry-"));
process.env.TVARR_DATA_DIR = path.join(tempRoot, "data");

const { getDb, closeDb } = await import("./db");
const repo = await import("./repo");
const settings = await import("./settings");
const { defaultTemplates } = await import("./naming");

before(() => getDb());

after(async () => {
  closeDb();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("a config saved before naming existed still names TV episodes correctly", () => {
  const db = getDb();

  // Exactly what an older tvarr wrote: no template fields at all.
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tv', ?)").run(
    JSON.stringify({
      downloadDir: "/data/watch",
      quality: settings.defaultConfig().tv.quality,
      grabBacklog: false,
    }),
  );

  const tv = settings.getConfig(db).tv;

  // The schema default for fileTemplate is movie-shaped; TV must not inherit
  // it, or every episode of a season collapses onto one filename.
  assert.equal(tv.fileTemplate, defaultTemplates("tv").file);
  assert.match(tv.fileTemplate, /S\{season:00\}E\{episode:00\}/);
  assert.equal(tv.seasonTemplate, "Season {season:00}");
  assert.equal(tv.downloadDir, "/data/watch", "stored values still win");
});

test("a movie config keeps the movie file pattern", () => {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('movies', ?)").run(
    JSON.stringify({ downloadDir: "/data/watch-movies" }),
  );

  const movies = settings.getConfig(db).movies;
  assert.equal(movies.fileTemplate, defaultTemplates("movie").file);
  assert.ok(!movies.fileTemplate.includes("{season"), "films have no season");
});

test("a skipped download is retried, because the reason may no longer hold", () => {
  const db = getDb();
  const key = "transmission:retry-me";

  // Recorded while the TV library folder was still unset.
  repo.recordImport(
    { sourceKey: key, name: "Ted.Lasso.S04E02", status: "skipped", detail: "no TV library folder is configured" },
    db,
  );

  assert.equal(repo.wasImported(key, db), false, "a fixable reason must be revisited");
});

test("a download still being written is retried rather than written off", () => {
  const db = getDb();
  const key = "transmission:half-written";

  repo.recordImport(
    { sourceKey: key, name: "Ted.Lasso.S04E01.REPACK", status: "skipped", detail: "no video files found" },
    db,
  );
  assert.equal(repo.wasImported(key, db), false);
});

test("retrying stops after a handful of attempts", () => {
  const db = getDb();
  const key = "transmission:hopeless";

  for (let attempt = 0; attempt < repo.MAX_IMPORT_ATTEMPTS; attempt += 1) {
    repo.recordImport(
      { sourceKey: key, name: "PDF_Squeezer_3.9.3.TNT", status: "skipped", detail: "no video files found" },
      db,
    );
  }

  assert.equal(
    repo.wasImported(key, db),
    true,
    "a download folder full of things that will never match must not be rescanned forever",
  );
});

test("an adopted back-catalogue download is left alone for good", () => {
  const db = getDb();
  const key = "transmission:old-stuff";

  repo.recordImport(
    {
      sourceKey: key,
      name: "Moonwalker.1988.1080p.BluRay.x264-OFT",
      status: "adopted",
      detail: "already complete when tvarr was connected",
    },
    db,
  );

  assert.equal(repo.wasImported(key, db), true, "adoption is deliberate, not circumstantial");
});

test("a successful import is never redone", () => {
  const db = getDb();
  const key = "transmission:filed";

  repo.recordImport(
    { sourceKey: key, name: "Show.S01E01", status: "done", fileCount: 1, path: "/dl/Show.S01E01" },
    db,
  );

  assert.equal(repo.wasImported(key, db), true);
  assert.equal(
    repo.wasPathImported("/dl/Show.S01E01", db),
    true,
    "the same path arriving from another source must not be filed twice",
  );
  assert.equal(repo.wasPathImported("/dl/Something.Else", db), false);
});
