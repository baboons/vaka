<p align="center">
  <img src="public/logo.svg" width="96" height="96" alt="">
</p>

<h1 align="center">tvarr</h1>

<p align="center">
  Follow TV shows, movies and sport, watch your torrent RSS feeds, and
  automatically download the qualities you asked for.
</p>

Search for a show, a film or a competition, pick the quality you want, and a
background watcher polls your RSS feeds. When a release matching one of your
titles turns up, it downloads the `.torrent` file into a folder of your
choosing — where your torrent client picks it up.

TV, movies and sport are configured independently: separate download folders
and separate quality profiles, because wanting 4K films but 1080p episodes is
the normal case. Point it at a Plex server and anything you already own is
crossed off automatically.

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
2. **Settings → TV**, **→ Movies** and **→ Sports** — set each download folder
   and the default quality. Point your torrent client's watch folder at the
   same paths.
3. **Add** — search for a show or film, or browse the sports catalogue, choose
   the quality, follow it.

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

## Discover

The dashboard suggests things you are not already following, in two views:

- **Popular now** — what people are watching, for TV and film.
- **Coming soon** — premieres in the next weeks with their air date and
  network, plus upcoming films. Returning seasons count as premieres and are
  labelled (*Season 4*, *New series*), because a new season of something big is
  usually what you are looking for.

Anything already in your library is filtered out, matched across providers by
IMDb/TVDB id and falling back to title and year. Every card has a one-click
follow that opens the usual quality dialog.

Clicking a poster — in Discover or in search results — opens a preview page
with the full synopsis, genres, runtime, status and a season-by-season
breakdown, plus a link out to IMDb. Discovery lists are deliberately sparse
(the keyless catalogue carries no descriptions), so the preview fetches the
real record on demand and caches it for a day. Titles you already follow show
a link straight to their library page instead of a follow button.

Both rows are ranked before they are cut, not after. Premieres are ordered by
TVmaze's popularity weight and only then put back in date order — sorting by
date alone fills the row with whatever local magazine show happens to air
tomorrow. New releases are ordered by popularity with the IMDb rating as a
tiebreak, since a 9.2 from eleven votes should not outrank a blockbuster.

The rows scroll sideways with a mouse wheel while the pointer is over them, and
the page is held still for as long as it is — including at the first and last
card. Move the pointer off the row to scroll the page again. A row short enough
to fit never captures the wheel at all.

Popular TV comes from Cinemeta's IMDb-backed ranking rather than TVmaze's own
popularity, which ranks by what is airing and therefore surfaces soaps and talk
shows. Premieres come from the TVmaze schedule. Films come from TMDB when a key
is configured and Cinemeta otherwise — and because the keyless catalogue only
lists films that are already out, the movie row under *Coming soon* is honestly
labelled **New releases** until you add a TMDB key.

Cache entries carry the version of the code that produced them, and `pnpm run
update` drops them outright — so a change to how a list is built shows up
immediately instead of hours later.

Lists are cached (6 hours for popular, 12 for upcoming), so the dashboard's
auto-refresh costs nothing. If a provider is unreachable the last good list is
shown and marked as cached rather than disappearing.

## Sports

Sport is a third library alongside TV and movies. You follow a **competition**
rather than a title — UFC, the Premier League, the NHL, Formula 1 — and tvarr
pulls its calendar from ESPN's public schedule, then watches your feeds for
each event.

For a league you almost always want to pick **teams**. A Premier League season
is 380 fixtures and an NHL season is over 1,300; the filter is applied when the
calendar is fetched, so only the fixtures you care about are ever stored.

You also choose which **parts of an event** to accept — main card, prelims,
early prelims, race, qualifying, practice — because a single fight night is
posted five or six times over, and the highlight reel is not the fight.

### Matching, and why it asks

A TV release carries `S03E01`, which identifies exactly one episode. A sports
release carries no such thing. It might give the date and not the teams, or the
teams and not the date, or a number that means everything (`UFC 330`) beside
one that means nothing (`UFC Fight Night 245`).

So tvarr scores each release against the calendar instead of judging it, and
uses two thresholds:

| | |
|---|---|
| **Confident** | Downloaded straight away. |
| **Probable** | Listed under the competition's **Releases** tab, with the score and what it was made of, for you to grab in one click. |
| **Below that** | Not treated as a match at all. |

Some evidence is a flat refusal rather than a low score: a different event
number, or a date more than two days out. `UFC 330` is never filed as `UFC 331`.

The scoring accounts for the things that trip this up in practice — a night
game that rolls past midnight UTC is one day out, not a mismatch; a race
weekend is tagged with any of its three days; "Australian" and "Australia" are
the same place.

Switch on **Download uncertain matches too** on a competition if you would
rather have the best guess than be asked. It is off by default: downloading the
wrong game is a worse outcome than downloading nothing.

### What gets filed where

Events are grouped by competition and then by year:

```
/media/Sports/UFC/2026/UFC - 2026-08-15 - UFC 330 Makhachev vs Machado Garry.mkv
```

Plex reads sports best as a personal-media or *Other Videos* library; the
naming templates under **Settings → Sports** work the same way as the TV and
movie ones, with an extra `{airDate}` token.

## Feeds

Standard RSS 2.0 and Torznab-style feeds both work. tvarr reads the download
link from `<link>`, `<enclosure>` or a magnet URI, and picks up size and seeder
counts from `torznab:attr` elements, a `<torrent>` block, or plain tags when
they are present.

Each feed can be restricted to **TV only**, **movies only** or **sports only**.
That prevents a film matching a show of the same name — worth doing when you
follow both *Fargo* the series and *Fargo* the film.

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
- **Accepted sources** — WEB-DL, BluRay, HDTV and so on. The pre-retail family
  is split into CAM, TS (telesync), TC (telecine) and Screener, and each is
  recognised by every abbreviation in common use — a cinema rip tagged only
  `TC` next to a `1080p` label is still a cinema rip. A release whose source
  cannot be identified at all is allowed through, since plenty of feeds omit it
  entirely and resolution is the filter doing the real work.
- **Seeders, size limits, and word filters** — must contain / never contain /
  prefer. Words are matched as whole words, so banning `tc` does not also throw
  away *The Watch* and *Catch Me*.
- **Season packs** (TV) — off by default.

## Filing downloads into your library

tvarr can take finished downloads and put them where Plex expects them:

```
/media/TV/The Bear (2022)/Season 03/The Bear (2022) - S03E01 - Tomorrow.mkv
/media/Movies/Dune Part Two (2024)/Dune Part Two (2024).mkv
```

Season folders are created when they are missing, subtitles travel with their
video, and samples and trailers are left behind.

### It reads your library first

Under **Settings → TV / Movies**, *Analyse* scans the folder you point it at and
proposes naming that matches what is already there — whether seasons are
`Season 01`, `Season 1` or `S01`, and whether folders carry the year. If your
library says `The Bear/Season 1`, tvarr keeps writing `The Bear/Season 1`
rather than imposing its own defaults on a library you have already curated.
*Use these conventions* fills the templates in; you can then edit them freely
with a live preview.

Tokens: `{title}` `{year}` `{season}` `{season:00}` `{episode}` `{episode:00}`
`{episodeTitle}` `{quality}` `{group}`. A token with no value disappears along
with any brackets around it, and `{episode}` renders `E01-E02` for a
double-length episode.

### How files are placed

| Mode | Effect |
|---|---|
| **Hardlink** (default) | No extra disk space, and the torrent keeps seeding. Falls back to a copy across filesystems. |
| **Copy** | Seeding continues; the space is used twice. |
| **Move** | Frees the space at once, but seeding stops. |

The safety rules, since this is the only part of tvarr that touches files it
did not create:

- **Nothing is ever overwritten.** A second copy lands as `… (1).mkv`.
- **Nothing is deleted** unless you chose *move*.
- Destinations are checked to be inside the library folder, so no release name
  can write somewhere else.
- Files that match nothing you follow are left exactly where they are.

### Retiring torrents after they have seeded

Once a torrent has seeded for long enough — **N days, or a ratio, whichever
comes first** (or both, if you prefer) — tvarr removes it from Transmission and
clears the download folder. Your library copy stays.

Worth being precise about what this frees, because it depends on the mode:

| Mode | What retiring does |
|---|---|
| **Hardlink** | Frees **nothing** — the download and the library file are already the same data on disk. It ends seeding and clears the download folder. |
| Hardlink that fell back to a copy | Frees the duplicate, which is real space. |
| **Copy** | Frees the duplicate. |
| **Move** | The download is long gone; this just clears the dead torrent out of Transmission. |

So with hardlinks this is about meeting a tracker's seeding rule and keeping
the download folder tidy, not about disk space — you were never paying twice.

Two guards, since this deletes things:

- **Only torrents tvarr imported are ever touched.** Anything you added to
  Transmission yourself is invisible to it.
- **The library copy is confirmed present first.** If the file was moved or
  deleted out of the library, the download is left alone and the reason is
  logged, rather than leaving you with no copy at all.

### Why didn't something import?

```bash
pnpm run doctor                      # config check, then every download explained
pnpm run doctor --now                # ...and run a scan right away
pnpm run doctor --retry "Ted Lasso"   # forget a record so it is tried again
```

It prints whether importing is on, whether each library folder is set and
writable, whether Transmission answers — then, for every finished download,
either where it was filed or where it *would* go right now. Anything unfinished
is re-planned live rather than reported from the ledger, because an old verdict
often predates the setting that has since been fixed.

A download that was skipped for a fixable reason — the library folder was not
set yet, the file was still being written — is retried automatically on later
scans, up to five attempts. Only a deliberate decision (filed, or adopted as
pre-existing) is final.

### Transmission

Turn on **Settings → Import → Transmission** and tvarr asks Transmission which
downloads have finished, then files them. Nothing changes on the Transmission
side beyond having remote access switched on — `localhost:9091` is enough, and
tvarr fills in the rest of the RPC URL.

If Transmission runs in a container or on another machine, its idea of the
filesystem differs from yours; the **path mapping** fields translate (e.g.
`/downloads` → `/mnt/nas/downloads`). A failed import says exactly which path
could not be reached.

Connecting to a client with years of history does not suddenly file years of
downloads: existing completed torrents are noted and left alone unless you ask
for them.

Without a torrent client, set a **watch folder** instead and anything that
appears there is filed.

## Plex

If you already have a Plex server, point tvarr at it under **Settings → Plex**
and everything Plex holds is crossed off, so the watcher never downloads a
second copy. Add a show you already own eight seasons of and only the missing
episodes stay wanted.

You need the server address (`http://192.168.1.10:32400`) and an
`X-Plex-Token`. The settings screen walks you through two ways of getting one —
pick whichever suits you:

- **Plex web app** — open any item → **⋯** → **Get Info** → **View XML**, then
  copy the `X-Plex-Token=…` from the address bar of the tab that opens.
- **Server config file** — read `PlexOnlineToken` out of `Preferences.xml`
  directly on the machine running Plex, which is easier on a headless box. The
  settings screen gives you a copyable one-liner for Linux, Docker, macOS and
  Windows.

Plain `http` on a LAN avoids certificate trouble. **Test connection** confirms
both the address and the token in one go.

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
- Download folders are whatever you configure. `.torrent` files are written
  directly into that folder, never a subfolder — torrent clients watch a single
  directory and do not descend into it.
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
- **Sport** schedules come from ESPN's public site API — no key, no account.

## Commands

```bash
pnpm dev          # web interface (development), port 4000
pnpm build        # production build
pnpm start        # production web interface, port 4000
pnpm watch        # the watcher
pnpm watch:dev    # the watcher, restarting on file changes

pnpm run update   # pull, install, build, restart the services
pnpm run service:install|status|logs|restart|start|stop|print|uninstall

pnpm run doctor   # explain why a download did or did not import
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
- Sport is limited to the competitions in the catalogue. Following one tvarr
  cannot read the release names of would mean matching nothing, so the list is
  fixed rather than open-ended. MotoGP is missing because ESPN does not
  publish it.
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
