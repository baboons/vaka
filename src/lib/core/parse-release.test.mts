import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTitle, parseRelease } from "./parse-release";

test("parses a standard single episode release", () => {
  const r = parseRelease("Northwind.S05E03.1080p.WEB-DL.DDP5.1.H.264-NOVA");
  assert.equal(r.title, "Northwind");
  assert.equal(r.season, 5);
  assert.deepEqual(r.episodes, [3]);
  assert.equal(r.resolution, "1080p");
  assert.equal(r.source, "webdl");
  assert.equal(r.codec, "x264");
  assert.equal(r.group, "NOVA");
  assert.equal(r.looksLikeMovie, false);
});

test("parses a 4K bluray remux with HDR", () => {
  const r = parseRelease("Glasshouse.S02E01.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC-MERIDIAN");
  assert.equal(r.resolution, "2160p");
  assert.equal(r.source, "remux");
  assert.equal(r.hdr, true);
  assert.equal(r.codec, "x265");
});

test("parses multi-episode and ranged releases", () => {
  const multi = parseRelease("Show.Name.S01E01E02.720p.HDTV.x264-GRP");
  assert.deepEqual(multi.episodes, [1, 2]);

  const range = parseRelease("Show.Name.S01E01-E04.1080p.WEB.h264-GRP");
  assert.deepEqual(range.episodes, [1, 2, 3, 4]);
});

test("parses the 1x02 style", () => {
  const r = parseRelease("Some Show - 2x07 - The Long Way Home [1080p]");
  assert.equal(r.season, 2);
  assert.deepEqual(r.episodes, [7]);
  assert.equal(r.title, "Some Show");
});

test("detects season packs but not individual episodes", () => {
  const pack = parseRelease("Harbour.Lights.S03.1080p.WEB-DL.x265-GRP");
  assert.equal(pack.isSeasonPack, true);
  assert.equal(pack.season, 3);
  assert.deepEqual(pack.episodes, []);

  const single = parseRelease("Harbour.Lights.S03E01.1080p.WEB-DL.x265-GRP");
  assert.equal(single.isSeasonPack, false);
});

test("parses daily / date based releases", () => {
  const r = parseRelease("The.Nightly.Review.2024.03.14.1080p.WEB.h264-GRP");
  assert.equal(r.airDate, "2024-03-14");
  assert.equal(r.title, "The Nightly Review");
  assert.equal(r.looksLikeMovie, false);
});

test("parses a movie with a year", () => {
  const r = parseRelease("Deep.Field.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-ZEPH");
  assert.equal(r.title, "Deep Field Part Two");
  assert.equal(r.year, 2024);
  assert.equal(r.looksLikeMovie, true);
  assert.equal(r.season, null);
});

test("keeps a numeric title intact while reading the release year", () => {
  const r = parseRelease("Skyline.2049.2017.1080p.BluRay.x264-GRP");
  assert.equal(r.title, "Skyline 2049");
  assert.equal(r.year, 2017);
});

test("splits a year off the title so the matcher can try it either way", () => {
  // "Night Signal (2005)" is the canonical title, so the matcher compares both
  // `nightsignal` and `nightsignal2005` — see titleKeys() in match.ts.
  const r = parseRelease("Night.Signal.2005.S04E01.720p.HDTV.x264-GRP");
  assert.equal(r.season, 4);
  assert.deepEqual(r.episodes, [1]);
  assert.equal(normalizeTitle(r.title), "nightsignal");
  assert.equal(r.year, 2005);
});

test("does not read an apostrophe-s title as a season number", () => {
  const r = parseRelease("Harbour's.9.2018.1080p.BluRay.x264-GRP");
  assert.equal(r.season, null);
  assert.equal(r.looksLikeMovie, true);
  assert.equal(r.year, 2018);
});

test("flags repack and proper", () => {
  const r = parseRelease("Show.Name.S01E01.REPACK.1080p.WEB-DL-GRP");
  assert.equal(r.repack, true);
  const p = parseRelease("Show.Name.S01E01.PROPER.1080p.WEB-DL-GRP");
  assert.equal(p.proper, true);
});

test("normalizes punctuation-heavy titles to a comparable form", () => {
  assert.equal(normalizeTitle("Nadia's Agents of S.T.O.R.M."), "nadiasagentsofstorm");
  assert.equal(normalizeTitle("Nadias Agents of STORM"), "nadiasagentsofstorm");
  assert.equal(normalizeTitle("Nadia's Diner & Co"), "nadiasdinerandco");
});

test("detects the whole pre-retail family, however it is abbreviated", () => {
  const cases: Array<[string, string]> = [
    ["New.Movie.2025.HDCAM.x264-GRP", "cam"],
    ["New.Movie.2025.CAMRip.x264-GRP", "cam"],
    ["New.Movie.2025.HDTS.720p.x264-GRP", "telesync"],
    ["New.Movie.2025.TELESYNC.1080p-GRP", "telesync"],
    ["New.Movie.2025.PDVD.x264-GRP", "telesync"],
    // The one that got through: tagged only "TC", with a 1080p label.
    ["Skyline Rising (2026) 1080p V3 TC x264 - Driftwood Releases", "telecine"],
    ["New.Movie.2025.HDTC.1080p.x264-GRP", "telecine"],
    ["New.Movie.2025.TELECINE.x264-GRP", "telecine"],
    ["New.Movie.2025.DVDSCR.x264-GRP", "screener"],
    ["New.Movie.2025.R5.x264-GRP", "screener"],
  ];

  for (const [title, expected] of cases) {
    assert.equal(parseRelease(title).source, expected, title);
  }
});

test("does not mistake ordinary titles for cinema rips", () => {
  // "TC" and "TS" only count as their own token, not inside a word.
  assert.equal(parseRelease("Hatchling.Cove.2012.1080p.BluRay.x264-GRP").source, "bluray");
  assert.equal(parseRelease("Catchwater.Bay.2002.1080p.WEB-DL-GRP").source, "webdl");
  assert.equal(parseRelease("Lanterns.S01E01.1080p.WEB-DL-GRP").source, "webdl");
  assert.equal(parseRelease("Camborne.2024.1080p.WEBRip-GRP").source, "webrip");
});

test("a real source still wins over a stray marker", () => {
  assert.equal(parseRelease("Movie.2024.2160p.UHD.BluRay.REMUX.HDR-GRP").source, "remux");
  assert.equal(parseRelease("Movie.2024.1080p.AMZN.WEB-DL.DDP5.1-GRP").source, "webdl");
});
