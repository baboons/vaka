import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  Download,
  Rss,
  Settings2,
} from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PageHeader, Pill, SectionTitle, Stat } from "@/components/bits";
import { DiscoverSection } from "@/components/discover-section";
import { Poster } from "@/components/poster";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/core/db";
import { getDiscoverData, hasMovieCalendar } from "@/lib/core/discover";
import { pad } from "@/lib/core/engine";
import * as repo from "@/lib/core/repo";
import { getConfig } from "@/lib/core/settings";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const db = getDb();
  const config = getConfig(db);

  const shows = repo.listMedia({ kind: "tv" }, db);
  const movies = repo.listMedia({ kind: "movie" }, db);
  const feeds = repo.listFeeds(false, db);
  const upcoming = repo.listUpcoming(14, db);
  const history = repo.listHistory({ limit: 12 }, db);

  const grabbedThisWeek = repo.countRecentGrabs(7, db);

  const wantedEpisodes = shows.reduce(
    (total, show) => total + repo.countEpisodes(show.id, db).wanted,
    0,
  );
  const wantedMovies = movies.filter(
    (movie) => movie.monitored && movie.state === "wanted",
  ).length;

  const brokenFeeds = feeds.filter((feed) => feed.enabled && feed.lastStatus === "error");
  const needsSetup = feeds.length === 0 || shows.length + movies.length === 0;

  return (
    <>
      <AutoRefresh intervalMs={20_000} />

      <PageHeader
        eyebrow="Overview"
        title="Control room"
        description="What the watcher is looking for, and what it has found."
      />

      <div className="space-y-10 px-5 py-6 md:px-8 md:py-8">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Shows followed" value={shows.filter((s) => s.monitored).length} />
          <Stat label="Movies wanted" value={wantedMovies} tone={wantedMovies ? "signal" : undefined} />
          <Stat
            label="Episodes wanted"
            value={wantedEpisodes}
            tone={wantedEpisodes ? "signal" : undefined}
          />
          <Stat label="Grabbed this week" value={grabbedThisWeek} tone="online" />
        </section>

        {needsSetup && <SetupChecklist hasFeeds={feeds.length > 0} hasLibrary={shows.length + movies.length > 0} />}

        {brokenFeeds.length > 0 && (
          <div className="panel border-alert/40 bg-alert/5 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-alert" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-alert">
                  {brokenFeeds.length} feed{brokenFeeds.length === 1 ? "" : "s"} failing
                </p>
                {brokenFeeds.map((feed) => (
                  <p key={feed.id} className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    <span className="text-foreground/80">{feed.name}</span> — {feed.lastError}
                  </p>
                ))}
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link href="/settings">Fix</Link>
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
          <section>
            <SectionTitle
              action={
                <span className="mono text-[11px] text-muted-foreground">next 14 days</span>
              }
            >
              Airing soon
            </SectionTitle>

            {upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="size-6" />}
                title="Nothing scheduled"
                description="Episodes appear here once a show you follow has announced air dates."
              />
            ) : (
              <ul className="panel divide-y divide-border">
                {upcoming.slice(0, 9).map((episode) => (
                  <li key={episode.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-9 shrink-0">
                      <Poster
                        src={episode.poster}
                        alt={episode.mediaTitle}
                        kind="tv"
                        sizes="36px"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium leading-tight">
                        {episode.mediaTitle}
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                        <span className="mono text-foreground/70">
                          S{pad(episode.season)}E{pad(episode.number)}
                        </span>
                        {episode.title && ` · ${episode.title}`}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="mono text-[11.5px] text-foreground/80">
                        <RelativeTime value={episode.airDate} future />
                      </p>
                      {!episode.monitored && (
                        <p className="label-mono mt-0.5 text-[9px]">ignored</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle
              action={
                <Link
                  href="/activity"
                  className="mono flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-signal"
                >
                  All activity <ArrowRight className="size-3" />
                </Link>
              }
            >
              Latest activity
            </SectionTitle>

            {history.length === 0 ? (
              <EmptyState
                icon={<Download className="size-6" />}
                title="Nothing yet"
                description="Grabs and rejections show up here as the watcher works through your feeds."
              />
            ) : (
              <ul className="panel divide-y divide-border">
                {history.slice(0, 9).map((row) => (
                  <li key={row.id} className="flex items-start gap-2.5 px-3 py-2.5">
                    <EventDot event={row.event} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] leading-tight text-foreground/90">
                        {row.title ?? row.mediaTitle ?? "—"}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {row.reason}
                      </p>
                    </div>
                    <span className="mono shrink-0 text-[10.5px] text-muted-foreground">
                      <RelativeTime value={row.createdAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/*
          Streamed: the first render after a cache expiry fetches from TVmaze
          and Cinemeta, and the rest of the dashboard should not wait for it.
        */}
        <Suspense fallback={<DiscoverSkeleton />}>
          <Discover />
        </Suspense>

        <section className="grid gap-3 sm:grid-cols-2">
          <FolderCard label="TV downloads" path={config.tv.downloadDir} />
          <FolderCard label="Movie downloads" path={config.movies.downloadDir} />
        </section>
      </div>
    </>
  );
}

/** Popular and upcoming titles you are not already following. */
async function Discover() {
  const db = getDb();
  const config = getConfig(db);
  const data = await getDiscoverData(db);

  return (
    <DiscoverSection
      popular={data.popular}
      upcoming={data.upcoming}
      tvQuality={config.tv.quality}
      movieQuality={config.movies.quality}
      hasMovieCalendar={hasMovieCalendar(db)}
    />
  );
}

function DiscoverSkeleton() {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label-mono text-foreground/70">Discover</h2>
      </div>
      <div className="space-y-5">
        {[0, 1].map((row) => (
          <div key={row}>
            <div className="mb-2.5 h-3 w-24 rounded bg-secondary/60" />
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="w-[132px] shrink-0 animate-pulse">
                  <div className="poster-frame mb-2" />
                  <div className="h-3 w-full rounded bg-secondary/60" />
                  <div className="mt-1.5 h-2.5 w-12 rounded bg-secondary/40" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EventDot({ event }: { event: string }) {
  const tone =
    event === "grabbed"
      ? "bg-online"
      : event === "error"
        ? "bg-alert"
        : event === "rejected"
          ? "bg-muted-foreground/50"
          : "bg-info";
  return <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone}`} />;
}

function FolderCard({ label, path }: { label: string; path: string }) {
  return (
    <div className="panel flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="label-mono">{label}</p>
        <p className="mono mt-1 truncate text-[12px] text-foreground/80">{path}</p>
      </div>
      <Button asChild size="sm" variant="ghost">
        <Link href="/settings">
          <Settings2 className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}

function SetupChecklist({
  hasFeeds,
  hasLibrary,
}: {
  hasFeeds: boolean;
  hasLibrary: boolean;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="grid-texture border-b border-border px-4 py-3">
        <p className="label-mono text-foreground/70">Getting started</p>
      </div>
      <ol className="divide-y divide-border">
        <ChecklistItem
          done={hasFeeds}
          title="Add your torrent RSS feed"
          description="The watcher polls it for new releases. Separate feeds can be limited to TV or movies."
          href="/settings"
          cta="Open settings"
          icon={<Rss className="size-4" />}
        />
        <ChecklistItem
          done={hasLibrary}
          title="Follow a show or add a movie"
          description="Pick the quality you want for each one, or use the per-library defaults."
          href="/add"
          cta="Search"
          icon={<Download className="size-4" />}
        />
      </ol>
    </section>
  );
}

function ChecklistItem({
  done,
  title,
  description,
  href,
  cta,
  icon,
}: {
  done: boolean;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3.5 px-4 py-3.5">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-sm border ${
          done
            ? "border-online/40 bg-online/10 text-online"
            : "border-signal/40 bg-signal/10 text-signal"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13.5px] font-medium">
          {title}
          {done && <Pill tone="online">done</Pill>}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{description}</p>
      </div>
      {!done && (
        <Button asChild size="sm" variant="secondary">
          <Link href={href}>{cta}</Link>
        </Button>
      )}
    </li>
  );
}
