/**
 * Cache versioning.
 *
 * A cached list outliving a change to how it is built is indistinguishable, to
 * the person looking at it, from the change never having shipped.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vaka-cache-"));
process.env.VAKA_DATA_DIR = path.join(tempRoot, "data");

const { getDb, closeDb, nowIso } = await import("./db");
const { cached, clearCache, CACHE_VERSION } = await import("./cache");

before(() => getDb());

after(async () => {
  closeDb();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("serves a fresh value from cache instead of refetching", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return ["first"];
  };

  const one = await cached("list", 3600, load);
  const two = await cached("list", 3600, load);

  assert.deepEqual(one.value, ["first"]);
  assert.deepEqual(two.value, ["first"]);
  assert.equal(calls, 1, "the second read should not hit the provider");
  assert.equal(two.stale, false);
});

test("ignores an entry written by an older version of the code", async () => {
  const db = getDb();

  // Exactly what the previous release left behind: unversioned key, hours to live.
  db.prepare(
    "INSERT OR REPLACE INTO cache (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)",
  ).run(
    "discover:upcoming:tv",
    JSON.stringify(["The Big Deal with Steph McGovern"]),
    new Date(Date.now() + 12 * 3600_000).toISOString(),
    nowIso(),
  );

  const result = await cached("discover:upcoming:tv", 3600, async () => ["Reacher"]);

  assert.deepEqual(
    result.value,
    ["Reacher"],
    "a ranking change must take effect immediately, not in twelve hours",
  );
});

test("sweeps away entries from older versions", async () => {
  const db = getDb();
  const { pruneCacheVersions } = await import("./cache");

  db.prepare(
    "INSERT OR REPLACE INTO cache (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)",
  ).run("ancient:key", "[]", new Date(Date.now() + 3600_000).toISOString(), nowIso());

  const removed = pruneCacheVersions(db);
  assert.ok(removed >= 1, "the old-version row should be swept up");

  const left = db
    .prepare("SELECT COUNT(*) AS n FROM cache WHERE key NOT LIKE ?")
    .get(`v${CACHE_VERSION}:%`) as { n: number };
  assert.equal(left.n, 0, "old-version rows must not accumulate");
});

test("falls back to a stale value when the provider fails", async () => {
  await cached("flaky", 0, async () => ["good"]);

  const result = await cached("flaky", 3600, async () => {
    throw new Error("provider down");
  });

  assert.deepEqual(result.value, ["good"]);
  assert.equal(result.stale, true, "a stale list beats an empty page");
});

test("propagates the error when there is nothing cached at all", async () => {
  await assert.rejects(
    () => cached("never-seen", 3600, async () => Promise.reject(new Error("cold"))),
    /cold/,
  );
});

test("clearing by prefix only removes that prefix", async () => {
  await cached("discover:popular:tv", 3600, async () => ["a"]);
  await cached("preview:tv:x", 3600, async () => ["b"]);

  const removed = clearCache("discover:");
  assert.ok(removed >= 1);

  let refetched = false;
  await cached("discover:popular:tv", 3600, async () => {
    refetched = true;
    return ["a"];
  });
  assert.equal(refetched, true, "the cleared entry should be refetched");

  let previewRefetched = false;
  await cached("preview:tv:x", 3600, async () => {
    previewRefetched = true;
    return ["b"];
  });
  assert.equal(previewRefetched, false, "an unrelated prefix should survive");
});
