import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check } from "lucide-react";

import { AddDialog } from "@/components/add-dialog";
import { Pill } from "@/components/bits";
import { Poster } from "@/components/poster";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/core/db";
import { findTracked, getPreview } from "@/lib/core/discover";
import * as repo from "@/lib/core/repo";
import { getConfig } from "@/lib/core/settings";
import type { MediaKind } from "@/lib/core/types";

export const dynamic = "force-dynamic";

/**
 * Details for something you do not follow yet.
 *
 * The library has its own page; this one exists so a poster in Discover or in
 * search results leads somewhere useful before you commit to following it.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ kind: string; provider: string; id: string }>;
}) {
  const { kind: rawKind, provider, id } = await params;
  if (rawKind !== "tv" && rawKind !== "movie") notFound();
  const kind = rawKind as MediaKind;

  const db = getDb();
  const config = getConfig(db);

  let details;
  try {
    details = await getPreview(kind, provider, decodeURIComponent(id), db);
  } catch (error) {
    return (
      <Failure
        kind={kind}
        message={error instanceof Error ? error.message : "Could not load this title"}
      />
    );
  }

  const tracked = findTracked(details, repo.listMedia({ kind }, db));
  const imdbId = details.imdbId ?? (provider === "cinemeta" ? decodeURIComponent(id) : null);
  const backLink = kind === "tv" ? "/tv" : "/movies";

  return (
    <>
      <header className="grid-texture border-b border-border">
        <div className="px-5 pt-5 md:px-8 md:pt-6">
          <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <Link href="/">
              <ArrowLeft className="size-3.5" />
              Back to dashboard
            </Link>
          </Button>
        </div>

        <div className="flex flex-col gap-6 px-5 pb-6 pt-4 md:flex-row md:px-8 md:pb-8">
          <div className="w-[128px] shrink-0 md:w-[168px]">
            <Poster
              src={details.poster}
              alt={details.title}
              kind={kind}
              sizes="168px"
              priority
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="label-mono mb-2">
              {kind === "tv" ? "TV show" : "Movie"}
              {details.network && ` · ${details.network}`}
            </p>

            <h1 className="text-[26px] font-bold leading-none tracking-[-0.025em] md:text-[34px]">
              {details.title}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {details.year && <Pill>{details.year}</Pill>}
              {details.status && (
                <Pill tone={details.status.toLowerCase() === "running" ? "online" : "neutral"}>
                  {details.status}
                </Pill>
              )}
              {details.runtime && <Pill>{details.runtime} min</Pill>}
              {details.seasons && (
                <Pill>
                  {details.seasons} season{details.seasons === 1 ? "" : "s"}
                </Pill>
              )}
              {details.episodeCount && <Pill>{details.episodeCount} episodes</Pill>}
              {details.genres.slice(0, 3).map((genre) => (
                <Pill key={genre}>{genre}</Pill>
              ))}
            </div>

            <p className="mt-4 max-w-3xl text-[13.5px] leading-relaxed text-muted-foreground">
              {details.overview ?? "No description available for this title."}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {tracked ? (
                <>
                  <Pill tone="online">
                    <Check className="size-2.5" />
                    In your library
                  </Pill>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/media/${tracked.id}`}>Open in library</Link>
                  </Button>
                </>
              ) : (
                <div className="w-[180px]">
                  <AddDialog
                    result={details}
                    defaultQuality={kind === "tv" ? config.tv.quality : config.movies.quality}
                    alreadyAdded={false}
                  />
                </div>
              )}

              {imdbId && (
                <Button asChild size="sm" variant="ghost">
                  <a
                    href={`https://www.imdb.com/title/${imdbId}/`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    IMDb
                    <ArrowUpRight className="size-3.5" />
                  </a>
                </Button>
              )}

              <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
                <Link href={backLink}>{kind === "tv" ? "All TV shows" : "All movies"}</Link>
              </Button>
            </div>

            {details.firstAired && (
              <p className="mono mt-4 text-[11px] text-muted-foreground">
                {kind === "tv" ? "First aired" : "Released"}{" "}
                {new Date(details.firstAired).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
        </div>
      </header>

      {details.seasonBreakdown.length > 0 && (
        <div className="px-5 py-6 md:px-8 md:py-8">
          <h2 className="label-mono mb-3 text-foreground/70">Seasons</h2>
          <ul className="panel divide-y divide-border">
            {details.seasonBreakdown.map((season) => (
              <li
                key={season.season}
                className="flex items-center justify-between gap-4 px-4 py-2.5"
              >
                <span className="text-[13px] font-medium">
                  {season.season === 0 ? "Specials" : `Season ${season.season}`}
                </span>
                <span className="mono text-[11.5px] text-muted-foreground">
                  {season.episodes} episode{season.episodes === 1 ? "" : "s"}
                  {season.firstAired && (
                    <span className="text-muted-foreground/70">
                      {" · "}
                      {yearsOf(season.firstAired, season.lastAired)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            Following this show lets you pick which of these to watch for — everything, only
            what has not aired yet, or nothing until you choose seasons yourself.
          </p>
        </div>
      )}
    </>
  );
}

/** "2020" or "2020–2023" for a season's run. */
function yearsOf(first: string, last: string | null): string {
  const from = new Date(first).getUTCFullYear();
  const to = last ? new Date(last).getUTCFullYear() : from;
  return Number.isNaN(from) ? "" : from === to ? String(from) : `${from}–${to}`;
}

function Failure({ kind, message }: { kind: MediaKind; message: string }) {
  return (
    <div className="px-5 py-10 md:px-8">
      <div className="panel mx-auto max-w-lg px-6 py-10 text-center">
        <p className="text-[15px] font-semibold">Could not load this title</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link href="/">Back to dashboard</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/add?kind=${kind}`}>Search instead</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
