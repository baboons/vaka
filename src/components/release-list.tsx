import { Download, Magnet } from "lucide-react";

import { grabRelease } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { Pill } from "@/components/bits";
import { RelativeTime } from "@/components/relative-time";
import type { CachedRelease } from "@/lib/core/engine";

function formatSize(bytes: number | null): string | null {
  if (!bytes) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Cached feed releases for one title, with the accept/reject verdict shown.
 * This is where you look when something did not download and you want to know
 * whether the release was never seen, or seen and turned down.
 *
 * For a competition it does one more job: a sports release carries no episode
 * number, so anything Vaka could not identify with confidence is listed here
 * with its score and what that score was made of, for you to grab or ignore.
 */
export function ReleaseList({
  releases,
  mediaId,
}: {
  releases: CachedRelease[];
  mediaId: number;
}) {
  if (!releases.length) {
    return (
      <p className="panel px-4 py-6 text-center text-[13px] text-muted-foreground">
        No cached releases match this title yet. The watcher only keeps recent feed items, so
        this fills in as your feeds update.
      </p>
    );
  }

  return (
    <ul className="panel divide-y divide-border">
      {releases.slice(0, 40).map((release) => (
        <li key={release.item.id ?? release.item.guid} className="px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="mono truncate text-[12px] text-foreground/90">
                {release.item.title}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Pill tone={release.decision.ok ? "online" : "neutral"}>{release.label}</Pill>
                <Pill tone="info">{release.quality}</Pill>
                {release.confidence && (
                  <Pill tone={release.confidence.confident ? "online" : "signal"}>
                    {release.confidence.confident ? "sure" : "maybe"} · {release.confidence.score}
                  </Pill>
                )}
                {release.seeders !== null && (
                  <span className="mono text-[10.5px] text-muted-foreground">
                    {release.seeders} seeders
                  </span>
                )}
                {formatSize(release.sizeBytes) && (
                  <span className="mono text-[10.5px] text-muted-foreground">
                    {formatSize(release.sizeBytes)}
                  </span>
                )}
                {release.item.magnet && !release.item.link && (
                  <span title="Magnet link only">
                    <Magnet className="size-3 text-muted-foreground" />
                  </span>
                )}
                <span className="mono text-[10.5px] text-muted-foreground">
                  <RelativeTime value={release.publishedAt ?? release.item.firstSeenAt ?? null} />
                </span>
              </div>

              {release.confidence && (
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  Matched on {release.confidence.reasons.join(", ")}.
                </p>
              )}

              {!release.decision.ok && (
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  {release.confidence && !release.confidence.confident
                    ? "Waiting for you — "
                    : "Rejected — "}
                  {release.decision.reason}
                </p>
              )}
            </div>

            <ActionButton
              action={grabRelease.bind(null, release.item.id ?? 0, mediaId)}
              icon={<Download className="size-3.5" />}
              size="sm"
              variant={release.decision.ok ? "secondary" : "ghost"}
              className="shrink-0"
              pendingLabel="Queuing"
            >
              Grab
            </ActionButton>
          </div>
        </li>
      ))}
    </ul>
  );
}
