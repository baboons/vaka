/**
 * Scoring a sports release against a calendar.
 *
 * Two things are being checked here, and the second matters as much as the
 * first: that a release lands on the right event, and that a release which
 * only *probably* lands on it is reported as probable rather than grabbed.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { AUTO_SCORE, bestSportMatch, MIN_SCORE, scoreSportEvent } from "./match-sport";
import { parseSportRelease } from "./parse-sport";
import { fighterGroups, raceGroup, teamAliases } from "./sports";
import type { Episode, SportEventMeta } from "./types";

let nextId = 1;

function event(
  title: string,
  airDate: string,
  sport: Partial<SportEventMeta> = {},
): Episode {
  return {
    id: nextId++,
    mediaId: 1,
    providerId: `espn-${nextId}`,
    season: Number(airDate.slice(0, 4)),
    number: nextId,
    title,
    airDate,
    runtime: null,
    monitored: true,
    state: "wanted",
    grabbedQuality: null,
    grabbedAt: null,
    sport: { eventNumber: null, competitors: [], identityGroups: [], ...sport },
  };
}

const KINGS_AT_BRUINS = event("Los Angeles Kings at Boston Bruins", "2026-03-10T23:00Z", {
  competitors: ["Boston Bruins", "Los Angeles Kings"],
  identityGroups: [
    ["Boston Bruins", "Bruins", "Boston", "BOS"],
    ["Los Angeles Kings", "Kings", "Los Angeles", "LA"],
  ],
});

test("an event number identifies a card on its own", () => {
  const verdict = scoreSportEvent(
    parseSportRelease("UFC.319.Main.Card.1080p.WEB-DL.H264-GRP"),
    event("UFC 319: Du Plessis vs. Chimaev", "2026-08-16T22:00Z", { eventNumber: 319 }),
  );

  assert.ok(verdict);
  assert.ok(verdict.confident, `${verdict.score} should clear ${AUTO_SCORE}`);
});

test("a different event number is a refusal, not a low score", () => {
  // The whole point of the number: UFC 320 must never be filed as UFC 319,
  // however much else the two names have in common.
  const verdict = scoreSportEvent(
    parseSportRelease("UFC.320.Main.Card.1080p.WEB-DL-GRP"),
    event("UFC 319: Du Plessis vs. Chimaev", "2026-08-16T22:00Z", { eventNumber: 319 }),
  );

  assert.equal(verdict, null);
});

test("date and both teams is as sure as this gets", () => {
  const verdict = scoreSportEvent(
    parseSportRelease("NHL.2026.03.10.Kings.vs.Bruins.720p60.WEB.h264-GRP"),
    KINGS_AT_BRUINS,
  );

  assert.ok(verdict);
  assert.ok(verdict.confident);
  assert.ok(verdict.reasons.includes("same date"));
  assert.ok(verdict.reasons.includes("both named"));
});

test("a date on its own is a maybe, not a download", () => {
  // Fifty other games were played that night. The release is probably one of
  // them; it is not identified, so it waits for a person.
  const verdict = scoreSportEvent(
    parseSportRelease("NHL.2026.03.10.1080p.WEB-DL-GRP"),
    KINGS_AT_BRUINS,
  );

  assert.ok(verdict);
  assert.ok(verdict.score >= MIN_SCORE, "worth showing");
  assert.equal(verdict.confident, false, "not worth grabbing unattended");
});

test("one team plus the exact date is enough", () => {
  // Only one game that night involves Boston, so naming half the fixture
  // still picks out a single event.
  const verdict = scoreSportEvent(
    parseSportRelease("NHL.2026.03.10.Bruins.1080p.WEB-DL-GRP"),
    KINGS_AT_BRUINS,
  );

  assert.ok(verdict);
  assert.ok(verdict.confident);
});

test("a name with no date and no number identifies nothing", () => {
  const verdict = scoreSportEvent(
    parseSportRelease("NHL.Bruins.1080p.WEB-DL-GRP"),
    KINGS_AT_BRUINS,
  );

  assert.ok(verdict === null || verdict.score < MIN_SCORE);
});

test("a night game that rolls past midnight still matches", () => {
  // Puck drop 20:00 Eastern on the 10th is 01:00 UTC on the 11th; the release
  // is named for the day it was played.
  const late = event("Los Angeles Kings at Boston Bruins", "2026-03-11T01:00Z", {
    identityGroups: [["Boston Bruins", "Bruins"], ["Los Angeles Kings", "Kings"]],
  });

  const verdict = scoreSportEvent(
    parseSportRelease("NHL.2026.03.10.Kings.vs.Bruins.720p60-GRP"),
    late,
  );

  assert.ok(verdict);
  assert.ok(verdict.confident);
  assert.ok(verdict.reasons.includes("one day out"));
});

test("a date days away is a refusal", () => {
  const verdict = scoreSportEvent(
    parseSportRelease("NHL.2026.03.17.Kings.vs.Bruins.720p60-GRP"),
    KINGS_AT_BRUINS,
  );

  assert.equal(verdict, null);
});

test("a race is identified by where it is run", () => {
  const race = event("Qatar Airways Australian Grand Prix", "2026-03-06T01:30Z", {
    identityGroups: raceGroup("Qatar Airways Australian Grand Prix"),
  });

  const verdict = scoreSportEvent(
    parseSportRelease("Formula1.2026.Australian.Grand.Prix.Race.SkyF1HD.1080p50"),
    race,
  );

  assert.ok(verdict);
  assert.ok(verdict.confident);
});

test("Australia and Australian are the same place", () => {
  // Without this, sports matching turns into a table of demonyms.
  const race = event("Australia Grand Prix", "2026-03-06T01:30Z", {
    identityGroups: [["Australia"]],
  });

  const verdict = scoreSportEvent(
    parseSportRelease("Formula1.2026.Australian.GP.Race.1080p"),
    race,
  );

  assert.ok(verdict);
  assert.ok(verdict.confident);
});

test("picks the right fixture out of a night's worth", () => {
  const calendar = [
    event("San Jose Sharks at Buffalo Sabres", "2026-03-10T23:00Z", {
      identityGroups: [["Buffalo Sabres", "Sabres"], ["San Jose Sharks", "Sharks"]],
    }),
    KINGS_AT_BRUINS,
    event("Toronto Maple Leafs at Montreal Canadiens", "2026-03-10T23:00Z", {
      identityGroups: [["Montreal Canadiens", "Canadiens"], ["Toronto Maple Leafs", "Maple Leafs"]],
    }),
  ];

  const match = bestSportMatch(
    parseSportRelease("NHL.2026.03.10.Kings.vs.Bruins.720p60-GRP"),
    calendar,
  );

  assert.ok(match);
  assert.equal(match.episode.id, KINGS_AT_BRUINS.id);
  assert.ok(match.confident);
});

test("derives the ways a subject can be named", () => {
  assert.deepEqual(
    teamAliases({
      displayName: "Boston Bruins",
      shortDisplayName: "Bruins",
      location: "Boston",
      name: "Bruins",
      abbreviation: "BOS",
    }),
    ["Boston Bruins", "Bruins", "Boston", "BOS"],
  );

  assert.deepEqual(fighterGroups("UFC 319: Du Plessis vs. Chimaev"), [
    ["Du Plessis", "Plessis"],
    ["Chimaev"],
  ]);

  assert.deepEqual(raceGroup("Heineken Chinese Grand Prix"), [["Chinese"]]);
});
