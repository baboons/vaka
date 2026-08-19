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

## Install

```bash
pnpm install
pnpm dev          # web interface on http://localhost:4000
pnpm watch        # the watcher, in a second terminal
```

Both are needed: the web interface only manages what to look for, and the
watcher is what actually polls and downloads.

To keep it running in the background instead, install it as a service:

```bash
pnpm build
pnpm run service:install
```

That supervises the watcher and the web interface separately, starts both at
login, and restarts them if they exit. See
**[running as a service](docs/service.md)** for managing and updating it —
including [upgrading from tvarr](docs/service.md#upgrading-from-tvarr).

Set `PORT` to use a different port: `PORT=8080 pnpm dev`.

## Getting started

1. **Settings → Feeds** — add your tracker's RSS URL. *Test without saving*
   checks it before you commit to it.
2. **Settings → TV / Movies / Sports** — set each download folder and the
   default quality. Point your torrent client's watch folder at the same paths.
3. **Add** — search for a show or film, or browse the sports catalogue, and
   choose the quality you want.

That is enough to start downloading. Newly followed titles are checked against
releases already cached from your feeds, so you do not have to wait for the
next poll.

Two things worth setting up once you are happy it works:

- **[Plex](docs/plex.md)** — crosses off everything you already own, so nothing
  is downloaded twice.
- **[Filing into your library](docs/library.md)** — renames finished downloads
  and moves them where Plex expects them.

## Documentation

| | |
|---|---|
| [How it works](docs/how-it-works.md) | The two processes, where data lives, metadata sources, limits. |
| [Feeds](docs/feeds.md) | Adding feeds, restricting them to one library, magnet-only trackers. |
| [Quality profiles](docs/quality-profiles.md) | What gets grabbed, upgrades, word filters, title matching. |
| [Sports](docs/sports.md) | Following competitions, team filters, and why it sometimes asks. |
| [Filing into your library](docs/library.md) | Naming, hardlinks, retiring seeded torrents, Transmission. |
| [Plex](docs/plex.md) | Connecting a server and crossing off what you own. |
| [Running as a service](docs/service.md) | Installing, updating, upgrading from tvarr. |

## Troubleshooting

### Something did not download

Open the title's **Releases** tab. It lists every cached release that resolved
to it, with the verdict — accepted, or rejected and why (`480p is not an
accepted quality`, `only 2 seeders`). If it is not listed at all, the feed never
carried it or the name did not match.

For that last case, add the name releases actually use under **Quality → Also
match these titles**. Matching is exact on a normalized title; fuzzy matching
grabs the wrong show often enough to be a liability.

For sport, a release can also be listed but *not* downloaded, because vaka was
not sure enough that it is the right event — see
[why it sometimes asks](docs/sports.md#why-it-sometimes-asks).

### Something did not import

```bash
pnpm run doctor                     # config check, then every download explained
pnpm run doctor --now               # ...and scan right away
pnpm run doctor --retry "Ted Lasso" # forget a record so it is tried again
```

`doctor` prints whether importing is on, whether each library folder is set and
writable, and whether Transmission answers — then, for every finished download,
either where it was filed or where it *would* go right now. It also flags
anything still carrying the old tvarr name.

Downloads skipped for a fixable reason — the library folder was not set yet,
the file was still being written — are retried automatically on later scans, up
to five attempts.

### Nothing is happening at all

Check the watcher is running: the sidebar says so, and
`pnpm run service:status` confirms it for an installed service. The web
interface never downloads anything on its own.

The **Activity** log shows every decision across everything, and rejections are
only recorded for titles you actually follow — the rest of the feed is ignored
silently.

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

## License

[MIT](LICENSE) © Johan
