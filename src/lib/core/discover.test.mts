/**
 * Discovery hides what you already follow. That is harder than it looks:
 * a series is discovered by IMDb id but tracked by TVmaze id, so the two
 * records rarely share a provider.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isTracked } from "./discover";
import type { SearchResult } from "./providers";
import { DEFAULT_TV_PROFILE, type Media } from "./types";

function media(overrides: Partial<Media>): Media {
  return {
    id: 1,
    kind: "tv",
    provider: "tvmaze",
    providerId: "44778",
    imdbId: null,
    tvdbId: null,
    title: "House of the Dragon",
    sortTitle: "house of the dragon",
    year: 2022,
    overview: null,
    poster: null,
    status: null,
    network: null,
    runtime: null,
    genres: [],
    monitored: true,
    quality: DEFAULT_TV_PROFILE,
    searchTerms: [],
    folder: null,
    sport: null,
    state: "wanted",
    grabbedQuality: null,
    grabbedAt: null,
    releaseDate: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    refreshedAt: null,
    ...overrides,
  };
}

function found(overrides: Partial<SearchResult>): SearchResult {
  return {
    kind: "tv",
    provider: "cinemeta",
    providerId: "tt11198330",
    title: "House of the Dragon",
    year: 2022,
    overview: null,
    poster: null,
    status: null,
    network: null,
    runtime: null,
    genres: [],
    imdbId: "tt11198330",
    tvdbId: null,
    releaseDate: null,
    ...overrides,
  };
}

test("matches the same title across providers via its IMDb id", () => {
  // Discovered from Cinemeta, already tracked through TVmaze.
  const library = [media({ imdbId: "tt11198330" })];
  assert.equal(isTracked(found({}), library), true);
});

test("matches a Cinemeta-tracked movie whose providerId is the IMDb id", () => {
  const library = [
    media({ kind: "movie", provider: "cinemeta", providerId: "tt15239678", title: "Dune: Part Two", year: 2024 }),
  ];
  const item = found({
    kind: "movie",
    providerId: "tt15239678",
    imdbId: null,
    title: "Dune: Part Two",
    year: 2024,
  });
  assert.equal(isTracked(item, library), true);
});

test("matches on the TVDB id", () => {
  const library = [media({ tvdbId: "371572" })];
  assert.equal(isTracked(found({ imdbId: null, tvdbId: "371572" }), library), true);
});

test("falls back to title and year when no ids line up", () => {
  const library = [media({})];
  assert.equal(isTracked(found({ imdbId: null, providerId: "x" }), library), true);

  // A year apart is still the same show; providers disagree on premiere dates.
  assert.equal(isTracked(found({ imdbId: null, providerId: "x", year: 2023 }), library), true);
  assert.equal(isTracked(found({ imdbId: null, providerId: "x", year: 2015 }), library), false);
});

test("keeps a film and a series of the same name apart", () => {
  const library = [media({ kind: "tv", title: "Fargo", year: 2014, imdbId: "tt2802850" })];
  const film = found({ kind: "movie", title: "Fargo", year: 1996, imdbId: "tt0116282" });
  assert.equal(isTracked(film, library), false);
});

test("does not hide something merely similar", () => {
  const library = [media({ title: "The Bear", year: 2022 })];
  assert.equal(isTracked(found({ title: "The Bear Hunt", year: 2022, imdbId: null }), library), false);
});

test("an empty library hides nothing", () => {
  assert.equal(isTracked(found({}), []), false);
});
