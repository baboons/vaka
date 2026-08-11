<p align="center">
  <img src="public/logo.svg" width="96" height="96" alt="">
</p>

<h1 align="center">tvarr</h1>

<p align="center">
  Follow TV shows and movies, watch your torrent RSS feeds, and automatically
  download the qualities you asked for.
</p>

Search for a show or a film, pick the quality you want, and a background
watcher polls your RSS feeds. When a release matching one of your titles turns
up, it downloads the `.torrent` file into a folder of your choosing — where
your torrent client picks it up.

TV and movies are configured independently: separate download folders and
separate quality profiles, because wanting 4K films but 1080p episodes is the
normal case. Point it at a Plex server and anything you already own is crossed
off automatically.

## How it works

Two processes share one SQLite database:

| | |
|---|---|
| **Web interface** (`pnpm dev` / `pnpm start`) | Search, follow, configure. Never downloads anything. Port **4000** by default. |
| **Watcher** (`pnpm watch`) | Polls feeds, matches releases, writes `.torrent` files. |

The watcher must be running for anything to download. The web interface shows
whether it is alive and queues work for it (a "check now", a manual grab)
through a job table, so you can also run the watcher headless on a server and
never open the UI at all.

Installing tvarr as a service runs **both**, supervised separately, so a
crashed UI never stops downloads.

tvarr never talks to your torrent client. It drops files into a **blackhole
folder** — every client supports watching a directory, and no credentials are
involved.

## Quick start

```bash
pnpm install
pnpm dev          # web interface on http://localhost:4000
pnpm watch        # the watcher, in a second terminal
```

Set `PORT` to use a different port: `PORT=8080 pnpm dev`.

Then:

1. **Settings → Feeds** — add your tracker's RSS URL. Use *Test without saving*
   to confirm tvarr can read it before committing.
2. **Settings → TV** and **Settings → Movies** — set each download folder and
   the default quality. Point your torrent client's watch folder at the same
   paths.
3. **Add** — search for a show or film, choose the quality, follow it.

Newly followed titles are immediately checked against releases already cached
from your feeds, so you do not have to wait for the next poll.

## Running it as a service

```bash
pnpm install
pnpm build                    # the web service needs a production build
pnpm run service:install      # installs and starts both, on Linux and macOS
```

That installs two **per-user** services — systemd user units on Linux,
launchd agents on macOS — which start at login and restart if they exit:

| Unit | What it does |
|---|---|
| `tvarr-watcher` | Polls feeds and downloads |
| `tvarr-web` | Serves the interface on port 4000 |

They are per-user, not system-wide, because tvarr writes into your home
directory and must run as you rather than as root.

```bash
pnpm run service:status       # both services + the watcher's heartbeat
pnpm run service:logs         # follow both logs
pnpm run service:restart
pnpm run service:stop
pnpm run service:print        # show the unit files without installing
pnpm run service:uninstall
```

Install on a different port with `PORT=8080 pnpm run service:install`. The port
and `TVARR_DATA_DIR` are baked into the unit at install time, and re-running
install (which every update does) keeps whatever the last install chose — so an
update never moves you off a custom port or database. Pass the variable again
to change it.

On Linux, to keep tvarr running while you are logged out:

```bash
sudo loginctl enable-linger $USER
```

## Updating

```bash
pnpm run update               # pull, install, build, restart both services
```

In order: `git pull --ff-only` → `pnpm install` → `pnpm build` → restart the
watcher **and** the web service, so the interface comes back on the freshly
built code rather than the old bundle.

It fast-forwards only, so it can never lose local commits, and it refuses to
run with a dirty working tree. If nothing was pulled it stops early instead of
rebuilding. `--no-build` skips the web build on watcher-only hosts; `--force`
runs every step regardless.

If the build fails, the update stops and leaves the old version running rather
than restarting into a broken one. The web interface may briefly serve stale
assets while the build rewrites `.next`; the restart at the end clears that.

The update reinstalls the unit files before restarting, which keeps the
recorded `node` path correct across Node upgrades — otherwise a service can end
up pointing at a version that no longer exists.

> Use `pnpm run update`. Plain `pnpm update` is pnpm's own dependency updater,
> which is a different thing entirely.

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

## Plex

If you already have a Plex server, point tvarr at it under **Settings → Plex**
and everything Plex holds is crossed off, so the watcher never downloads a
second copy. Add a show you already own eight seasons of and only the missing
episodes stay wanted.

You need the server address (`http://192.168.1.10:32400`) and an
`X-Plex-Token`: in Plex, open any item → **Get Info** → **View XML**, and the
token is the `X-Plex-Token` at the end of the address bar. Plain `http` on a
LAN avoids certificate trouble.

Matching prefers IMDb, TVDB and TMDB ids and falls back to title and year, so
libraries built by the older Plex agents still match. The scan runs on a timer
(hourly by default), immediately when you enable it, and once more whenever you
add a title — before the first feed search, so a back catalogue you own is
never queued.

Two things worth knowing:

- **It is strictly read-only.** tvarr asks what is on the shelves and nothing
  more; it never writes to Plex.
- **It only ever marks things as had, never as wanted again.** If Plex is
  offline, mid-scan or missing a drive, the worst case is that nothing new gets
  crossed off — not a wave of re-downloads. If you delete something from Plex
  and want it back, mark it wanted in tvarr.

Episodes crossed off this way show as `1080p · Plex`, and with **upgrade**
enabled in the quality profile a better release will still replace them.

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
pnpm dev          # web interface (development), port 4000
pnpm build        # production build
pnpm start        # production web interface, port 4000
pnpm watch        # the watcher
pnpm watch:dev    # the watcher, restarting on file changes

pnpm run update   # pull, install, build, restart the services
pnpm run service:install|status|logs|restart|start|stop|print|uninstall

pnpm test         # unit tests + end-to-end grab test
pnpm typecheck
pnpm lint
```

`pnpm test` includes a test that stands up a real HTTP server serving an RSS
feed and asserts the right `.torrent` files land in the right folders.

## Notes and limits

- The watcher refuses to start if another instance is already running, so a
  stray copy cannot double-grab. Use `pnpm watch --force` to override.
- Anime absolute numbering (`Show - 137`) is not matched; season/episode,
  `1x02`, date-based daily shows and multi-episode files are.
- There is no authentication. Keep it on your LAN or put it behind something
  that does auth before exposing it to the internet.
- **Opening the dev server from another machine** (`http://10.0.1.2:4000`)
  needs that origin allowlisted, or Next returns 403 for every `/_next/*`
  chunk and the hot-reload socket fails. This machine's own LAN addresses are
  allowlisted automatically; add hostnames with
  `TVARR_DEV_ORIGINS=tvarr.local,box.lan`. Production (`pnpm start`, and the
  installed service) is unaffected.
- tvarr only downloads the `.torrent`; seeding, unpacking and renaming are your
  torrent client's job.
