# Feeds

[← back to the README](../README.md)

Standard RSS 2.0 and Torznab-style feeds both work. Vaka reads the download
link from `<link>`, `<enclosure>` or a magnet URI, and picks up size and seeder
counts where they are published.

Add feeds under **Settings → Feeds**. *Test without saving* fetches the feed
and reports what it found, so you can confirm the URL before committing to it.

## Restricting a feed to one library

Restrict a feed to **TV**, **movies** or **sport** to stop a film matching a
show of the same name — worth doing if you follow both *Fargo* the series and
*Fargo* the film.

## Magnet-only feeds

If a feed offers only a magnet link, Vaka writes a `.magnet` file containing
the URI. Not every client watches for those; turn it off in **Settings →
General** to skip magnet-only releases instead.

## Polling

The watcher polls every enabled feed on a schedule (15 minutes by default,
under **Settings → General**). Newly followed titles are checked against
releases already cached from earlier polls, so adding something does not mean
waiting for the next one.

A grab delay can be set if your tracker publishes releases before they are
properly seeded.
