# Plex

[← back to the README](../README.md)

Point Vaka at a Plex server under **Settings → Plex** and everything it holds is
crossed off, so the watcher never downloads a second copy. Add a show you
already own eight seasons of and only the missing episodes stay wanted.

## Connecting

You need the server address (`http://192.168.1.10:32400`) and an `X-Plex-Token`.
The settings screen walks you through two ways of getting a token — pick
whichever suits you:

- **Plex web app** — open any item → **⋯** → **Get Info** → **View XML**, then
  copy the `X-Plex-Token=…` from the address bar of the tab that opens.
- **Server config file** — read `PlexOnlineToken` out of `Preferences.xml` on
  the machine running Plex, which is easier on a headless box. The settings
  screen gives you a copyable one-liner for Linux, Docker, macOS and Windows.

Plain `http` on a LAN avoids certificate trouble. **Test connection** confirms
both the address and the token in one go.

## What it does

Matching prefers IMDb, TVDB and TMDB ids and falls back to title and year, so
libraries built by older Plex agents still match. The scan runs hourly by
default, immediately when you enable it, and once more whenever you add a
title — before the first feed search, so a back catalogue you own is never
queued.

Two things worth knowing:

- **It is strictly read-only.** Vaka asks what is on the shelves and nothing
  more; it never writes to Plex.
- **It only ever marks things as had, never as wanted again.** If Plex is
  offline, mid-scan or missing a drive, the worst case is that nothing new gets
  crossed off — not a wave of re-downloads. If you delete something from Plex
  and want it back, mark it wanted in Vaka.

Episodes crossed off this way show as `1080p · Plex`, and with **upgrade**
enabled in the quality profile a better release will still replace them.

Competitions are not matched against Plex — it has no notion of a followed
league.
