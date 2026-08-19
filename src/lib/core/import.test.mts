/**
 * Importing finished downloads into a Plex-shaped library.
 *
 * This is the only code in Vaka that touches files the user already had, so
 * the safety properties matter as much as the happy path: never overwrite,
 * never destroy the source when hardlinking, never write outside the library.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vaka-import-"));
process.env.VAKA_DATA_DIR = path.join(tempRoot, "data");

const { getDb, closeDb } = await import("./db");
const { importPath, planImport, runImport } = await import("./import");
const naming = await import("./naming");
const repo = await import("./repo");
const settings = await import("./settings");
const { DEFAULT_MOVIE_PROFILE, DEFAULT_TV_PROFILE } = await import("./types");

const downloads = path.join(tempRoot, "downloads");
const tvLibrary = path.join(tempRoot, "library", "TV");
const movieLibrary = path.join(tempRoot, "library", "Movies");

/** Big enough to clear the minimum-size filter. */
const BIG = 60 * 1024 * 1024;

async function makeFile(target: string, size = BIG): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.alloc(size, 1));
}

function configure(mode: "hardlink" | "copy" | "move") {
  const defaults = settings.defaultConfig();
  settings.saveKindConfig("tv", { ...defaults.tv, libraryDir: tvLibrary });
  settings.saveKindConfig("movie", { ...defaults.movies, libraryDir: movieLibrary });
  settings.saveImportConfig({
    ...defaults.importing,
    enabled: true,
    watchDir: downloads,
    mode,
    minSizeMb: 50,
    scanIntervalMinutes: 5,
  });
}

before(async () => {
  const db = getDb();
  configure("hardlink");

  const show = repo.insertMedia(
    {
      kind: "tv",
      provider: "tvmaze",
      providerId: "1",
      title: "Harbour Lights",
      year: 2022,
      quality: DEFAULT_TV_PROFILE,
    },
    db,
  );
  repo.upsertEpisodes(
    [
      { mediaId: show.id, season: 3, number: 1, title: "Low Tide", monitored: true },
      { mediaId: show.id, season: 3, number: 2, title: "Next", monitored: true },
      { mediaId: show.id, season: 10, number: 1, title: "Double", monitored: true },
      { mediaId: show.id, season: 10, number: 2, title: "Trouble", monitored: true },
    ],
    db,
  );

  repo.insertMedia(
    {
      kind: "movie",
      provider: "cinemeta",
      providerId: "tt9900001",
      title: "Deep Field Part Two",
      year: 2024,
      quality: DEFAULT_MOVIE_PROFILE,
    },
    db,
  );
});

beforeEach(() => configure("hardlink"));

after(async () => {
  closeDb();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("renders Plex templates, padding seasons and episodes", () => {
  const templates = naming.defaultTemplates("tv");
  const destination = naming.buildDestination({
    kind: "tv",
    libraryDir: "/library/TV",
    templates,
    extension: ".mkv",
    values: { title: "Harbour Lights", year: 2022, season: 3, episode: 1, episodeTitle: "Low Tide" },
  });

  assert.equal(
    destination.relative,
    path.join("Harbour Lights (2022)", "Season 03", "Harbour Lights (2022) - S03E01 - Low Tide.mkv"),
  );
});

test("collapses tokens that have no value instead of leaving empty brackets", () => {
  const rendered = naming.renderTemplate("{title} ({year})", { title: "Untitled", year: null });
  assert.equal(rendered, "Untitled");
});

test("renders multi-episode files as a range", () => {
  const rendered = naming.renderTemplate("S{season:00}E{episode:00}", {
    title: "x",
    season: 1,
    episode: 1,
    episodeEnd: 2,
  });
  assert.equal(rendered, "S01E01-E02");
});

test("strips path separators so a release name cannot escape its folder", () => {
  // Asserted as properties rather than exact strings: what matters is that
  // nothing survives that could traverse or hide.
  for (const nasty of ["../../etc/passwd", "a/b", "..\\..\\windows", ".hidden", "  ..  "]) {
    const safe = naming.sanitizeSegment(nasty);
    assert.ok(!safe.includes("/"), `${safe} still contains a slash`);
    assert.ok(!safe.includes("\\"), `${safe} still contains a backslash`);
    assert.ok(!safe.startsWith("."), `${safe} would be a hidden file`);
    assert.ok(safe.length > 0);
  }

  assert.equal(naming.sanitizeSegment("a/b"), "a - b");
  assert.equal(naming.sanitizeSegment("   "), "Unknown");
  // Ordinary titles must survive intact.
  assert.equal(naming.sanitizeSegment("Mission: Impossible - Fallout"), "Mission Impossible - Fallout");
  assert.equal(naming.sanitizeSegment("WALL·E"), "WALL·E");
});

test("files an episode into Season NN, creating the folders", async () => {
  const source = path.join(downloads, "Harbour.Lights.S03E01.1080p.WEB-DL.x264-NOVA.mkv");
  await makeFile(source);

  const outcome = await importPath(source, getDb(), { releaseName: path.basename(source) });
  assert.equal(outcome.imported.length, 1);

  const expected = path.join(
    tvLibrary,
    "Harbour Lights (2022)",
    "Season 03",
    "Harbour Lights (2022) - S03E01 - Low Tide.mkv",
  );
  const stat = await fs.stat(expected);
  assert.ok(stat.isFile());
  assert.equal(stat.size, BIG);
});

test("hardlinks rather than copying, so seeding continues and no space is used", async () => {
  const source = path.join(downloads, "Harbour.Lights.S03E02.1080p.WEB-DL.x264-NOVA.mkv");
  await makeFile(source);

  await importPath(source, getDb(), { releaseName: path.basename(source) });

  const target = path.join(
    tvLibrary,
    "Harbour Lights (2022)",
    "Season 03",
    "Harbour Lights (2022) - S03E02 - Next.mkv",
  );

  const [from, to] = await Promise.all([fs.stat(source), fs.stat(target)]);
  assert.equal(from.ino, to.ino, "the library file should be the same inode as the download");
  assert.ok(await fs.stat(source), "the download must still exist for seeding");
});

test("marks the episode as had, so the watcher stops wanting it", () => {
  const show = repo.listMedia({ kind: "tv" })[0];
  const episodes = repo.listEpisodes(show.id);
  assert.equal(episodes.find((e) => e.number === 1 && e.season === 3)?.state, "done");
  assert.equal(episodes.find((e) => e.number === 2 && e.season === 3)?.state, "done");
});

test("puts a film in its own folder", async () => {
  const source = path.join(downloads, "Deep.Field.Part.Two.2024.2160p.WEB-DL.H.265-ZEPH.mkv");
  await makeFile(source);

  await importPath(source, getDb(), { releaseName: path.basename(source) });

  const expected = path.join(movieLibrary, "Deep Field Part Two (2024)", "Deep Field Part Two (2024).mkv");
  assert.ok((await fs.stat(expected)).isFile());
  assert.equal(repo.listMedia({ kind: "movie" })[0].state, "done");
});

test("takes the episode from a folder-style download and ignores the sample", async () => {
  const folder = path.join(downloads, "Harbour.Lights.S10E01.1080p.WEB-DL.x264-NOVA");
  await makeFile(path.join(folder, "the.bear.s10e01.1080p.web-dl.x264-ntb.mkv"));
  await makeFile(path.join(folder, "Sample", "sample.mkv"), 2 * 1024 * 1024);
  await fs.writeFile(path.join(folder, "readme.nfo"), "notes");

  const outcome = await importPath(folder, getDb(), { releaseName: path.basename(folder) });

  assert.equal(outcome.imported.length, 1, "only the feature file should be imported");
  const expected = path.join(
    tvLibrary,
    "Harbour Lights (2022)",
    "Season 10",
    "Harbour Lights (2022) - S10E01 - Double.mkv",
  );
  assert.ok((await fs.stat(expected)).isFile());
});

test("carries matching subtitles across with the video", async () => {
  const base = path.join(downloads, "Harbour.Lights.S10E02.1080p.WEB-DL.x264-NOVA");
  await makeFile(`${base}.mkv`);
  await fs.writeFile(`${base}.srt`, "1\n00:00:01,000 --> 00:00:02,000\nhello\n");

  await importPath(`${base}.mkv`, getDb(), { releaseName: path.basename(base) });

  const subtitle = path.join(
    tvLibrary,
    "Harbour Lights (2022)",
    "Season 10",
    "Harbour Lights (2022) - S10E02 - Trouble.srt",
  );
  assert.ok((await fs.stat(subtitle)).isFile());
});

test("never overwrites: a second copy lands beside the first", async () => {
  const source = path.join(downloads, "second", "Harbour.Lights.S03E01.2160p.WEB-DL.x265-NOVA.mkv");
  await makeFile(source);

  await importPath(source, getDb(), { releaseName: path.basename(source) });

  const seasonDir = path.join(tvLibrary, "Harbour Lights (2022)", "Season 03");
  const files = (await fs.readdir(seasonDir)).filter((name) => name.endsWith(".mkv")).sort();

  assert.deepEqual(files, [
    "Harbour Lights (2022) - S03E01 - Low Tide (1).mkv",
    "Harbour Lights (2022) - S03E01 - Low Tide.mkv",
    "Harbour Lights (2022) - S03E02 - Next.mkv",
  ]);
});

test("skips files that match nothing in the library, leaving them alone", async () => {
  const source = path.join(downloads, "Some.Unfollowed.Show.S01E01.1080p.WEB-DL.mkv");
  await makeFile(source);

  const outcome = await importPath(source, getDb(), { releaseName: path.basename(source) });

  assert.equal(outcome.imported.length, 0);
  assert.match(outcome.skipped[0]?.reason ?? "", /no followed title matches/);
  assert.ok(await fs.stat(source), "an unmatched download must be left untouched");
});

test("a dry run reports the plan and writes nothing", async () => {
  const source = path.join(downloads, "dry", "Harbour.Lights.S03E02.2160p.WEB-DL.x265-NOVA.mkv");
  await makeFile(source);

  const before = await fs.readdir(path.join(tvLibrary, "Harbour Lights (2022)", "Season 03"));
  const plan = await planImport(source, getDb(), { releaseName: path.basename(source) });
  const outcome = await runImport(plan, getDb(), { dryRun: true });

  assert.equal(outcome.imported.length, 1);
  assert.match(outcome.imported[0].relative, /Season 03/);

  const after = await fs.readdir(path.join(tvLibrary, "Harbour Lights (2022)", "Season 03"));
  assert.deepEqual(after, before, "a dry run must not change the library");
});

test("move mode relocates the file instead of linking it", async () => {
  configure("move");
  const source = path.join(downloads, "moved", "Harbour.Lights.S10E02.720p.HDTV.x264-GRP.mkv");
  await makeFile(source);

  await importPath(source, getDb(), { releaseName: path.basename(source) });

  await assert.rejects(() => fs.stat(source), "the source should be gone after a move");
});

test("recognises a download Vaka grabbed itself, however it is punctuated", () => {
  // Adoption of a torrent client's existing downloads must never swallow
  // something Vaka asked for: that silently loses the episode forever.
  const db = getDb();
  repo.addHistory(
    {
      event: "grabbed",
      title: "Tidewater.S04E02.Curiouser.and.Curiouser.1080p.ATVP.WEB-DL.DDP5.1.Atmos.H.264-playWEB",
    },
    db,
  );

  assert.equal(
    repo.wasGrabbedByVaka(
      "Tidewater.S04E02.Curiouser.and.Curiouser.1080p.ATVP.WEB-DL.DDP5.1.Atmos.H.264-playWEB",
      db,
    ),
    true,
    "exact match",
  );

  // Transmission names a single-file torrent after the file, extension and all.
  assert.equal(
    repo.wasGrabbedByVaka(
      "Tidewater.S04E02.Curiouser.and.Curiouser.1080p.ATVP.WEB-DL.DDP5.1.Atmos.H.264-playWEB.mkv",
      db,
    ),
    true,
    "the .mkv suffix must not hide the match",
  );

  // Some trackers hand out spaces where the feed had dots.
  assert.equal(
    repo.wasGrabbedByVaka(
      "Tidewater S04E02 Curiouser and Curiouser 1080p ATVP WEB-DL DDP5 1 Atmos H 264-playWEB",
      db,
    ),
    true,
    "separators must not hide the match",
  );

  assert.equal(repo.wasGrabbedByVaka("Nightrunner.1988.1080p.BluRay.x264-OFT", db), false);
  assert.equal(repo.wasGrabbedByVaka("", db), false);
});

test("cleanup refuses to retire a torrent whose library copy has vanished", async () => {
  const { cleanupSeeded } = await import("./import-runner");
  const db = getDb();

  settings.saveImportConfig({
    ...settings.getConfig().importing,
    enabled: true,
    cleanupEnabled: true,
    cleanupAfterDays: 1,
    cleanupMinRatio: 0,
  });
  settings.saveTransmissionConfig({
    ...settings.getConfig().transmission,
    enabled: true,
    // Unreachable on purpose: the guard must fire before any RPC call, and a
    // connection error must never be mistaken for permission to delete.
    url: "http://127.0.0.1:9",
  });

  repo.recordImport(
    {
      sourceKey: "transmission:ghost",
      name: "Some.Show.S01E01",
      status: "done",
      fileCount: 1,
      libraryPaths: [path.join(tvLibrary, "does-not-exist.mkv")],
    },
    db,
  );

  const summary = await cleanupSeeded(db);
  assert.equal(summary.cleaned, 0, "nothing may be retired when the library copy is missing");

  const record = repo.listImports(50, db).find((row) => row.sourceKey === "transmission:ghost");
  assert.equal(record?.cleanedAt, null, "the import stays open for another look");

  settings.saveImportConfig({ ...settings.getConfig().importing, cleanupEnabled: false });
  settings.saveTransmissionConfig({ ...settings.getConfig().transmission, enabled: false });
});

test("cleanup does nothing while it is switched off", async () => {
  const { cleanupSeeded } = await import("./import-runner");
  const summary = await cleanupSeeded(getDb());
  assert.deepEqual(summary, { checked: 0, cleaned: 0, freedBytes: 0, errors: [] });
});

test("respects a library that names seasons differently", async () => {
  const defaults = settings.defaultConfig();
  settings.saveKindConfig("tv", {
    ...defaults.tv,
    libraryDir: tvLibrary,
    seasonTemplate: "Season {season}",
    folderTemplate: "{title}",
    fileTemplate: "{title} - S{season:00}E{episode:00}",
  });

  const source = path.join(downloads, "custom", "Harbour.Lights.S10E01.720p.HDTV.x264-GRP.mkv");
  await makeFile(source);
  await importPath(source, getDb(), { releaseName: path.basename(source) });

  const expected = path.join(tvLibrary, "Harbour Lights", "Season 10", "Harbour Lights - S10E01.mkv");
  assert.ok((await fs.stat(expected)).isFile());
});
