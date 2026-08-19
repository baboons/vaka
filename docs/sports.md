# Sports

[← back to the README](../README.md)

You follow a **competition** — UFC, the Premier League, the NHL, Formula 1 —
and Vaka pulls its calendar from ESPN's public schedule, then watches your
feeds for each event.

Browse the catalogue under **Add → Sports**. It is a fixed list rather than an
open search: a competition is only followable if Vaka can read the tokens its
releases carry, and following one it cannot read would match nothing.

## Two things to choose

- **Teams.** A Premier League season is 380 fixtures; an NHL season is over
  1,300. The filter is applied when the calendar is fetched, so only your
  fixtures are stored.
- **Parts of an event.** Main card, prelims, race, qualifying, and so on. A
  fight night is posted five or six times over, and the highlight reel is not
  the fight.

Both can be changed later under the competition's **Following** tab. Saving
re-fetches the calendar, because the team filter decides what is stored in the
first place.

## Why it sometimes asks

A TV release carries `S03E01`, which names exactly one episode. A sports
release carries no such thing — it might give the date and not the teams, or a
number that means everything (`UFC 330`) beside one that means nothing (`UFC
Fight Night 245`).

So releases are scored against the calendar rather than judged:

| | |
|---|---|
| **Confident** | Downloaded. |
| **Probable** | Listed under the competition's **Releases** tab with its score, for you to grab in one click. |
| **Below that** | Not treated as a match. |

A different event number, or a date more than two days out, is a flat refusal
rather than a low score — `UFC 330` is never filed as `UFC 331`.

The scoring allows for what actually trips this up: a night game that rolls
past midnight UTC is one day out rather than a mismatch, a race weekend is
tagged with any of its three days, and "Australian" and "Australia" are the
same place.

Switch on **Download uncertain matches too** if you would rather have the best
guess than be asked. It is off by default: downloading the wrong game is worse
than downloading nothing.

## The calendar window

Only events inside the window are stored, and only they can be matched. Set it
under **Settings → Sports**: 60 days ahead and 21 behind by default.

Days *behind* matter because a release always lands after the broadcast. A
week or two is usually enough, longer if your feeds are slow.

## Where events are filed

Events are grouped by competition and then by year:

```
/media/Sports/UFC/2026/UFC - 2026-08-15 - UFC 330 Makhachev vs Garry.mkv
```

Plex reads sports best as a personal-media or *Other Videos* library. The
naming templates work the same way as the TV and movie ones, with an extra
`{airDate}` token.
