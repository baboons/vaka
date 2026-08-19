/**
 * Quality filtering rules.
 *
 * The word filters are the sharp edge here: matching a banned word as a
 * substring silently throws away good releases, and the user only ever sees
 * that something did not download.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { evaluateQuality } from "./match";
import { parseRelease } from "./parse-release";
import { DEFAULT_MOVIE_PROFILE, type QualityProfile } from "./types";

const item = { seeders: 40, sizeBytes: 2_000_000_000 };

function profile(overrides: Partial<QualityProfile> = {}): QualityProfile {
  return {
    ...DEFAULT_MOVIE_PROFILE,
    allowed: ["1080p", "2160p"],
    sources: [],
    bannedWords: [],
    minSeeders: 0,
    ...overrides,
  };
}

test("rejects a cinema rip when the profile does not accept that source", () => {
  const parsed = parseRelease(
    "Skyline Rising (2026) 1080p V3 TC x264 - Driftwood Releases - Dutch Sub",
  );
  const verdict = evaluateQuality(
    profile({ sources: ["remux", "bluray", "webdl", "webrip"] }),
    parsed,
    item,
  );

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /telecine is not accepted/);
});

test("accepts that same rip if telecine is explicitly allowed", () => {
  const parsed = parseRelease("Movie.2026.1080p.TC.x264-GRP");
  const verdict = evaluateQuality(profile({ sources: ["telecine", "webdl"] }), parsed, item);
  assert.equal(verdict.ok, true, "the chip means what it says");
});

test("banned words match whole words, not substrings", () => {
  const banned = profile({ bannedWords: ["tc", "cam"] });

  // The ones the filter is for.
  assert.equal(evaluateQuality(banned, parseRelease("Movie.2026.1080p.TC.x264"), item).ok, false);
  assert.equal(evaluateQuality(banned, parseRelease("Movie.2026.1080p.CAM.x264"), item).ok, false);

  // The ones a substring match would have destroyed.
  for (const title of [
    "Hatchling.Cove.2012.1080p.BluRay.x264-GRP",
    "Catchwater.Bay.2002.1080p.WEB-DL-GRP",
    "Camborne.2024.1080p.WEBRip-GRP",
    "Camellia.Gardens.Doc.2024.1080p.WEB-DL-GRP",
  ]) {
    assert.equal(
      evaluateQuality(banned, parseRelease(title), item).ok,
      true,
      `${title} should not be caught by a banned word`,
    );
  }
});

test("required words match whole words too", () => {
  const needsNordic = profile({ requiredWords: ["nordic"] });

  assert.equal(
    evaluateQuality(needsNordic, parseRelease("Movie.2024.1080p.NORDiC.WEB-DL-GRP"), item).ok,
    true,
  );
  assert.equal(
    evaluateQuality(needsNordic, parseRelease("Movie.2024.1080p.WEB-DL-GRP"), item).ok,
    false,
  );
});

test("a multi-word filter still matches across separators", () => {
  const parsed = parseRelease("Movie.2024.1080p.WEB-DL.DDP5.1-GRP");
  assert.equal(evaluateQuality(profile({ bannedWords: ["web dl"] }), parsed, item).ok, false);
  assert.equal(evaluateQuality(profile({ requiredWords: ["web-dl"] }), parsed, item).ok, true);
});

test("an unidentified source is still allowed through", () => {
  // Deliberate: plenty of feeds omit the source entirely, and resolution is
  // the filter that does the real work.
  const parsed = parseRelease("Movie.2024.1080p.x264-GRP");
  assert.equal(parsed.source, "unknown");
  assert.equal(evaluateQuality(profile({ sources: ["webdl"] }), parsed, item).ok, true);
});
