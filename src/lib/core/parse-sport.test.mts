/**
 * Reading sports release names.
 *
 * The cases that matter are the ones where a token means something in one
 * competition and something else in another: "F1" inside "F1 Academy", a
 * number after "UFC" versus a number after "UFC Fight Night".
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseSportRelease } from "./parse-sport";

test("reads a numbered fight card", () => {
  const r = parseSportRelease("UFC.319.PPV.Calder.vs.Ellery.1080p.WEB.DL.H264.Fight-BB");
  assert.equal(r.league?.id, "ufc");
  assert.equal(r.eventNumber, 319);
  assert.equal(r.session, "main-card");
});

test("tells the three parts of a fight night apart", () => {
  const parts: Array<[string, string]> = [
    ["UFC.319.Early.Prelims.1080p.WEB-DL.H264-GRP", "early-prelims"],
    ["UFC.319.Prelims.720p.WEB.DL.H264-GRP", "prelims"],
    ["UFC.319.Main.Card.1080p.WEB-DL.H264-GRP", "main-card"],
    ["UFC.319.1080p.WEB-DL.H264-GRP", "full-event"],
  ];

  for (const [title, session] of parts) {
    assert.equal(parseSportRelease(title).session, session, title);
  }
});

test("a Fight Night number is not an event number", () => {
  // "UFC 319" is one specific card. "UFC Fight Night 245" numbers a series of
  // cards that ESPN does not number at all, so trusting it would confidently
  // match the wrong night.
  const numbered = parseSportRelease("UFC.319.Prelims.1080p.WEB-DL-GRP");
  assert.equal(numbered.eventNumber, 319);

  const fightNight = parseSportRelease("UFC.Fight.Night.245.Dunmore.vs.Fenwick.WEB.DL-GRP");
  assert.equal(fightNight.league?.id, "ufc");
  assert.equal(fightNight.eventNumber, null);
});

test("a year after the competition name is not an event number", () => {
  const r = parseSportRelease("Formula1.2026.Coastal.Grand.Prix.Race.1080p50");
  assert.equal(r.league?.id, "f1");
  assert.equal(r.eventNumber, null);
  assert.equal(r.year, 2026);
  assert.equal(r.session, "race");
});

test("F1 Academy and Formula E are not Formula 1", () => {
  // Both genuinely contain an F1-shaped token; only an exclusion separates them.
  assert.equal(parseSportRelease("F1.Academy.2026.Round.1.Race.1.1080p").league, null);
  assert.equal(parseSportRelease("Formula.E.2026.Mexico.City.EPrix.1080p").league, null);
  assert.equal(
    parseSportRelease("Formula1.2026.Lakeside.Grand.Prix.Race.1080p").league?.id,
    "f1",
  );
});

test("reads dates from league fixtures", () => {
  const epl = parseSportRelease("EPL.2026.08.21.Westford.City.vs.Eastport.1080p.WEB.h264-GRP");
  assert.equal(epl.league?.id, "eng.1");
  assert.equal(epl.date, "2026-08-21");

  const nhl = parseSportRelease("NHL.RS.2026.03.10.Falcons.vs.Harriers.720p60.WEB.h264-GRP");
  assert.equal(nhl.league?.id, "nhl");
  assert.equal(nhl.date, "2026-03-10");
});

test("recognises the long form of a league name", () => {
  assert.equal(
    parseSportRelease("Premier.League.2026.08.22.Kingsway.vs.Redhill.City.720p.HDTV").league?.id,
    "eng.1",
  );
  assert.equal(
    parseSportRelease("UEFA.Champions.League.2026.09.16.Eastport.vs.Portside.1080p").league?.id,
    "uefa.champions",
  );
});

test("the longest matching name wins", () => {
  // "Champions League" and "Europa League" both contain "league"; a shorter
  // alias must never outrank the one that actually names the competition.
  const r = parseSportRelease("UEFA.Europa.League.2026.10.02.Roma.vs.Ajax.1080p");
  assert.equal(r.league?.id, "uefa.europa");
});

test("spots the parts nobody means by 'get me the fight'", () => {
  const cases: Array<[string, string]> = [
    ["UFC.319.Extended.Highlights.1080p.WEB-DL-GRP", "highlights"],
    ["NHL.2026.03.10.Falcons.vs.Harriers.Condensed.Game.720p", "highlights"],
    ["UFC.319.Weigh.Ins.1080p.WEB-DL-GRP", "extra"],
    ["UFC.319.Press.Conference.1080p.WEB-DL-GRP", "extra"],
    ["Formula1.2026.Coastal.GP.Qualifying.1080p", "qualifying"],
    ["Formula1.2026.Coastal.GP.FP2.1080p", "practice"],
    ["Formula1.2026.Harbour.GP.Sprint.1080p", "sprint"],
  ];

  for (const [title, session] of cases) {
    assert.equal(parseSportRelease(title).session, session, title);
  }
});

test("a release that says nothing about the part is the event itself", () => {
  const r = parseSportRelease("NHL.2026.03.10.Falcons.vs.Harriers.1080p.WEB-DL-GRP");
  assert.equal(r.session, "full-event");
  assert.equal(r.sessionStated, false);
});

test("ordinary television is not mistaken for sport", () => {
  for (const title of [
    "Northwind.S05E03.1080p.WEB-DL.DDP5.1.H.264-NOVA",
    "Deep.Field.Part.Two.2024.2160p.WEB-DL-ZEPH",
    "Tidewater.S04E02.1080p.WEB-DL-GRP",
  ]) {
    assert.equal(parseSportRelease(title).league, null, title);
  }
});
