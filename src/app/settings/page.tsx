import path from "node:path";

import {
  Clapperboard,
  FolderInput,
  Library,
  Rss,
  SlidersHorizontal,
  Terminal,
  Trophy,
  Tv,
} from "lucide-react";

import { PageHeader, Pill } from "@/components/bits";
import { FeedManager } from "@/components/feed-manager";
import { GeneralSettingsForm } from "@/components/general-settings-form";
import { ImportSettingsForm } from "@/components/import-settings-form";
import { LibraryNamingForm } from "@/components/library-naming-form";
import { LibrarySettingsForm } from "@/components/library-settings-form";
import { PlexSettingsForm } from "@/components/plex-settings-form";
import { RelativeTime } from "@/components/relative-time";
import { SportsSettingsForm } from "@/components/sports-settings-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dataDir, getDb } from "@/lib/core/db";
import * as repo from "@/lib/core/repo";
import {
  getConfig,
  getPlexState,
  getWorkerState,
  isWorkerOnline,
} from "@/lib/core/settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings — tvarr" };

export default function SettingsPage() {
  const db = getDb();
  const config = getConfig(db);
  const feeds = repo.listFeeds(false, db);
  const plexState = getPlexState(db);
  const recentImports = repo.listImports(20, db);
  const worker = getWorkerState(db);
  const online = isWorkerOnline(worker);

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="TV, movies and sports are configured separately — different folders, different quality targets."
      />

      <div className="px-5 py-6 md:px-8 md:py-8">
        <Tabs defaultValue="feeds">
          <TabsList>
            <TabsTrigger value="feeds">
              <Rss className="size-3.5" />
              Feeds
            </TabsTrigger>
            <TabsTrigger value="tv">
              <Tv className="size-3.5" />
              TV
            </TabsTrigger>
            <TabsTrigger value="movies">
              <Clapperboard className="size-3.5" />
              Movies
            </TabsTrigger>
            <TabsTrigger value="sports">
              <Trophy className="size-3.5" />
              Sports
            </TabsTrigger>
            <TabsTrigger value="import">
              <FolderInput className="size-3.5" />
              Import
            </TabsTrigger>
            <TabsTrigger value="plex">
              <Library className="size-3.5" />
              Plex
            </TabsTrigger>
            <TabsTrigger value="general">
              <SlidersHorizontal className="size-3.5" />
              General
            </TabsTrigger>
            <TabsTrigger value="watcher">
              <Terminal className="size-3.5" />
              Watcher
            </TabsTrigger>
          </TabsList>

          <div className="mt-5 max-w-3xl">
            <TabsContent value="feeds">
              <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
                The watcher polls every enabled feed on a schedule and compares each release
                against your library. Standard RSS and Torznab-style feeds both work; the
                download link may be a <span className="mono">.torrent</span> URL or a magnet.
              </p>
              <FeedManager feeds={feeds} />
            </TabsContent>

            <TabsContent value="tv" className="space-y-5">
              <div className="panel p-5">
                <LibrarySettingsForm kind="tv" initial={config.tv} />
              </div>
              <div className="panel p-5">
                <h3 className="mb-1 text-[14px] font-semibold">Where finished episodes go</h3>
                <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
                  Used when importing is on. Season folders are created as needed.
                </p>
                <LibraryNamingForm kind="tv" initial={config.tv} />
              </div>
            </TabsContent>

            <TabsContent value="movies" className="space-y-5">
              <div className="panel p-5">
                <LibrarySettingsForm kind="movie" initial={config.movies} />
              </div>
              <div className="panel p-5">
                <h3 className="mb-1 text-[14px] font-semibold">Where finished films go</h3>
                <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
                  Used when importing is on. Plex expects one folder per film.
                </p>
                <LibraryNamingForm kind="movie" initial={config.movies} />
              </div>
            </TabsContent>

            <TabsContent value="sports" className="space-y-5">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Competitions come from ESPN&rsquo;s public schedule — no key, no account. Because
                sports releases carry no episode number, tvarr scores each one against the
                calendar and only downloads the matches it is sure about; the rest wait under a
                competition&rsquo;s <span className="text-foreground/80">Releases</span> tab.
              </p>
              <div className="panel p-5">
                <SportsSettingsForm initial={config.sports} />
              </div>
              <div className="panel p-5">
                <h3 className="mb-1 text-[14px] font-semibold">Where finished events go</h3>
                <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
                  Used when importing is on. Events are grouped by competition and then by year.
                </p>
                <LibraryNamingForm kind="sport" initial={config.sports} />
              </div>
            </TabsContent>

            <TabsContent value="import">
              <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
                tvarr can file finished downloads into your Plex library — renaming them, and
                creating <span className="mono">Season 01</span> folders where they are missing.
                Set the destination and naming under <span className="text-foreground/80">TV</span>,{" "}
                <span className="text-foreground/80">Movies</span> and{" "}
                <span className="text-foreground/80">Sports</span>.
              </p>
              <div className="panel p-5">
                <ImportSettingsForm
                  initial={config.importing}
                  transmission={config.transmission}
                  recent={recentImports}
                />
              </div>
            </TabsContent>

            <TabsContent value="plex">
              <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
                Point tvarr at a Plex server and it will cross off everything you already have,
                so the watcher never downloads a second copy. Matching prefers IMDb, TVDB and
                TMDB ids, falling back to title and year.
              </p>
              <div className="panel p-5">
                <PlexSettingsForm initial={config.plex} state={plexState} />
              </div>
            </TabsContent>

            <TabsContent value="general">
              <div className="panel p-5">
                <GeneralSettingsForm initial={config.general} />
              </div>
            </TabsContent>

            <TabsContent value="watcher">
              <WatcherPanel online={online} worker={worker} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </>
  );
}

function WatcherPanel({
  online,
  worker,
}: {
  online: boolean;
  worker: ReturnType<typeof getWorkerState>;
}) {
  const dir = dataDir();

  return (
    <div className="space-y-5">
      <div className="panel p-5">
        <div className="flex items-center gap-2">
          <span className={online ? "text-online" : "text-alert"}>
            <span className="signal-dot" />
          </span>
          <h3 className="text-[15px] font-semibold">
            {online ? "The watcher is running" : "The watcher is not running"}
          </h3>
        </div>

        <dl className="mono mt-4 grid gap-2 text-[12px] sm:grid-cols-2">
          <Row label="Process id" value={worker.pid ? String(worker.pid) : "—"} />
          <Row
            label="Started"
            value={worker.startedAt ? <RelativeTime value={worker.startedAt} /> : "—"}
          />
          <Row
            label="Last feed check"
            value={worker.lastPollAt ? <RelativeTime value={worker.lastPollAt} /> : "—"}
          />
          <Row
            label="Next feed check"
            value={worker.nextPollAt ? <RelativeTime value={worker.nextPollAt} future /> : "—"}
          />
        </dl>

        {worker.lastError && (
          <p className="mt-3 rounded-sm border border-alert/30 bg-alert/5 px-3 py-2 text-[12px] text-alert">
            {worker.lastError}
          </p>
        )}
      </div>

      <div className="panel p-5">
        <h3 className="label-mono mb-3">Running it</h3>
        <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
          The watcher is a separate background process. It does the polling and downloading, so
          it must be running for anything to happen — this web interface only manages what it
          looks for.
        </p>

        <Command label="In a terminal" value="pnpm watch" />
        <Command
          label="Install as a service (macOS + Linux), running this interface too"
          value="pnpm run service:install"
        />
        <Command label="Update and restart everything" value="pnpm run update" />
        <Command label="Check on it" value="pnpm run service:status" />

        <div className="mt-4 space-y-1.5">
          <p className="label-mono">Data directory</p>
          <p className="mono text-[12px] text-foreground/80">{dir}</p>
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Holds <span className="mono">{path.basename(dir)}/tvarr.db</span> — your library,
            settings and history. Both the watcher and this interface read it, so they must run
            as the same user.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
      <dt className="label-mono">{label}</dt>
      <dd className="text-foreground/85">{value}</dd>
    </div>
  );
}

function Command({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2.5">
      <p className="label-mono mb-1 text-[9px]">{label}</p>
      <div className="flex items-center gap-2 rounded-sm border border-border bg-background px-3 py-2">
        <span className="mono text-signal">$</span>
        <code className="mono text-[12.5px] text-foreground/90">{value}</code>
        <Pill className="ml-auto">shell</Pill>
      </div>
    </div>
  );
}
