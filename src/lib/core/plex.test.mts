/**
 * Plex sync against a stand-in server: matching by external id and by title,
 * marking episodes and movies as had, and — most importantly — never marking
 * anything wanted again.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vaka-plex-"));
process.env.VAKA_DATA_DIR = path.join(tempRoot, "data");

const { getDb, closeDb } = await import("./db");
const plex = await import("./plex");
const repo = await import("./repo");
const settings = await import("./settings");
const { DEFAULT_MOVIE_PROFILE, DEFAULT_TV_PROFILE } = await import("./types");

let server: http.Server;
let baseUrl: string;

/** Episodes the pretend Plex server holds for The Bear. */
const PLEX_EPISODES = [
  { parentIndex: 1, index: 1, Media: [{ videoResolution: "1080" }] },
  { parentIndex: 1, index: 2, Media: [{ videoResolution: "4k" }] },
];

function json(response: http.ServerResponse, body: unknown) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");

    if (request.headers["x-plex-token"] !== "secret-token") {
      response.writeHead(401).end("unauthorized");
      return;
    }

    if (url.pathname === "/") {
      json(response, { MediaContainer: { friendlyName: "Basement" } });
      return;
    }

    if (url.pathname === "/library/sections") {
      json(response, {
        MediaContainer: {
          Directory: [
            { key: "1", type: "movie", title: "Films" },
            { key: "2", type: "show", title: "Series" },
            { key: "3", type: "artist", title: "Music" },
          ],
        },
      });
      return;
    }

    if (url.pathname === "/library/sections/1/all") {
      json(response, {
        MediaContainer: {
          totalSize: 2,
          Metadata: [
            {
              ratingKey: "900",
              title: "Dune: Part Two",
              year: 2024,
              Guid: [{ id: "imdb://tt15239678" }, { id: "tmdb://693134" }],
              Media: [{ videoResolution: "4k" }],
            },
            {
              // Matched by title and year only — no usable ids, as happens
              // with libraries built by the older Plex agents.
              ratingKey: "901",
              title: "Some Old Film",
              year: 1999,
              Media: [{ videoResolution: "720" }],
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === "/library/sections/2/all") {
      json(response, {
        MediaContainer: {
          totalSize: 1,
          Metadata: [
            {
              ratingKey: "500",
              title: "The Bear",
              year: 2022,
              Guid: [{ id: "tvdb://136500" }],
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === "/library/metadata/500/allLeaves") {
      json(response, { MediaContainer: { totalSize: PLEX_EPISODES.length, Metadata: PLEX_EPISODES } });
      return;
    }

    response.writeHead(404).end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const db = getDb();
  settings.savePlexConfig({
    enabled: true,
    url: baseUrl,
    token: "secret-token",
    syncIntervalMinutes: 60,
  });

  const show = repo.insertMedia(
    {
      kind: "tv",
      provider: "tvmaze",
      providerId: "1",
      tvdbId: "136500",
      title: "The Bear",
      year: 2022,
      quality: DEFAULT_TV_PROFILE,
    },
    db,
  );
  repo.upsertEpisodes(
    [1, 2, 3].map((number) => ({
      mediaId: show.id,
      season: 1,
      number,
      title: `Episode ${number}`,
      airDate: "2022-06-23T00:00:00.000Z",
      monitored: true,
    })),
    db,
  );

  repo.insertMedia(
    {
      kind: "movie",
      provider: "cinemeta",
      providerId: "tt15239678",
      title: "Dune: Part Two",
      year: 2024,
      quality: DEFAULT_MOVIE_PROFILE,
    },
    db,
  );

  repo.insertMedia(
    {
      kind: "movie",
      provider: "cinemeta",
      providerId: "tt0000001",
      title: "Some Old Film",
      year: 1999,
      quality: DEFAULT_MOVIE_PROFILE,
    },
    db,
  );

  // Not in Plex at all; must stay wanted.
  repo.insertMedia(
    {
      kind: "movie",
      provider: "cinemeta",
      providerId: "tt0000002",
      title: "Never Owned",
      year: 2020,
      quality: DEFAULT_MOVIE_PROFILE,
    },
    db,
  );
});

after(async () => {
  closeDb();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("reads external ids from both modern and legacy Plex guids", () => {
  assert.deepEqual(plex.externalIds({ Guid: [{ id: "imdb://tt15239678" }] }), {
    imdb: "tt15239678",
  });
  assert.deepEqual(
    plex.externalIds({ guid: "com.plexapp.agents.thetvdb://136500/1/1?lang=en" }),
    { tvdb: "136500" },
  );
  assert.deepEqual(plex.externalIds({ Guid: [{ id: "tmdb://693134" }] }), { tmdb: "693134" });
});

test("normalizes a bare host:port into a URL", () => {
  assert.equal(plex.normalizePlexUrl("10.0.1.5:32400"), "http://10.0.1.5:32400");
  assert.equal(plex.normalizePlexUrl("https://plex.example/ "), "https://plex.example");
});

test("reports the server name and its movie and TV sections", async () => {
  const info = await plex.testConnection(settings.getConfig().plex);
  assert.equal(info.name, "Basement");
  // The music section is not something Vaka can use.
  assert.deepEqual(
    info.sections.map((section) => section.type),
    ["movie", "show"],
  );
});

test("rejects a bad token rather than failing silently", async () => {
  await assert.rejects(
    () => plex.testConnection({ ...settings.getConfig().plex, token: "wrong" }),
    /401|token/i,
  );
});

test("crosses off episodes Plex already has, and leaves the rest wanted", async () => {
  const summary = await plex.syncPlex();
  assert.equal(summary.serverName, "Basement");
  assert.equal(summary.markedEpisodes, 2);

  const show = repo.listMedia({ kind: "tv" })[0];
  const episodes = repo.listEpisodes(show.id);

  assert.equal(episodes[0].state, "done");
  assert.equal(episodes[1].state, "done");
  assert.equal(episodes[2].state, "wanted", "an episode Plex lacks stays wanted");

  // The stored quality has to be readable by the upgrade logic.
  assert.match(episodes[0].grabbedQuality ?? "", /1080p/);
  assert.match(episodes[1].grabbedQuality ?? "", /2160p/);
});

test("matches movies by external id and by title+year", async () => {
  const movies = repo.listMedia({ kind: "movie" });

  const dune = movies.find((movie) => movie.title.startsWith("Dune"));
  assert.equal(dune?.state, "done", "matched on its IMDb id");
  assert.match(dune?.grabbedQuality ?? "", /2160p/);

  const old = movies.find((movie) => movie.title === "Some Old Film");
  assert.equal(old?.state, "done", "matched on title and year");

  const missing = movies.find((movie) => movie.title === "Never Owned");
  assert.equal(missing?.state, "wanted", "a film Plex lacks stays wanted");
});

test("a second sync changes nothing and logs nothing new", async () => {
  const before = repo.listHistory({ limit: 200 }).length;
  const summary = await plex.syncPlex();

  assert.equal(summary.markedEpisodes, 0);
  assert.equal(summary.markedMovies, 0);
  assert.equal(repo.listHistory({ limit: 200 }).length, before);
});

test("never marks something wanted again when Plex loses it", async () => {
  const show = repo.listMedia({ kind: "tv" })[0];
  const episodes = repo.listEpisodes(show.id);

  // Plex forgets episode 2 — a missing drive, a stalled scan, anything.
  PLEX_EPISODES.pop();
  await plex.syncPlex();

  const after = repo.listEpisodes(show.id);
  assert.equal(after[1].state, "done", "still had; a wave of re-downloads would be worse");
  assert.equal(after[1].grabbedQuality, episodes[1].grabbedQuality);

  PLEX_EPISODES.push({ parentIndex: 1, index: 2, Media: [{ videoResolution: "4k" }] });
});

test("records the outcome for the settings screen", async () => {
  const state = settings.getPlexState();
  assert.equal(state.lastStatus, "ok");
  assert.equal(state.serverName, "Basement");
  assert.ok(state.lastSyncAt);
});

test("reports a failure instead of throwing at the caller", async () => {
  settings.savePlexConfig({
    ...settings.getConfig().plex,
    url: "http://127.0.0.1:9",
  });

  const result = await plex.syncPlexSafely();
  assert.equal(result.ok, false);
  assert.equal(settings.getPlexState().lastStatus, "error");

  settings.savePlexConfig({ ...settings.getConfig().plex, url: baseUrl });
});
