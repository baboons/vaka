/**
 * Settings and storage for the sports library.
 *
 * Two things here have already gone wrong once in this codebase's life, in the
 * TV/movie form: a shared form dropping fields it does not know about, and a
 * calendar refresh reassigning numbers out from under grabbed rows.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vaka-sports-"));
process.env.VAKA_DATA_DIR = path.join(tempRoot, "data");

const { getDb, closeDb } = await import("./db");
const repo = await import("./repo");
const settings = await import("./settings");
const { DEFAULT_SPORT_PROFILE } = await import("./types");

before(() => getDb());

after(async () => {
  closeDb();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("saving through the shared library form keeps the sports-only settings", () => {
  const db = getDb();
  const before = settings.getSportsConfig(db);
  assert.equal(before.lookaheadDays, 60);

  // The naming form validates against the base schema, which strips fields it
  // has never heard of. If that result were written straight back, the
  // calendar window would silently reset to its defaults.
  const stripped = settings.kindConfigSchema.parse({
    ...settings.getKindConfig("sport", db),
    libraryDir: "/media/Sports",
  });
  assert.equal("lookaheadDays" in stripped, false);

  settings.saveKindConfig("sport", stripped, db);

  const after = settings.getSportsConfig(db);
  assert.equal(after.libraryDir, "/media/Sports");
  assert.equal(after.lookaheadDays, 60, "the calendar window survived the save");
  assert.equal(after.lookbehindDays, 21);
});

test("sports settings do not leak into the TV library", () => {
  const db = getDb();
  const config = settings.getConfig(db);
  assert.equal(config.tv.fileTemplate, "{title} ({year}) - S{season:00}E{episode:00} - {episodeTitle}");
  assert.equal(config.sports.fileTemplate, "{title} - {airDate} - {episodeTitle}");
});

test("an event keeps its number, and its state, as the calendar grows", () => {
  const db = getDb();

  const media = repo.insertMedia(
    {
      kind: "sport",
      provider: "espn",
      providerId: "ufc",
      title: "UFC",
      quality: DEFAULT_SPORT_PROFILE,
      sport: { league: "ufc", teams: [], sessions: ["full-event"], autoGrabUncertain: false },
    },
    db,
  );

  const meta = { eventNumber: null, competitors: [], identityGroups: [] };
  repo.upsertSportEvents(
    [
      { mediaId: media.id, providerId: "e1", season: 2026, title: "First", airDate: "2026-03-01T20:00Z", monitored: true, sport: meta },
      { mediaId: media.id, providerId: "e3", season: 2026, title: "Third", airDate: "2026-03-20T20:00Z", monitored: true, sport: meta },
    ],
    db,
  );

  const third = repo.listEpisodes(media.id, db).find((event) => event.title === "Third")!;
  repo.updateEpisode(third.id, { state: "grabbed", grabbedQuality: "1080p WEBDL" }, db);

  // A fight added to the middle of the calendar, plus a rescheduled date on an
  // event that already has a download against it.
  repo.upsertSportEvents(
    [
      { mediaId: media.id, providerId: "e1", season: 2026, title: "First", airDate: "2026-03-01T20:00Z", monitored: true, sport: meta },
      { mediaId: media.id, providerId: "e2", season: 2026, title: "Second", airDate: "2026-03-10T20:00Z", monitored: true, sport: meta },
      { mediaId: media.id, providerId: "e3", season: 2026, title: "Third", airDate: "2026-03-21T20:00Z", monitored: true, sport: meta },
    ],
    db,
  );

  const events = repo.listEpisodes(media.id, db);
  assert.equal(events.length, 3);

  const stillThird = events.find((event) => event.providerId === "e3")!;
  assert.equal(stillThird.number, third.number, "the number did not move");
  assert.equal(stillThird.state, "grabbed", "the grab survived the refresh");
  assert.equal(stillThird.grabbedQuality, "1080p WEBDL");
  assert.equal(stillThird.airDate, "2026-03-21T20:00Z", "the new date was taken");

  // The subscription round-trips as an object rather than a JSON string.
  assert.equal(repo.getMedia(media.id, db)?.sport?.league, "ufc");
  assert.deepEqual(stillThird.sport, meta);
});
