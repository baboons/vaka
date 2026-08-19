<p align="center">
  <img src="public/logo.svg" width="96" height="96" alt="">
</p>

<h1 align="center">vaka</h1>

<p align="center">
  Follow TV shows, movies and sport. vaka watches your torrent RSS feeds and
  downloads the qualities you asked for.
</p>

---

Pick something to follow and choose a quality. A background watcher polls your
feeds, and when a matching release appears it writes the `.torrent` into a
folder your torrent client is watching. Optionally, it then files the finished
download into your Plex library.

Each library — TV, movies, sport — has its own download folder and its own
quality profile.

## Quick start

```bash
pnpm install
pnpm dev          # web interface on http://localhost:4000
pnpm watch        # the watcher, in a second terminal
```

Then:

1. **Settings → Feeds** — add your tracker's RSS URL. *Test without saving*
   checks it first.
2. **Settings → TV / Movies / Sports** — set each download folder and default
   quality. Point your torrent client's watch folder at the same paths.
3. **Add** — search for a show or film, or browse the sports catalogue.

Newly followed titles are checked against releases already cached from your
feeds, so you do not have to wait for the next poll.

## How it works

Two processes share one SQLite database:

| | |
|---|---|
| **Web interface** (`pnpm dev` / `pnpm start`) | Search, follow, configure. Never downloads anything. |
| **Watcher** (`pnpm watch`) | Polls feeds, matches releases, writes `.torrent` files. |

The watcher must be running for anything to download. The UI queues work for it
through a job table, so you can also run the watcher headless and never open
the UI.

vaka never talks to your torrent client to download. It drops files into a
**blackhole folder** — every client can watch a directory, and no credentials
are involved. Files go directly in that folder, never a subfolder, because
clients do not descend into them.

## Running as a service

Installs user-level units (systemd on Linux, launchd on macOS) for both the
watcher and the web interface, so a crashed UI never stops downloads.

```bash
pnpm build
pnpm run service:install
pnpm run service:status
pnpm run service:logs
```

Both start at login and restart if they exit. On Linux, to keep them running
while logged out: `sudo loginctl enable-linger $USER`.

### Updating

```bash
pnpm run update   # pull → install → build → restart both services
```

Fast-forward only, refuses to run on a dirty tree, and stops early if nothing
was pulled. If the build fails it leaves the old version running. `--no-build`
skips the web build on watcher-only hosts.

> Use `pnpm run update`. Plain `pnpm update` is pnpm's dependency updater — a
> different thing entirely.

## Feeds

Standard RSS 2.0 and Torznab-style feeds both work. vaka reads the download
link from `<link>`, `<enclosure>` or a magnet URI, and picks up size and seeder
counts where they are published.

Restrict a feed to **TV**, **movies** or **sport** to stop a film matching a
show of the same name — worth doing if you follow both *Fargo* the series and
*Fargo* the film.

If a feed offers only a magnet link, vaka writes a `.magnet` file. Not every
client watches for those; turn it off in **Settings → General** to skip
magnet-only releases instead.

## Quality profiles

Every title gets its own copy of a profile when you add it, seeded from the
per-library default. Changing the default later does not disturb what you
already follow — edit a title under its **Quality** tab.

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

## Sports

You follow a **competition** — UFC, the Premier League, the NHL, Formula 1 —
and vaka pulls its calendar from ESPN's public schedule, then watches your
feeds for each event.

- **Teams.** A Premier League season is 380 fixtures; an NHL season is over
  1,300. The filter is applied when the calendar is fetched, so only your
  fixtures are stored.
- **Parts of an event.** Main card, prelims, race, qualifying, and so on. A
  fight night is posted five or six times over, and the highlight reel is not
  the fight.

### Why it sometimes asks

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

Switch on **Download uncertain matches too** if you would rather have the best
guess than be asked. It is off by default: downloading the wrong game is worse
than downloading nothing.

## Filing downloads into your library

vaka can put finished downloads where Plex expects them:

```
/media/TV/The Bear (2022)/Season 03/The Bear (2022) - S03E01 - Tomorrow.mkv
/media/Movies/Dune Part Two (2024)/Dune Part Two (2024).mkv
/media/Sports/UFC/2026/UFC - 2026-08-15 - UFC 330 Makhachev vs Garry.mkv
```

Season folders are created when missing, subtitles travel with their video, and
samples and trailers are left behind.

**Analyse** (under each library's settings) scans the folder you point it at and
proposes naming that matches what is already there — `Season 01`, `Season 1` or
`S01`, with or without the year — rather than imposing defaults on a library you
have curated. You can then edit the templates freely with a live preview.

Tokens: `{title}` `{year}` `{season}` `{season:00}` `{episode}` `{episode:00}`
`{episodeTitle}` `{airDate}` `{quality}` `{group}`.

### Modes

| Mode | Effect |
|---|---|
| **Hardlink** (default) | No extra disk space, torrent keeps seeding. Falls back to a copy across filesystems. |
| **Copy** | Seeding continues; space is used twice. |
| **Move** | Frees space at once, but seeding stops. |

This is the only part of vaka that touches files it did not create, so:
nothing is overwritten (a second copy lands as `… (1).mkv`), nothing is deleted
unless you chose *move*, destinations are checked to be inside the library
folder, and files matching nothing you follow are left alone.

### Retiring torrents

Once a torrent has seeded for **N days or to a ratio** (whichever comes first,
or both), vaka removes it from Transmission and clears the download folder.
Your library copy stays.

With **hardlinks this frees no space** — the download and the library file are
already the same data. It ends seeding and tidies the download folder. It does
free space when the mode was *copy*, or when a hardlink fell back to one.

Two guards: only torrents vaka imported are ever touched, and the library copy
is confirmed present first.

### Transmission

Turn on **Settings → Import → Transmission** and vaka asks which downloads have
finished, then files them. `localhost:9091` is enough. If Transmission runs in
a container or on another host, the **path mapping** fields translate its view
of the filesystem to yours (`/downloads` → `/mnt/nas/downloads`).

Connecting a client with years of history does not file years of downloads —
existing completed torrents are noted and left alone.

Without a torrent client, set a **watch folder** instead.

## Plex

Point vaka at a Plex server under **Settings → Plex** and everything it holds is
crossed off, so the watcher never downloads a second copy.

You need the server address (`http://192.168.1.10:32400`) and an `X-Plex-Token`;
the settings screen walks you through two ways of getting one. **Test
connection** checks both at once.

It is strictly read-only, and only ever marks things as *had*, never as wanted
again — if Plex is offline or mid-scan, the worst case is that nothing new gets
crossed off, not a wave of re-downloads.

## Troubleshooting

**Something did not download.** Open the title's **Releases** tab. It lists
every cached release that resolved to it, with the verdict — accepted, or
rejected and why (`480p is not an accepted quality`, `only 2 seeders`). If it is
not listed at all, the feed never carried it or the name did not match.

For that last case, add the name releases actually use under **Quality → Also
match these titles**. Matching is exact on a normalized title; fuzzy matching
grabs the wrong show often enough to be a liability.

**Something did not import.**

```bash
pnpm run doctor                     # config check, then every download explained
pnpm run doctor --now               # ...and scan right away
pnpm run doctor --retry "Ted Lasso" # forget a record so it is tried again
```

Downloads skipped for a fixable reason are retried automatically on later scans,
up to five attempts.

The **Activity** log shows every decision across everything.

## Metadata

| | |
|---|---|
| **TV** | [TVmaze](https://www.tvmaze.com/api) — no key, full episode lists and air dates. |
| **Movies** | Cinemeta, IMDb-backed, no key. Add a TMDB key in **Settings → General** for richer data. |
| **Sport** | ESPN's public schedule — no key, no account. |

## Commands

```bash
pnpm dev          # web interface (development), port 4000
pnpm build        # production build
pnpm start        # production web interface, port 4000
pnpm watch        # the watcher
pnpm watch:dev    # the watcher, restarting on file changes

pnpm run update   # pull, install, build, restart the services
pnpm run service:install|status|logs|restart|start|stop|print|uninstall

pnpm run doctor   # config check, rename check, and every download explained
pnpm test         # unit tests + an end-to-end grab test
pnpm typecheck
pnpm lint
```

Set `PORT` to use a different port: `PORT=8080 pnpm dev`.

## Where things go

- `~/.vaka/vaka.db` — library, settings, history. Override with `VAKA_DATA_DIR`;
  both processes must agree on it.
- Download folders are whatever you configure. Any title can override its own
  under **Quality → Download folder override**.

### Upgrading from tvarr

```bash
pnpm run doctor       # says what still carries the old name, and changes nothing
pnpm run update       # pulls, builds, and replaces the service units
```

The first run moves `~/.tvarr` to `~/.vaka` and renames the database. Nothing
is deleted; if something already exists at the new path the old folder is left
untouched. `TVARR_DATA_DIR` keeps working, so a service unit installed under
the old name does not break in the meantime.

`doctor` reports this before opening the database, so you can see what will
happen before it does. It stays quiet once there is nothing left to do.

## Limits

- The watcher refuses to start if another instance is running, so a stray copy
  cannot double-grab. `pnpm watch --force` overrides.
- Anime absolute numbering (`Show - 137`) is not matched. Season/episode,
  `1x02`, dated daily shows and multi-episode files are.
- Sport is limited to the competitions in the catalogue — following one whose
  release names vaka cannot read would match nothing. MotoGP is absent because
  ESPN does not publish it.
- There is no authentication. Keep it on your LAN, or put it behind something
  that does auth.
- Opening the **dev** server from another machine needs that origin allowlisted
  or Next returns 403 for every chunk. LAN addresses are allowlisted
  automatically; add hostnames with `VAKA_DEV_ORIGINS=vaka.local,box.lan`.
  Production is unaffected.
- vaka only downloads the `.torrent`. Seeding and unpacking are your torrent
  client's job.

## License

[MIT](LICENSE) © Johan
