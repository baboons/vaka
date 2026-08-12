/**
 * End-to-end test of the watcher path: a real HTTP server serves an RSS feed
 * and .torrent files, and the engine is expected to grab exactly the releases
 * the quality profiles ask for and write them into the blackhole folder.
 *
 * Data directory and download folders are temporary, and no metadata provider
 * is contacted — library rows are inserted directly.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tvarr-test-"));
process.env.TVARR_DATA_DIR = path.join(tempRoot, "data");

// Imported after the data directory is set so the database opens in the
// temporary location rather than the real one.
const { getDb, closeDb } = await import("./db");
const engine = await import("./engine");
const repo = await import("./repo");
const settings = await import("./settings");
const { DEFAULT_MOVIE_PROFILE, DEFAULT_TV_PROFILE } = await import("./types");

/** Minimal bencoded payload — the grabber only checks the leading marker. */
const TORRENT_BODY = Buffer.from("d8:announce9:test:onee");

const RELEASES = [
  "The.Expanse.S05E03.1080p.WEB-DL.DDP5.1.H.264-NTb",
  "The.Expanse.S05E04.480p.HDTV.x264-LOWQ",
  "The.Expanse.S05E05.1080p.WEB-DL.x264-NTb",
  "Some.Show.Nobody.Follows.S01E01.1080p.WEB-DL-GRP",
  // The 1080p copy is listed first on purpose: the preferred 2160p must still
  // win, which only happens if candidates are ranked rather than taken in
  // feed order.
  "Dune.Part.Two.2024.1080p.WEB-DL.H.264-FLUX",
  "Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR.H.265-FLUX",
  "Totally.Unrelated.Movie.2019.1080p.BluRay.x264-GRP",
];

let server: http.Server;
let baseUrl: string;
let tvDir: string;
let movieDir: string;

function rssFor(origin: string): string {
  const items = RELEASES.map(
    (title, index) => `
    <item>
      <title>${title}</title>
      <guid isPermaLink="false">release-${index}</guid>
      <link>${origin}/download/${index}.torrent</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <enclosure url="${origin}/download/${index}.torrent" length="1500000000" type="application/x-bittorrent" />
      <torznab:attr name="seeders" value="42" />
      <torznab:attr name="size" value="1500000000" />
    </item>`,
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Test Tracker</title>
    ${items}
  </channel>
</rss>`;
}

before(async () => {
  server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url.startsWith("/feed")) {
      response.writeHead(200, { "content-type": "application/rss+xml" });
      response.end(rssFor(baseUrl));
      return;
    }
    if (url.startsWith("/download/")) {
      response.writeHead(200, { "content-type": "application/x-bittorrent" });
      response.end(TORRENT_BODY);
      return;
    }
    response.writeHead(404).end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;

  tvDir = path.join(tempRoot, "blackhole", "tv");
  movieDir = path.join(tempRoot, "blackhole", "movies");

  const db = getDb();
  settings.saveKindConfig("tv", {
    ...settings.defaultConfig().tv,
    downloadDir: tvDir,
    quality: { ...DEFAULT_TV_PROFILE, allowed: ["720p", "1080p"], preferred: "1080p" },
    grabBacklog: true,
  });
  settings.saveKindConfig("movie", {
    ...settings.defaultConfig().movies,
    downloadDir: movieDir,
    quality: {
      ...DEFAULT_MOVIE_PROFILE,
      allowed: ["1080p", "2160p"],
      preferred: "2160p",
      minSeeders: 1,
    },
    grabBacklog: true,
  });

  repo.insertFeed({ name: "Test Tracker", url: `${baseUrl}/feed`, kind: "any" }, db);

  const show = repo.insertMedia(
    {
      kind: "tv",
      provider: "tvmaze",
      providerId: "1",
      title: "The Expanse",
      year: 2015,
      quality: { ...DEFAULT_TV_PROFILE, allowed: ["720p", "1080p"], preferred: "1080p" },
    },
    db,
  );
  repo.upsertEpisodes(
    [3, 4, 5].map((number) => ({
      mediaId: show.id,
      season: 5,
      number,
      title: `Episode ${number}`,
      airDate: "2021-01-01T00:00:00.000Z",
      monitored: true,
    })),
    db,
  );

  repo.insertMedia(
    {
      kind: "movie",
      provider: "tmdb",
      providerId: "693134",
      title: "Dune Part Two",
      year: 2024,
      quality: {
        ...DEFAULT_MOVIE_PROFILE,
        allowed: ["1080p", "2160p"],
        preferred: "2160p",
        minSeeders: 1,
      },
    },
    db,
  );
});

after(async () => {
  closeDb();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("polls the feed and caches every release", async () => {
  const summary = await engine.pollFeeds();
  assert.equal(summary.errors.length, 0);
  assert.equal(summary.feeds, 1);
  assert.equal(summary.newItems, RELEASES.length);

  // A second poll sees the same items and must not re-queue them.
  const second = await engine.pollFeeds();
  assert.equal(second.newItems, 0);
});

test("grabs wanted episodes and writes .torrent files to the TV folder", async () => {
  const summary = await engine.evaluatePendingItems();

  assert.equal(summary.grabbed, 3, "two episodes plus the movie should be grabbed");

  // Flat, never in a per-show subfolder: torrent clients watch a single
  // directory and never descend into it, so a subfolder is never picked up.
  const files = await fs.readdir(tvDir);
  assert.deepEqual(
    files.sort(),
    [
      "The.Expanse.S05E03.1080p.WEB-DL.DDP5.1.H.264-NTb.torrent",
      "The.Expanse.S05E05.1080p.WEB-DL.x264-NTb.torrent",
    ],
    "only the 1080p episodes should land on disk, directly in the watch folder",
  );

  for (const entry of await fs.readdir(tvDir, { withFileTypes: true })) {
    assert.ok(entry.isFile(), `${entry.name} should be a file, not a folder`);
  }

  const written = await fs.readFile(path.join(tvDir, files[0]));
  assert.deepEqual(written, TORRENT_BODY, "the .torrent payload should be written verbatim");
});

test("puts movies in their own folder using the movie quality profile", async () => {
  const files = await fs.readdir(movieDir);
  assert.deepEqual(files, [
    "Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR.H.265-FLUX.torrent",
  ]);
});

test("takes the preferred quality even when a lesser release is listed first", async () => {
  const movie = repo.listMedia({ kind: "movie" })[0];
  assert.equal(movie.state, "grabbed");
  assert.equal(movie.grabbedQuality, "2160p WEBDL HDR");

  // The 1080p copy appeared earlier in the feed and must have been turned
  // down for the release that was actually preferred.
  const rejected = repo
    .listHistory({ event: "rejected" })
    .find((row) => row.title?.includes("Dune.Part.Two.2024.1080p"));
  assert.ok(rejected, "the weaker duplicate should be recorded as rejected");
  assert.match(rejected.reason ?? "", /already have 2160p/);
});

test("rejects the release below the configured quality and says why", async () => {
  const rejected = repo.listHistory({ event: "rejected" });
  const lowQuality = rejected.find((row) => row.title?.includes("S05E04"));
  assert.ok(lowQuality, "the 480p episode should be recorded as rejected");
  assert.match(lowQuality.reason ?? "", /480p is not an accepted quality/);
});

test("ignores releases for titles that are not in the library", async () => {
  const history = repo.listHistory({ limit: 500 });
  const unknown = history.filter(
    (row) => row.title?.includes("Nobody.Follows") || row.title?.includes("Totally.Unrelated"),
  );
  assert.equal(unknown.length, 0, "unfollowed titles should not be logged at all");
});

test("marks grabbed episodes so they are not downloaded twice", async () => {
  const show = repo.listMedia({ kind: "tv" })[0];
  const episodes = repo.listEpisodes(show.id);

  const grabbed = episodes.filter((episode) => episode.state === "grabbed");
  assert.equal(grabbed.length, 2);
  assert.equal(grabbed[0].grabbedQuality, "1080p WEBDL");

  const stillWanted = episodes.find((episode) => episode.number === 4);
  assert.equal(stillWanted?.state, "wanted");

  // Re-running the whole pipeline must be a no-op.
  const rerun = await engine.searchForMedia(show.id);
  assert.equal(rerun.grabbed, 0);

  const files = await fs.readdir(tvDir);
  assert.equal(files.length, 2, "no duplicate files should be created");
});

test("records where each grab was written", async () => {
  const grabs = repo.listHistory({ event: "grabbed" });
  assert.equal(grabs.length, 3);
  for (const grab of grabs) {
    assert.ok(grab.path, "every grab should record its destination path");
    const stat = await fs.stat(grab.path!);
    assert.ok(stat.isFile());
  }
});
