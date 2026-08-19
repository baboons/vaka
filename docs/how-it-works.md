# How it works

[← back to the README](../README.md)

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

## Where things go

- `~/.vaka/vaka.db` — library, settings, history. Override with `VAKA_DATA_DIR`;
  both processes must agree on it.
- Download folders are whatever you configure. Any title can override its own
  under **Quality → Download folder override**.

## Metadata

| | |
|---|---|
| **TV** | [TVmaze](https://www.tvmaze.com/api) — no key, full episode lists and air dates. |
| **Movies** | Cinemeta, IMDb-backed, no key. Add a TMDB key in **Settings → General** for richer data. |
| **Sport** | ESPN's public schedule — no key, no account. |

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
