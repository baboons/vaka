/**
 * Transmission RPC and the library-convention scanner.
 *
 * The RPC server is a stand-in that reproduces Transmission's CSRF handshake:
 * the first request is answered with 409 and a session id that must be echoed
 * back, which is the part most clients get wrong.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vaka-tm-"));
process.env.VAKA_DATA_DIR = path.join(tempRoot, "data");

const transmission = await import("./transmission");
const { inspectLibrary } = await import("./inspect-library");

const SESSION_ID = "abc123session";
const TORRENTS = [
  {
    id: 1,
    hashString: "aaa",
    name: "The.Bear.S03E01.1080p.WEB-DL.x264-NTb",
    percentDone: 1,
    status: 6,
    isFinished: false,
    downloadDir: "/downloads/complete",
    doneDate: 1_700_000_000,
    totalSize: 2_000_000_000,
  },
  {
    id: 2,
    hashString: "bbb",
    name: "Still.Downloading.S01E01",
    percentDone: 0.42,
    status: 4,
    isFinished: false,
    downloadDir: "/downloads/incomplete",
    doneDate: 0,
    totalSize: 3_000_000_000,
  },
  {
    id: 3,
    hashString: "ccc",
    name: "Dune.Part.Two.2024.2160p",
    percentDone: 1,
    status: 0,
    isFinished: true,
    downloadDir: "/downloads/complete",
    doneDate: 1_700_000_500,
    totalSize: 9_000_000_000,
  },
];

let server: http.Server;
let baseUrl: string;
let handshakes = 0;
let requireAuth = false;

before(async () => {
  server = http.createServer((request, response) => {
    if (request.url !== "/transmission/rpc") {
      response.writeHead(404).end("not found");
      return;
    }

    if (requireAuth && request.headers.authorization !== `Basic ${Buffer.from("me:secret").toString("base64")}`) {
      response.writeHead(401).end("unauthorized");
      return;
    }

    if (request.headers["x-transmission-session-id"] !== SESSION_ID) {
      handshakes += 1;
      response.writeHead(409, { "x-transmission-session-id": SESSION_ID }).end("conflict");
      return;
    }

    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { method } = JSON.parse(body || "{}");
      response.writeHead(200, { "content-type": "application/json" });

      if (method === "session-get") {
        response.end(
          JSON.stringify({ result: "success", arguments: { version: "4.0.5", "download-dir": "/downloads" } }),
        );
        return;
      }
      if (method === "torrent-get") {
        response.end(JSON.stringify({ result: "success", arguments: { torrents: TORRENTS } }));
        return;
      }
      response.end(JSON.stringify({ result: "no method" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function config(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    url: baseUrl,
    username: "",
    password: "",
    remotePathPrefix: "",
    localPathPrefix: "",
    importExisting: false,
    ...overrides,
  } as Parameters<typeof transmission.listTorrents>[0];
}

test("completes the 409 session handshake and reuses the id", async () => {
  handshakes = 0;
  const session = await transmission.getSession(config());
  assert.equal(session.version, "4.0.5");
  assert.equal(handshakes, 1, "the handshake happens once");

  // A second call must reuse the cached session id.
  await transmission.getSession(config());
  assert.equal(handshakes, 1, "the session id should be cached, not re-negotiated");
});

test("accepts a bare host:port and appends the RPC path", async () => {
  const host = baseUrl.replace("http://", "");
  const session = await transmission.getSession(config({ url: host }));
  assert.equal(session.version, "4.0.5");
});

test("returns only finished downloads", async () => {
  const completed = await transmission.listCompleted(config());
  assert.deepEqual(
    completed.map((torrent) => torrent.hashString).sort(),
    ["aaa", "ccc"],
    "a torrent at 42% is not ready to import",
  );
});

test("rewrites the download path when Transmission sees a different filesystem", () => {
  const torrent = { downloadDir: "/downloads/complete", name: "Show.S01E01" };

  assert.equal(
    transmission.localPathFor(torrent, config()),
    "/downloads/complete/Show.S01E01",
  );

  assert.equal(
    transmission.localPathFor(
      torrent,
      config({ remotePathPrefix: "/downloads", localPathPrefix: "/mnt/nas/torrents" }),
    ),
    "/mnt/nas/torrents/complete/Show.S01E01",
  );
});

test("reports a bad password clearly rather than as a generic failure", async () => {
  requireAuth = true;
  try {
    await assert.rejects(
      () => transmission.getSession(config({ username: "me", password: "wrong" })),
      /401|username or password/i,
    );
  } finally {
    // Restored even if the assertion fails, so one failure does not cascade.
    requireAuth = false;
  }
});

test("summarises the server for the settings screen", async () => {
  const status = await transmission.testConnection(config());
  assert.equal(status.version, "4.0.5");
  assert.equal(status.total, 3);
  assert.equal(status.completed, 2);
});

/* ------------------------------------------------------------------ */
/* Seeding thresholds                                                   */
/* ------------------------------------------------------------------ */

const { hasSeededEnough } = await import("./import-runner");

const seeded = (days: number, ratio: number) => ({
  secondsSeeding: days * 86400,
  uploadRatio: ratio,
});

test("retires a torrent once either threshold is met", () => {
  const rules = { afterDays: 14, minRatio: 1, requireBoth: false };

  assert.equal(hasSeededEnough(seeded(15, 0.2), rules).met, true, "time alone is enough");
  assert.equal(hasSeededEnough(seeded(2, 1.5), rules).met, true, "ratio alone is enough");
  assert.equal(hasSeededEnough(seeded(2, 0.3), rules).met, false, "neither met");
});

test("can require both thresholds instead", () => {
  const rules = { afterDays: 14, minRatio: 1, requireBoth: true };

  assert.equal(hasSeededEnough(seeded(15, 0.2), rules).met, false);
  assert.equal(hasSeededEnough(seeded(2, 1.5), rules).met, false);
  assert.equal(hasSeededEnough(seeded(15, 1.5), rules).met, true);
});

test("a threshold of zero is ignored rather than instantly true", () => {
  // Ratio only: a brand new torrent must not qualify on its zero-day rule.
  const ratioOnly = { afterDays: 0, minRatio: 2, requireBoth: false };
  assert.equal(hasSeededEnough(seeded(0, 0.1), ratioOnly).met, false);
  assert.equal(hasSeededEnough(seeded(0, 2.5), ratioOnly).met, true);

  // Both zero means cleanup can never trigger.
  const disabled = { afterDays: 0, minRatio: 0, requireBoth: false };
  assert.equal(hasSeededEnough(seeded(999, 99), disabled).met, false);
  assert.match(hasSeededEnough(seeded(999, 99), disabled).reason, /no thresholds/);
});

test("explains where a torrent stands", () => {
  const verdict = hasSeededEnough(seeded(3.5, 0.75), {
    afterDays: 14,
    minRatio: 1,
    requireBoth: false,
  });
  assert.match(verdict.reason, /seeded 3\.5 of 14 days/);
  assert.match(verdict.reason, /ratio 0\.75 of 1/);
});

/* ------------------------------------------------------------------ */
/* Library convention detection                                         */
/* ------------------------------------------------------------------ */

test("proposes padded seasons and years when the library uses them", async () => {
  const root = path.join(tempRoot, "plexish");
  await fs.mkdir(path.join(root, "The Bear (2022)", "Season 01"), { recursive: true });
  await fs.mkdir(path.join(root, "Severance (2022)", "Season 02"), { recursive: true });
  await fs.mkdir(path.join(root, "Silo (2023)", "Season 01"), { recursive: true });

  const report = await inspectLibrary("tv", root);

  assert.equal(report.exists, true);
  assert.equal(report.titleCount, 3);
  assert.equal(report.withYear, 3);
  assert.equal(report.proposed.season, "Season {season:00}");
  assert.equal(report.proposed.folder, "{title} ({year})");
  // The summary quotes a real folder from the library, whichever was read first.
  assert.match(report.summary, /Seasons are named like “Season 0\d”/);
});

test("matches an existing library that uses unpadded seasons and no years", async () => {
  const root = path.join(tempRoot, "custom");
  for (const show of ["The Bear", "Severance", "Silo"]) {
    await fs.mkdir(path.join(root, show, "Season 1"), { recursive: true });
    await fs.mkdir(path.join(root, show, "Season 2"), { recursive: true });
  }

  const report = await inspectLibrary("tv", root);

  assert.equal(report.proposed.season, "Season {season}", "should not start padding");
  assert.equal(report.proposed.folder, "{title}", "should not start adding years");
  assert.ok(!report.proposed.file.includes("{year}"));
  assert.match(report.summary, /do not include the year/);
});

test("recognises the S01 style", async () => {
  const root = path.join(tempRoot, "sxx");
  await fs.mkdir(path.join(root, "The Bear (2022)", "S01"), { recursive: true });
  await fs.mkdir(path.join(root, "Silo (2023)", "S02"), { recursive: true });
  await fs.mkdir(path.join(root, "Severance (2022)", "S01"), { recursive: true });

  const report = await inspectLibrary("tv", root);
  assert.equal(report.proposed.season, "S{season:00}");
});

test("reports a missing folder instead of throwing", async () => {
  const report = await inspectLibrary("movie", path.join(tempRoot, "nope"));
  assert.equal(report.exists, false);
  assert.ok(report.problem);
});

test("says so when no folder is configured yet", async () => {
  const report = await inspectLibrary("tv", "");
  assert.equal(report.exists, false);
  assert.match(report.problem ?? "", /No library folder/i);
});
