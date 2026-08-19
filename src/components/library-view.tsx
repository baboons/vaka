import Link from "next/link";
import { Clapperboard, Plus, Trophy, Tv } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/bits";
import { MediaCard, MediaGrid } from "@/components/media-card";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/core/db";
import * as repo from "@/lib/core/repo";
import { KIND_LABELS, type MediaKind } from "@/lib/core/types";

const ICONS = {
  tv: <Tv className="size-7" />,
  movie: <Clapperboard className="size-7" />,
  sport: <Trophy className="size-7" />,
} as const;

const ADD_LABEL: Record<MediaKind, string> = {
  tv: "Add show",
  movie: "Add movie",
  sport: "Follow a competition",
};

const EMPTY: Record<MediaKind, { title: string; description: string }> = {
  tv: {
    title: "No shows yet",
    description:
      "Follow a show and the watcher will start looking for its episodes in your RSS feeds.",
  },
  movie: {
    title: "No movies yet",
    description: "Add a film and the watcher will grab it when a matching release appears.",
  },
  sport: {
    title: "No competitions yet",
    description:
      "Follow a league or promotion and Vaka will pull in its calendar, then watch your " +
      "feeds for each event as it happens.",
  },
};

/** Shared body for the TV, Movies and Sports pages. */
export function LibraryView({ kind }: { kind: MediaKind }) {
  const db = getDb();
  const library = repo.listMedia({ kind }, db);

  // Movies are wanted as a whole; shows and competitions have a list of parts.
  const entries = library.map((media) => ({
    media,
    counts: media.kind === "movie" ? undefined : repo.countEpisodes(media.id, db),
  }));

  const watching = entries.filter((entry) => entry.media.monitored);
  const paused = entries.filter((entry) => !entry.media.monitored);

  const wanted = entries.reduce(
    (total, entry) =>
      total +
      (entry.media.kind === "movie"
        ? entry.media.monitored && entry.media.state === "wanted"
          ? 1
          : 0
        : (entry.counts?.wanted ?? 0)),
    0,
  );

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title={KIND_LABELS[kind]}
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
              {ADD_LABEL[kind]}
            </Link>
          </Button>
        }
      />

      <div className="space-y-10 px-5 py-6 md:px-8 md:py-8">
        {entries.length === 0 ? (
          <EmptyState
            icon={ICONS[kind]}
            title={EMPTY[kind].title}
            description={EMPTY[kind].description}
            action={
              <Button asChild size="sm" className="mt-1">
                <Link href={`/add?kind=${kind}`}>
                  <Plus className="size-3.5" />
                  {kind === "sport" ? "Browse competitions" : "Search"}
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
