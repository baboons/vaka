# Quality profiles

[← back to the README](../README.md)

Every title gets its own copy of a profile when you add it, seeded from the
per-library default. Changing the default later does not disturb what you
already follow — edit a title under its **Quality** tab.

## What a profile controls

- **Accepted qualities** — resolutions that may be grabbed.
- **Preferred** — the target. When several acceptable releases appear at once,
  the highest scoring wins and the rest are turned down rather than downloaded
  on top.
- **Upgrade** — keep replacing until the preferred quality is reached. Off by
  default.
- **Accepted sources** — WEB-DL, BluRay, HDTV and so on. Cinema rips are split
  into CAM, TS, TC and Screener, each recognised by every abbreviation in
  common use. A source that cannot be identified is allowed through.
- **Seeders, size limits, word filters** — must contain / never contain /
  prefer. Matched as whole words, so banning `tc` does not throw away *The
  Watch*.
- **Season packs** (TV) — off by default.

## Matching a title

Matching is exact on a normalized form of the title, with punctuation and case
removed. Fuzzy matching grabs the wrong show often enough to be a liability.

When releases use a name the provider does not, add it under **Quality → Also
match these titles**.
