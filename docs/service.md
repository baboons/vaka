# Running as a service

[← back to the README](../README.md)

Installs user-level units — systemd on Linux, launchd on macOS — for the
watcher **and** the web interface, supervised separately so a crashed UI never
stops downloads.

```bash
pnpm build                    # the web service needs a production build
pnpm run service:install
```

Both start at login and restart if they exit. On Linux, to keep them running
while you are logged out:

```bash
sudo loginctl enable-linger $USER
```

## Managing them

```bash
pnpm run service:status
pnpm run service:logs
pnpm run service:restart
pnpm run service:stop
pnpm run service:start
pnpm run service:print        # show the unit files without installing
pnpm run service:uninstall
```

The port and data directory are baked into the units at install time, and read
back out when you reinstall — so re-running install (which `update` does) never
resets a custom `PORT` or `VAKA_DATA_DIR`.

## Updating

```bash
pnpm run update
```

In order: `git pull --ff-only` → `pnpm install` → `pnpm build` → reinstall the
units → restart both, so the interface comes back on freshly built code rather
than the old bundle.

It fast-forwards only, so it can never lose local commits, and refuses to run
with a dirty working tree. If nothing was pulled it stops early instead of
rebuilding. If the build fails it leaves the old version running rather than
restarting into a broken one.

- `--no-build` skips the web build, for watcher-only hosts.
- `--force` runs every step regardless.

Reinstalling the units on every update keeps the recorded `node` path correct
across Node upgrades — otherwise a service can end up pointing at a version
that no longer exists.

> Use `pnpm run update`. Plain `pnpm update` is pnpm's own dependency updater,
> which is a different thing entirely.

## Upgrading from tvarr

The app was called tvarr before it grew a sports library.

```bash
pnpm run doctor       # says what still carries the old name, and changes nothing
pnpm run update       # pulls, builds, and replaces the service units
```

`update` handles it end to end: it stops and removes the `tvarr-*` units,
installs `vaka-*`, and restarts. On startup the app moves `~/.tvarr` to
`~/.vaka` and renames the database.

Nothing is deleted. If something already exists at the new path the old folder
is left untouched, and `TVARR_DATA_DIR` keeps working, so a unit installed
under the old name does not break in the meantime.

`doctor` reports all of this *before* opening the database — opening it is what
performs the move — so you can see what will happen before it does. It stays
quiet once there is nothing left to do.

Do not `git pull` by hand first: `update` stops early when nothing new was
pulled, so you would skip the build and the unit swap. If you have already
pulled, use `pnpm run update --force`.
