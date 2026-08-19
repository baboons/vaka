import Link from "next/link";
import { PauseCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Media } from "@/lib/core/types";

import { Pill } from "./bits";
import { Poster } from "./poster";

export interface MediaCardData {
  media: Media;
  counts?: { total: number; have: number; wanted: number };
}

export function MediaCard({ media, counts, index = 0 }: MediaCardData & { index?: number }) {
  const paused = !media.monitored;
  const progress = counts?.total ? Math.round((counts.have / counts.total) * 100) : 0;

  return (
    <Link
      href={`/media/${media.id}`}
      className="stagger-in group block focus-visible:outline-none"
      style={{ animationDelay: `${Math.min(index, 18) * 28}ms` }}
    >
      <div className="relative">
        <Poster
          src={media.poster}
          alt={media.title}
          kind={media.kind}
          className={cn(
            "transition-all duration-300 group-hover:-translate-y-1",
            "group-focus-visible:ring-2 group-focus-visible:ring-signal",
            paused && "opacity-45 saturate-0",
          )}
        />

        {paused && (
          <span className="absolute left-2 top-2 rounded-[3px] bg-background/85 p-1 backdrop-blur">
            <PauseCircle className="size-3.5 text-muted-foreground" />
          </span>
        )}

        {media.kind !== "movie" && counts && counts.total > 0 && (
          <div
            className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50"
            aria-hidden
          >
            <div
              className={cn(
                "h-full transition-all",
                progress === 100 ? "bg-online" : "bg-signal",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      <div className="mt-2.5 space-y-1">
        <p className="line-clamp-1 text-[13.5px] font-semibold leading-tight tracking-[-0.01em] group-hover:text-signal">
          {media.title}
        </p>

        <div className="flex items-center gap-1.5">
          <span className="mono text-[11px] text-muted-foreground">
            {media.kind === "sport" ? (media.network ?? "Competition") : (media.year ?? "—")}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <CardStatus media={media} counts={counts} />
        </div>
      </div>
    </Link>
  );
}

function CardStatus({ media, counts }: MediaCardData) {
  if (media.kind === "movie") {
    if (media.state === "grabbed" || media.state === "done") {
      return (
        <span className="mono text-[11px] text-online">
          {media.grabbedQuality ?? "downloaded"}
        </span>
      );
    }
    if (media.state === "ignored") {
      return <span className="mono text-[11px] text-muted-foreground">ignored</span>;
    }
    return <span className="mono text-[11px] text-signal">wanted</span>;
  }

  if (!counts || counts.total === 0) {
    return (
      <span className="mono text-[11px] text-muted-foreground">
        {media.kind === "sport" ? "no events" : "no episodes"}
      </span>
    );
  }

  return (
    <span className="mono text-[11px] text-muted-foreground">
      <span className={counts.have === counts.total ? "text-online" : "text-foreground/80"}>
        {counts.have}
      </span>
      /{counts.total}
      {counts.wanted > 0 && <span className="text-signal"> · {counts.wanted} wanted</span>}
    </span>
  );
}

/** Shown while a library has nothing in it yet. */
export function MediaGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {children}
    </div>
  );
}

export { Pill };
