"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { KIND_LABELS, MEDIA_KINDS, type MediaKind } from "@/lib/core/types";

const PLACEHOLDERS: Record<MediaKind, string> = {
  tv: "Search for a TV show…",
  movie: "Search for a movie…",
  // Competitions are a fixed catalogue, so this narrows a list rather than
  // querying anything.
  sport: "Filter competitions…",
};

/**
 * Search box for the add page. Keeps the query in the URL so results survive a
 * reload and can be linked to.
 *
 * The caller keys this on the current query, so navigating remounts it with
 * the new value rather than syncing a prop into state.
 */
export function SearchForm({
  kind,
  query,
  pending,
}: {
  kind: MediaKind;
  query: string;
  pending: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);

  const go = (nextKind: MediaKind, nextQuery: string) => {
    const params = new URLSearchParams({ kind: nextKind });
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    router.push(`/add?${params}`);
  };

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-sm border border-border bg-secondary/40 p-0.5">
        {MEDIA_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => go(option, value)}
            className={cn(
              "mono rounded-[2px] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] transition-colors",
              kind === option
                ? "bg-signal text-[#17120a]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {KIND_LABELS[option]}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          go(kind, value);
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={PLACEHOLDERS[kind]}
            className="h-11 pl-9 text-[14px]"
          />
        </div>
        {/* Sports browse rather than search, so an empty box is a valid ask. */}
        <Button type="submit" size="lg" disabled={pending || (!value.trim() && kind !== "sport")}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search
        </Button>
      </form>
    </div>
  );
}
