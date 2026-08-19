# Filing downloads into your library

[← back to the README](../README.md)

vaka can take finished downloads and put them where Plex expects them:

```
/media/TV/The Bear (2022)/Season 03/The Bear (2022) - S03E01 - Tomorrow.mkv
/media/Movies/Dune Part Two (2024)/Dune Part Two (2024).mkv
/media/Sports/UFC/2026/UFC - 2026-08-15 - UFC 330 Makhachev vs Garry.mkv
```

Season folders are created when missing, subtitles travel with their video, and
samples and trailers are left behind.

Turn it on under **Settings → Import**, and set a library folder for each of
TV, Movies and Sports. While a library folder is empty, downloads for that
library are grabbed but never filed.

## It reads your library first

**Analyse** (under each library's settings) scans the folder you point it at and
proposes naming that matches what is already there — `Season 01`, `Season 1` or
`S01`, with or without the year — rather than imposing defaults on a library you
have curated. *Use these conventions* fills the templates in; you can then edit
them freely with a live preview.

Tokens: `{title}` `{year}` `{season}` `{season:00}` `{episode}` `{episode:00}`
`{episodeTitle}` `{airDate}` `{quality}` `{group}`. A token with no value
disappears along with any brackets around it.

## Modes

| Mode | Effect |
|---|---|
| **Hardlink** (default) | No extra disk space, torrent keeps seeding. Falls back to a copy across filesystems. |
| **Copy** | Seeding continues; space is used twice. |
| **Move** | Frees space at once, but seeding stops. |

This is the only part of vaka that touches files it did not create, so the
rules are conservative:

- **Nothing is overwritten.** A second copy lands as `… (1).mkv`.
- **Nothing is deleted** unless you chose *move*.
- Destinations are checked to be inside the library folder, so no release name
  can write somewhere else.
- Files matching nothing you follow are left exactly where they are.

## Retiring torrents after they have seeded

Once a torrent has seeded for **N days or to a ratio** (whichever comes first,
or both), vaka removes it from Transmission and clears the download folder.
Your library copy stays.

What that frees depends on the mode:

| Mode | What retiring does |
|---|---|
| **Hardlink** | Frees **nothing** — the download and the library file are already the same data. Ends seeding, tidies the folder. |
| Hardlink that fell back to a copy | Frees the duplicate. |
| **Copy** | Frees the duplicate. |
| **Move** | The download is long gone; this clears the dead torrent out of Transmission. |

Two guards, since this deletes things:

- **Only torrents vaka imported are ever touched.** Anything you added to
  Transmission yourself is invisible to it.
- **The library copy is confirmed present first.** If the file was moved or
  deleted out of the library, the download is left alone and the reason logged.

## Transmission

Turn on **Settings → Import → Transmission** and vaka asks which downloads have
finished, then files them. `localhost:9091` is enough — vaka fills in the rest
of the RPC URL. Nothing changes on the Transmission side beyond having remote
access switched on.

If Transmission runs in a container or on another host, the **path mapping**
fields translate its view of the filesystem to yours (`/downloads` →
`/mnt/nas/downloads`). A failed import says exactly which path could not be
reached.

Connecting a client with years of history does not file years of downloads —
existing completed torrents are noted and left alone unless you ask for them.

Without a torrent client, set a **watch folder** instead and anything that
appears there is filed.
