"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, Flame } from "lucide-react";

import { AddDialog } from "@/components/add-dialog";
import { Poster } from "@/components/poster";
import { cn } from "@/lib/utils";
import type { DiscoverList } from "@/lib/core/discover";
import type { QualityProfile } from "@/lib/core/types";

type View = "popular" | "upcoming";

/**
 * Lets a vertical mouse wheel scroll a horizontal row.
 *
 * The listener is attached to the row itself, so it only ever fires while the
 * pointer is over that row — anywhere else on the page scrolls normally.
 *
 * While the pointer *is* over a scrollable row the wheel belongs to the row and
 * nothing else: the page is held still even at the first and last card, rather
 * than the row quietly handing the scroll back. Move off the row to scroll on.
 *
 * The listener has to be attached by hand because React registers wheel
 * handlers as passive, and a passive handler cannot call preventDefault.
 */
function useWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const onWheel = useCallback((event: WheelEvent) => {
    const element = ref.current;
    if (!element) return;

    // A row that fits has nothing to scroll, so leave the page alone entirely.
    if (element.scrollWidth <= element.clientWidth) return;

    // A trackpad swiping sideways already scrolls this correctly.
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    event.preventDefault();
    element.scrollLeft += event.deltaY;
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  return ref;
}

/** One horizontal row of discovery cards. */
function ScrollRow({ children }: { children: React.ReactNode }) {
  const ref = useWheelScroll<HTMLDivElement>();

  return (
    <div
      ref={ref}
      // overscroll-contain keeps a sideways swipe from triggering
      // back-navigation and stops any scroll chaining to the page.
      className="-mx-1 flex gap-3 overflow-x-auto overscroll-contain px-1 pb-2"
    >
      {children}
    </div>
  );
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const days = Math.round((date.getTime() - Date.now()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function DiscoverSection({
  popular,
  upcoming,
  tvQuality,
  movieQuality,
  hasMovieCalendar,
}: {
  popular: DiscoverList[];
  upcoming: DiscoverList[];
  tvQuality: QualityProfile;
  movieQuality: QualityProfile;
  hasMovieCalendar: boolean;
}) {
  const [view, setView] = useState<View>("popular");
  const lists = view === "popular" ? popular : upcoming;

  const heading = (kind: string) => {
    if (view === "popular") return kind === "tv" ? "TV shows" : "Movies";
    if (kind === "tv") return "Premiering soon";
    return hasMovieCalendar ? "In cinemas soon" : "New releases";
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="label-mono text-foreground/70">Discover</h2>

        <div className="inline-flex rounded-sm border border-border bg-secondary/40 p-0.5">
          {(
            [
              { value: "popular", label: "Popular now", icon: Flame },
              { value: "upcoming", label: "Coming soon", icon: CalendarClock },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setView(option.value)}
              aria-pressed={view === option.value}
              className={cn(
                "mono flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.1em] transition-colors",
                view === option.value
                  ? "bg-signal text-[#17120a]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <option.icon className="size-3" />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {lists.map((list) => (
          <div key={`${view}-${list.kind}`}>
            <div className="mb-2.5 flex items-center gap-3">
              <h3 className="text-[12.5px] font-medium text-foreground/80">
                {heading(list.kind)}
              </h3>
              {list.stale && (
                <span className="mono text-[10px] text-muted-foreground">
                  showing cached results
                </span>
              )}
              {/*
                The keyless movie catalogue only lists films that are already
                out, so say why this row is not a release calendar.
              */}
              {view === "upcoming" && list.kind === "movie" && !hasMovieCalendar && (
                <span className="text-[10.5px] text-muted-foreground">
                  add a{" "}
                  <a href="/settings" className="text-signal underline-offset-2 hover:underline">
                    TMDB key
                  </a>{" "}
                  for films not yet released
                </span>
              )}
              <div className="rule flex-1" />
            </div>

            {list.items.length === 0 ? (
              <p className="panel px-4 py-5 text-center text-[12.5px] text-muted-foreground">
                {list.note ??
                  "Nothing here that you are not already following — good going."}
              </p>
            ) : (
              // A scrolling row keeps the dashboard compact; the whole list is
              // reachable without pushing everything else off the page.
              <ScrollRow>
                {list.items.map((item, index) => (
                  // Fixed width and a flex column so every card in the row is
                  // the same height and the buttons line up, however long the
                  // title or network name turns out to be.
                  <article
                    key={`${item.provider}:${item.providerId}`}
                    className="stagger-in flex w-[132px] shrink-0 flex-col"
                    style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                  >
                    <Link
                      href={`/preview/${item.kind}/${item.provider}/${encodeURIComponent(item.providerId)}`}
                      className="group focus-visible:outline-none"
                    >
                      <Poster
                        src={item.poster}
                        alt={item.title}
                        kind={item.kind}
                        sizes="132px"
                        className={cn(
                          "mb-2 transition-all duration-300",
                          "group-hover:-translate-y-1 group-hover:brightness-110",
                          "group-focus-visible:ring-2 group-focus-visible:ring-signal",
                        )}
                      />

                      <p
                        className="line-clamp-1 text-[12.5px] font-medium leading-tight group-hover:text-signal"
                        title={item.title}
                      >
                        {item.title}
                      </p>
                    </Link>

                    <p className="mono mb-2 mt-0.5 truncate text-[10.5px] text-muted-foreground">
                      {view === "upcoming" && formatDate(item.releaseDate)
                        ? formatDate(item.releaseDate)
                        : (item.year ?? "—")}
                      {item.network && view === "upcoming" && (
                        <span className="text-muted-foreground/70"> · {item.network}</span>
                      )}
                    </p>

                    {/*
                      "Season 4" vs "New series": without it, a returning
                      season under "Premiering soon" is baffling.
                    */}
                    {view === "upcoming" && item.note && (
                      <p className="mono -mt-1.5 mb-2 truncate text-[10px] text-signal/80">
                        {item.note}
                      </p>
                    )}

                    <div className="mt-auto">
                      <AddDialog
                        result={item}
                        defaultQuality={item.kind === "tv" ? tvQuality : movieQuality}
                        alreadyAdded={false}
                      />
                    </div>
                  </article>
                ))}
              </ScrollRow>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
