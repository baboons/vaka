import { notFound } from "next/navigation";
import { RefreshCw, Search, Trash2 } from "lucide-react";

import { removeFromLibrary, requestRefresh, requestSearch, setMediaMonitored, setMovieState } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { Pill, SectionTitle } from "@/components/bits";
import { ConfirmAction } from "@/components/confirm-action";
import { MediaSettingsForm } from "@/components/media-settings-form";
import { MonitorSwitch } from "@/components/monitor-switch";
import { Poster } from "@/components/poster";
import { RelativeTime } from "@/components/relative-time";
import { ReleaseList } from "@/components/release-list";
import { SeasonList } from "@/components/season-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDb } from "@/lib/core/db";
import { listCachedReleases } from "@/lib/core/engine";
import * as repo from "@/lib/core/repo";
import { getConfig } from "@/lib/core/settings";
import { resolveTargetDir } from "@/lib/core/grab";

export const dynamic = "force-dynamic";

export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mediaId = Number(id);
  if (!Number.isFinite(mediaId)) notFound();

  const db = getDb();
  const media = repo.getMedia(mediaId, db);
  if (!media) notFound();

  const config = getConfig(db);
  const kindConfig = media.kind === "tv" ? config.tv : config.movies;
  const episodes = media.kind === "tv" ? repo.listEpisodes(media.id, db) : [];
  const counts = media.kind === "tv" ? repo.countEpisodes(media.id, db) : null;
  const releases = listCachedReleases(media.id, db);
  const history = repo.listHistory({ mediaId: media.id, limit: 30 }, db);
  const destination = resolveTargetDir(media, kindConfig);

  return (
    <>
      <AutoRefresh intervalMs={25_000} />

      <header className="grid-texture border-b border-border">
        <div className="flex flex-col gap-6 px-5 py-6 md:flex-row md:px-8 md:py-8">
          <div className="w-[128px] shrink-0 md:w-[168px]">
            <Poster
              src={media.poster}
              alt={media.title}
              kind={media.kind}
              sizes="168px"
              priority
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="label-mono mb-2">
              {media.kind === "tv" ? "TV show" : "Movie"}
              {media.network && ` · ${media.network}`}
            </p>

            <h1 className="text-[26px] font-bold leading-none tracking-[-0.025em] md:text-[34px]">
              {media.title}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {media.year && <Pill>{media.year}</Pill>}
              {media.status && (
                <Pill tone={media.status.toLowerCase() === "running" ? "online" : "neutral"}>
                  {media.status}
                </Pill>
              )}
              {media.runtime && <Pill>{media.runtime} min</Pill>}
              {media.genres.slice(0, 3).map((genre) => (
                <Pill key={genre}>{genre}</Pill>
              ))}
              {counts && (
                <Pill tone={counts.wanted > 0 ? "signal" : "online"}>
                  {counts.have}/{counts.total} episodes
                </Pill>
              )}
              {media.kind === "movie" && (
                <Pill
                  tone={
                    media.state === "grabbed" || media.state === "done"
                      ? "online"
                      : media.state === "ignored"
                        ? "neutral"
                        : "signal"
                  }
                >
                  {media.state === "grabbed" || media.state === "done"
                    ? (media.grabbedQuality ?? "downloaded")
                    : media.state}
                </Pill>
              )}
            </div>

            {media.overview && (
              <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
                {media.overview}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2.5 rounded-sm border border-border bg-secondary/40 px-3 py-1.5">
                <MonitorSwitch
                  checked={media.monitored}
                  label="Watch this title"
                  action={setMediaMonitored.bind(null, media.id)}
                />
                <span className="text-[12.5px] font-medium">
                  {media.monitored ? "Watching" : "Paused"}
                </span>
              </label>

              <ActionButton
                action={requestSearch.bind(null, media.id)}
                icon={<Search className="size-3.5" />}
                variant="secondary"
                size="sm"
              >
                Search now
              </ActionButton>

              <ActionButton
                action={requestRefresh.bind(null, media.id)}
                icon={<RefreshCw className="size-3.5" />}
                variant="ghost"
                size="sm"
              >
                Refresh info
              </ActionButton>

              {media.kind === "movie" && media.state !== "wanted" && (
                <ActionButton
                  action={setMovieState.bind(null, media.id, "wanted")}
                  variant="ghost"
                  size="sm"
                >
                  Want again
                </ActionButton>
              )}

              <ConfirmAction
                action={removeFromLibrary.bind(null, media.id)}
                title={`Remove ${media.title}?`}
                description="This removes it from your library and stops the watcher looking for it. Files already downloaded are left alone."
                confirmLabel="Remove"
                redirectTo={media.kind === "tv" ? "/tv" : "/movies"}
              >
                <Trash2 className="size-3.5" />
                Remove
              </ConfirmAction>
            </div>

            <p className="mono mt-4 text-[11px] text-muted-foreground">
              Downloads to <span className="text-foreground/70">{destination}</span>
            </p>
          </div>
        </div>
      </header>

      <div className="px-5 py-6 md:px-8 md:py-8">
        <Tabs defaultValue={media.kind === "tv" ? "episodes" : "releases"}>
          <TabsList>
            {media.kind === "tv" && <TabsTrigger value="episodes">Episodes</TabsTrigger>}
            <TabsTrigger value="releases">
              Releases
              {releases.length > 0 && (
                <span className="mono ml-1.5 text-[10px] text-muted-foreground">
                  {releases.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="quality">Quality</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {media.kind === "tv" && (
            <TabsContent value="episodes" className="mt-5">
              <SeasonList mediaId={media.id} episodes={episodes} />
            </TabsContent>
          )}

          <TabsContent value="releases" className="mt-5">
            <SectionTitle>Seen in your feeds</SectionTitle>
            <ReleaseList releases={releases} mediaId={media.id} />
          </TabsContent>

          <TabsContent value="quality" className="mt-5">
            <div className="panel p-5">
              <MediaSettingsForm media={media} />
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-5">
            {history.length === 0 ? (
              <p className="panel px-4 py-6 text-center text-[13px] text-muted-foreground">
                Nothing has happened for this title yet.
              </p>
            ) : (
              <ul className="panel divide-y divide-border">
                {history.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 px-4 py-2.5">
                    <Pill
                      tone={
                        row.event === "grabbed"
                          ? "online"
                          : row.event === "error"
                            ? "alert"
                            : "neutral"
                      }
                    >
                      {row.event}
                    </Pill>
                    <div className="min-w-0 flex-1">
                      <p className="mono truncate text-[11.5px] text-foreground/85">
                        {row.title}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{row.reason}</p>
                      {row.path && (
                        <p className="mono mt-0.5 truncate text-[10.5px] text-muted-foreground/70">
                          {row.path}
                        </p>
                      )}
                    </div>
                    <span className="mono shrink-0 text-[10.5px] text-muted-foreground">
                      <RelativeTime value={row.createdAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
