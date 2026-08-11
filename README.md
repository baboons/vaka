# tvarr

Follow TV shows and movies, watch your torrent RSS feeds, and automatically
download the qualities you asked for.

Search for a show or a film, pick the quality you want, and a background
watcher polls your RSS feeds. When a release matching one of your titles turns
up, it downloads the `.torrent` file into a folder of your choosing — where
your torrent client picks it up.

TV and movies are configured independently: separate download folders and
separate quality profiles, because wanting 4K films but 1080p episodes is the
normal case.

## How it works

Two processes share one SQLite database:

| | |
|---|---|
| **Web interface** (`pnpm dev`) | Search, follow, configure. Never downloads anything. |
| **Watcher** (`pnpm watch`) | Polls feeds, matches releases, writes `.torrent` files. Runs in the background. |

The watcher must be running for anything to download. The web interface shows
whether it is alive and queues work for it (a "check now", a manual grab)
through a job table, so you can also run the watcher headless on a server and
never open the UI at all.

tvarr never talks to your torrent client. It drops files into a **blackhole
folder** — every client supports watching a directory, and no credentials are
involved.

## Quick start

```bash
pnpm install
pnpm dev          # web interface on http://localhost:3000
pnpm watch        # the watcher, in a second terminal
```

Then:

1. **Settings → Feeds** — add your tracker's RSS URL. Use *Test without saving*
   to confirm tvarr can read it before committing.
2. **Settings → TV** and **Settings → Movies** — set each download folder and
   the default quality. Point your torrent client's watch folder at the same
   paths.
3. **Add** — search for a show or film, choose the quality, follow it.

Newly followed titles are immediately checked against releases already cached
from your feeds, so you do not have to wait for the next poll.

## Keeping the watcher running

```bash
pnpm run install:launchd    # macOS  (launchd user agent)
pnpm run install:systemd    # Linux  (systemd user service)

pnpm run service:print      # show the unit file without installing
pnpm run service:remove     # uninstall
```

Both install a **per-user** service that starts at login and restarts if it
exits — the watcher writes into your home directory and must run as you, not as
root. Logs go to `~/.tvarr/watcher.log` (launchd) or the journal
(`journalctl --user -u tvarr-watcher -f`).

On Linux, to keep it running while you are logged out:
`sudo loginctl enable-linger $USER`.

## Feeds

Standard RSS 2.0 and Torznab-style feeds both work. tvarr reads the download
link from `<link>`, `<enclosure>` or a magnet URI, and picks up size and seeder
counts from `torznab:attr` elements, a `<torrent>` block, or plain tags when
they are present.

Each feed can be restricted to **TV only** or **movies only**. That prevents a
film matching a show of the same name — worth doing when you follow both
*Fargo* the series and *Fargo* the film.

If a feed offers only a magnet link, tvarr writes a `.magnet` file containing
the URI. Not every client watches for those; you can turn this off in
**Settings → General** to skip magnet-only releases instead.

## Quality profiles

Every title gets its own copy of a quality profile when you add it, seeded from
the per-library default. Changing the default later does not disturb what you
already follow — edit a specific title under its **Quality** tab.

A profile controls:

- **Accepted qualities** — resolutions that may be grabbed; anything else is
  ignored.
- **Preferred** — the target. When several acceptable releases appear in the
  same poll, the highest scoring one wins, and the rest are turned down with
  *already have 2160p* rather than downloaded on top of it.
- **Upgrade** — keep replacing with better releases until the preferred quality
  is reached. Off by default.
- **Accepted sources** — WEB-DL, BluRay, HDTV and so on. A release whose source
  cannot be identified is still allowed through, since resolution is the filter
  that actually matters and plenty of feeds use sloppy names.
- **Seeders, size limits, and word filters** — must contain / never contain /
  prefer.
- **Season packs** (TV) — off by default.

## Where things go

- `~/.tvarr/tvarr.db` — library, settings, history. Override the location with
  `TVARR_DATA_DIR`; both processes must agree on it.
- Download folders are whatever you configure. With *create a folder per title*
  enabled, files land in `<folder>/Show Name (Year)/`.
- Any title can override its destination under **Quality → Download folder
  override**.

## Why didn't something download?

Open the title and check the **Releases** tab. It lists every cached release
that resolved to that title along with the verdict — accepted, or rejected with
the reason (`480p is not an accepted quality`, `only 2 seeders`, `already
grabbed`). If the release is not listed at all, the feed never carried it, or
the release name did not match the title.

For that last case, add the name the releases actually use under **Quality →
Also match these titles**. Matching is exact on a normalized form of the title
(punctuation and case removed), deliberately: fuzzy matching grabs the wrong
show often enough to be a liability.

The **Activity** log shows the same decisions across everything, and rejections
are only recorded for titles you actually follow — the rest of the feed is
ignored silently.

## Metadata

- **TV** comes from [TVmaze](https://www.tvmaze.com/api) — no API key, full
  episode lists and air dates.
- **Movies** come from Cinemeta, an IMDb-backed catalogue that needs no
  credentials. Add a TMDB API key in **Settings → General** for richer data.

## Commands

```bash
pnpm dev          # web interface (development)
pnpm build        # production build
pnpm start        # production web interface
pnpm watch        # the watcher
pnpm watch:dev    # the watcher, restarting on file changes
pnpm test         # unit tests + end-to-end grab test
pnpm typecheck
```

`pnpm test` includes a test that stands up a real HTTP server serving an RSS
feed and asserts the right `.torrent` files land in the right folders.

## Notes and limits

- The watcher refuses to start if another instance is already running, so a
  stray copy cannot double-grab. Use `pnpm watch --force` to override.
- Anime absolute numbering (`Show - 137`) is not matched; season/episode,
  `1x02`, date-based daily shows and multi-episode files are.
- There is no authentication. Bind it to localhost or put it behind something
  that does auth before exposing it.
- tvarr only downloads the `.torrent`; seeding, unpacking and renaming are your
  torrent client's job.
