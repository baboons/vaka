import Link from "next/link";
import { Activity as ActivityIcon } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PageHeader, Pill } from "@/components/bits";
import { RelativeTime } from "@/components/relative-time";
import { getDb } from "@/lib/core/db";
import * as repo from "@/lib/core/repo";
import { cn } from "@/lib/utils";
import type { HistoryEvent } from "@/lib/core/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Activity — Vaka" };

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "grabbed", label: "Grabbed" },
  { value: "rejected", label: "Rejected" },
  { value: "error", label: "Errors" },
];

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const params = await searchParams;
  const filter = FILTERS.some((option) => option.value === params.event)
    ? (params.event as string)
    : "all";

  const db = getDb();
  const rows = repo.listHistory(
    { limit: 300, event: filter === "all" ? undefined : (filter as HistoryEvent) },
    db,
  );

  return (
    <>
      <AutoRefresh intervalMs={20_000} />

      <PageHeader
        eyebrow="Log"
        title="Activity"
        description="Every decision the watcher has made, newest first. Rejections are recorded only for titles you follow."
      />

      <div className="space-y-5 px-5 py-6 md:px-8 md:py-8">
        <nav className="inline-flex rounded-sm border border-border bg-secondary/40 p-0.5">
          {FILTERS.map((option) => (
            <Link
              key={option.value}
              href={option.value === "all" ? "/activity" : `/activity?event=${option.value}`}
              className={cn(
                "mono rounded-[2px] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] transition-colors",
                filter === option.value
                  ? "bg-signal text-[#17120a]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <EmptyState
            icon={<ActivityIcon className="size-7" />}
            title="Nothing logged yet"
            description="Once the watcher polls your feeds, everything it grabs or turns down appears here."
          />
        ) : (
          <ul className="panel divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                <Pill
                  tone={
                    row.event === "grabbed"
                      ? "online"
                      : row.event === "error"
                        ? "alert"
                        : row.event === "info"
                          ? "info"
                          : "neutral"
                  }
                  className="mt-0.5 shrink-0"
                >
                  {row.event}
                </Pill>

                <div className="min-w-0 flex-1">
                  <p className="mono truncate text-[12px] text-foreground/90">
                    {row.title ?? "—"}
                  </p>

                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    {row.mediaTitle && (
                      <Link
                        href={`/media/${row.mediaId}`}
                        className="text-foreground/70 transition-colors hover:text-signal"
                      >
                        {row.mediaTitle}
                      </Link>
                    )}
                    {row.mediaTitle && row.reason && " · "}
                    {row.reason}
                    {row.quality && (
                      <span className="mono text-info"> · {row.quality}</span>
                    )}
                  </p>

                  {row.path && (
                    <p className="mono mt-1 truncate text-[10.5px] text-muted-foreground/70">
                      → {row.path}
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
      </div>
    </>
  );
}
