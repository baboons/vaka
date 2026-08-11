import Link from "next/link";
import { Clapperboard, Plus, Tv } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/bits";
import { MediaCard, MediaGrid } from "@/components/media-card";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/core/db";
import * as repo from "@/lib/core/repo";
import type { MediaKind } from "@/lib/core/types";

/** Shared body for the TV and Movies pages. */
export function LibraryView({ kind }: { kind: MediaKind }) {
  const db = getDb();
  const library = repo.listMedia({ kind }, db);

  const entries = library.map((media) => ({
    media,
    counts: media.kind === "tv" ? repo.countEpisodes(media.id, db) : undefined,
  }));

  const watching = entries.filter((entry) => entry.media.monitored);
  const paused = entries.filter((entry) => !entry.media.monitored);

  const wanted = entries.reduce(
    (total, entry) =>
      total +
      (entry.media.kind === "tv"
        ? (entry.counts?.wanted ?? 0)
        : entry.media.monitored && entry.media.state === "wanted"
          ? 1
          : 0),
    0,
  );

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title={kind === "tv" ? "TV shows" : "Movies"}
        description={
          library.length === 0
            ? undefined
            : `${watching.length} being watched${
                paused.length ? `, ${paused.length} paused` : ""
              }${wanted > 0 ? ` · ${wanted} still wanted` : ""}`
        }
        actions={
          <Button asChild size="sm">
            <Link href={`/add?kind=${kind}`}>
              <Plus className="size-3.5" />
              Add {kind === "tv" ? "show" : "movie"}
            </Link>
          </Button>
        }
      />

      <div className="space-y-10 px-5 py-6 md:px-8 md:py-8">
        {entries.length === 0 ? (
          <EmptyState
            icon={kind === "tv" ? <Tv className="size-7" /> : <Clapperboard className="size-7" />}
            title={kind === "tv" ? "No shows yet" : "No movies yet"}
            description={
              kind === "tv"
                ? "Follow a show and the watcher will start looking for its episodes in your RSS feeds."
                : "Add a film and the watcher will grab it when a matching release appears."
            }
            action={
              <Button asChild size="sm" className="mt-1">
                <Link href={`/add?kind=${kind}`}>
                  <Plus className="size-3.5" />
                  Search
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            {watching.length > 0 && (
              <section>
                <MediaGrid>
                  {watching.map((entry, index) => (
                    <MediaCard
                      key={entry.media.id}
                      media={entry.media}
                      counts={entry.counts}
                      index={index}
                    />
                  ))}
                </MediaGrid>
              </section>
            )}

            {paused.length > 0 && (
              <section>
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="label-mono">Paused</h2>
                  <div className="rule flex-1" />
                </div>
                <MediaGrid>
                  {paused.map((entry, index) => (
                    <MediaCard
                      key={entry.media.id}
                      media={entry.media}
                      counts={entry.counts}
                      index={index}
                    />
                  ))}
                </MediaGrid>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
