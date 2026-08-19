"use client";

import { useState, useTransition } from "react";
import { Check, CircleDashed, Clock, Download, MinusCircle } from "lucide-react";
import { toast } from "sonner";

import {
  setEpisodeMonitored,
  setEpisodeState,
  setSeasonMonitored,
} from "@/app/actions";
import { Pill } from "@/components/bits";
import { MonitorSwitch } from "@/components/monitor-switch";
import { RelativeTime } from "@/components/relative-time";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Episode, EpisodeState, MediaKind } from "@/lib/core/types";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const STATE_META: Record<
  EpisodeState,
  { label: string; tone: "neutral" | "signal" | "online" | "alert"; icon: typeof Check }
> = {
  wanted: { label: "Wanted", tone: "signal", icon: CircleDashed },
  grabbed: { label: "Grabbed", tone: "online", icon: Download },
  done: { label: "Have", tone: "online", icon: Check },
  skipped: { label: "Skipped", tone: "neutral", icon: MinusCircle },
};

/**
 * Episodes grouped by season — or, for a competition, events grouped by year.
 *
 * They are the same rows underneath: a sports event is an episode whose
 * season is the year it belongs to and whose identity is a date rather than a
 * number, so only the labelling differs.
 */
export function SeasonList({
  mediaId,
  episodes,
  kind = "tv",
}: {
  mediaId: number;
  episodes: Episode[];
  kind?: MediaKind;
}) {
  const isSport = kind === "sport";
  const seasons = [...new Set(episodes.map((episode) => episode.season))].sort((a, b) => a - b);

  // Open the newest season by default — that is where the action is.
  const [open, setOpen] = useState<string[]>(
    seasons.length ? [`season-${seasons[seasons.length - 1]}`] : [],
  );

  if (!episodes.length) {
    return (
      <p className="panel px-4 py-6 text-center text-[13px] text-muted-foreground">
        {isSport
          ? "No events on the calendar yet. Refresh the calendar, or widen the window under Settings → Sports."
          : "No episodes have been published for this show yet."}
      </p>
    );
  }

  return (
    <Accordion type="multiple" value={open} onValueChange={setOpen} className="space-y-2">
      {seasons.map((season) => {
        const seasonEpisodes = episodes.filter((episode) => episode.season === season);
        const have = seasonEpisodes.filter(
          (episode) => episode.state === "grabbed" || episode.state === "done",
        ).length;
        const monitoredCount = seasonEpisodes.filter((episode) => episode.monitored).length;

        return (
          <AccordionItem
            key={season}
            value={`season-${season}`}
            className="panel overflow-hidden border-b"
          >
            {/*
              The season toggle sits beside the trigger rather than inside it:
              a button nested in a button is invalid HTML and breaks hydration.
            */}
            <div className="flex items-center">
              <AccordionTrigger
                headerClassName="min-w-0 flex-1"
                className="px-4 py-3 hover:no-underline"
              >
                <span className="flex flex-1 items-baseline gap-2.5">
                  <span className="text-[14px] font-semibold tracking-[-0.01em]">
                    {isSport
                      ? String(season)
                      : season === 0
                        ? "Specials"
                        : `Season ${season}`}
                  </span>
                  <span className="mono text-[11.5px] text-muted-foreground">
                    <span className={have === seasonEpisodes.length ? "text-online" : ""}>
                      {have}
                    </span>
                    /{seasonEpisodes.length}
                  </span>
                </span>
              </AccordionTrigger>

              <span className="flex shrink-0 items-center gap-2 pr-3">
                {monitoredCount === 0 && <Pill>ignored</Pill>}
                <SeasonToggle
                  mediaId={mediaId}
                  season={season}
                  monitored={monitoredCount > 0}
                  isSport={isSport}
                />
              </span>
            </div>

            <AccordionContent className="pb-0">
              <ul className="divide-y divide-border border-t border-border">
                {seasonEpisodes.map((episode) => (
                  <EpisodeRow key={episode.id} episode={episode} isSport={isSport} />
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

/** Turns a whole season on or off. */
function SeasonToggle({
  mediaId,
  season,
  monitored,
  isSport,
}: {
  mediaId: number;
  season: number;
  monitored: boolean;
  isSport: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className="mono h-7 px-2 text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground"
      onClick={() =>
        startTransition(async () => {
          const result = await setSeasonMonitored(mediaId, season, !monitored);
          if (result.ok) toast.success(result.message);
          else toast.error(result.message);
        })
      }
    >
      {monitored
        ? isSport
          ? "Ignore year"
          : "Ignore season"
        : isSport
          ? "Monitor year"
          : "Monitor season"}
    </Button>
  );
}

function EpisodeRow({ episode, isSport }: { episode: Episode; isSport: boolean }) {
  const meta = STATE_META[episode.state];
  const Icon = meta.icon;
  const [pending, startTransition] = useTransition();

  const toggleHave = () => {
    const next: EpisodeState = episode.state === "wanted" ? "done" : "wanted";
    startTransition(async () => {
      const result = await setEpisodeState(episode.id, next);
      if (!result.ok) toast.error(result.message);
    });
  };

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/30",
        !episode.monitored && "opacity-55",
      )}
    >
      <span className="mono w-11 shrink-0 text-[11.5px] text-muted-foreground">
        {isSport ? (episode.airDate?.slice(5, 10).replace("-", "/") ?? "—") : `E${pad(episode.number)}`}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-tight">{episode.title ?? "TBA"}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {episode.airDate ? (
            <>
              <Clock className="size-3" />
              <RelativeTime value={episode.airDate} />
            </>
          ) : (
            isSport ? "No date" : "No air date"
          )}
          {episode.grabbedQuality && (
            <span className="mono text-online">· {episode.grabbedQuality}</span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={toggleHave}
        disabled={pending}
        title={episode.state === "wanted" ? "Mark as already have" : "Mark as wanted again"}
        className="shrink-0"
      >
        <Pill tone={meta.tone}>
          <Icon className="size-2.5" />
          {meta.label}
        </Pill>
      </button>

      <span className="shrink-0">
        <MonitorSwitch
          size="sm"
          checked={episode.monitored}
          label={`Monitor episode ${episode.number}`}
          action={setEpisodeMonitored.bind(null, episode.id)}
        />
      </span>
    </li>
  );
}
