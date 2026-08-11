import Link from "next/link";
import { SearchX, Sparkles } from "lucide-react";

import { AddDialog } from "@/components/add-dialog";
import { EmptyState, PageHeader, Pill } from "@/components/bits";
import { Poster } from "@/components/poster";
import { SearchForm } from "@/components/search-form";
import { getDb } from "@/lib/core/db";
import * as providers from "@/lib/core/providers";
import * as repo from "@/lib/core/repo";
import { getConfig } from "@/lib/core/settings";
import type { MediaKind } from "@/lib/core/types";

// Results come from a live provider call, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string }>;
}) {
  const params = await searchParams;
  const kind: MediaKind = params.kind === "movie" ? "movie" : "tv";
  const query = params.q?.trim() ?? "";

  const db = getDb();
  const config = getConfig(db);
  const defaultQuality = kind === "tv" ? config.tv.quality : config.movies.quality;

  let results: providers.SearchResult[] = [];
  let error: string | null = null;

  if (query) {
    try {
      results = await providers.search(kind, query, config.general.tmdbApiKey);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "The search provider did not respond";
    }
  }

  // Anything already followed is shown as such rather than offered again.
  const owned = new Set(
    repo.listMedia({ kind }, db).map((media) => `${media.provider}:${media.providerId}`),
  );

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Add something to watch"
        description={
          kind === "tv"
            ? "Find a show, choose the quality you want, and the watcher will pick up new episodes from your feeds as they appear."
            : "Find a film and the watcher will grab it as soon as a release matching your quality shows up."
        }
      />

      <div className="space-y-8 px-5 py-6 md:px-8 md:py-8">
        <SearchForm key={`${kind}:${query}`} kind={kind} query={query} pending={false} />

        {!query && (
          <EmptyState
            icon={<Sparkles className="size-7" />}
            title="Search to get started"
            description={
              kind === "tv"
                ? "TV data comes from TVmaze, including full episode lists and air dates."
                : config.general.tmdbApiKey
                  ? "Movie data comes from TMDB."
                  : "Movie data comes from Cinemeta, an IMDb-backed catalogue that needs no API key. Add a TMDB key in Settings for richer results."
            }
          />
        )}

        {error && (
          <div className="panel border-alert/40 bg-alert/5 px-4 py-3 text-[13px] text-alert">
            {error}
          </div>
        )}

        {query && !error && results.length === 0 && (
          <EmptyState
            icon={<SearchX className="size-7" />}
            title={`Nothing found for “${query}”`}
            description="Try the original title, or a shorter version of it."
          />
        )}

        {results.length > 0 && (
          <div>
            <p className="label-mono mb-3">
              {results.length} result{results.length === 1 ? "" : "s"}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((result, index) => (
                <ResultCard
                  key={`${result.provider}:${result.providerId}`}
                  result={result}
                  defaultQuality={defaultQuality}
                  alreadyAdded={owned.has(`${result.provider}:${result.providerId}`)}
                  index={index}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ResultCard({
  result,
  defaultQuality,
  alreadyAdded,
  index,
}: {
  result: providers.SearchResult;
  defaultQuality: ReturnType<typeof getConfig>["tv"]["quality"];
  alreadyAdded: boolean;
  index: number;
}) {
  return (
    <article
      className="stagger-in panel flex gap-4 p-3"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <Link
        href={`/preview/${result.kind}/${result.provider}/${encodeURIComponent(result.providerId)}`}
        className="group w-[86px] shrink-0 focus-visible:outline-none"
      >
        <Poster
          src={result.poster}
          alt={result.title}
          kind={result.kind}
          sizes="86px"
          className="transition-all group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-signal"
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-[14.5px] font-semibold leading-tight tracking-[-0.01em]">
          <Link
            href={`/preview/${result.kind}/${result.provider}/${encodeURIComponent(result.providerId)}`}
            className="transition-colors hover:text-signal"
          >
            {result.title}
          </Link>
        </h3>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {result.year && <Pill>{result.year}</Pill>}
          {result.network && <Pill>{result.network}</Pill>}
          {result.status && (
            <Pill tone={result.status.toLowerCase() === "running" ? "online" : "neutral"}>
              {result.status}
            </Pill>
          )}
        </div>

        <p className="mt-2 line-clamp-3 flex-1 text-[12px] leading-relaxed text-muted-foreground">
          {result.overview ?? "No description available."}
        </p>

        <div className="mt-3">
          <AddDialog
            result={result}
            defaultQuality={defaultQuality}
            alreadyAdded={alreadyAdded}
          />
        </div>
      </div>
    </article>
  );
}
