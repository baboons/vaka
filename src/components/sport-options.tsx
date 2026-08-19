"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";

import { competitionTeams } from "@/app/actions";
import { ChipToggle } from "@/components/quality-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LeagueTeam } from "@/lib/core/sports";
import {
  SESSION_HINTS,
  SESSION_LABELS,
  sessionsFor,
  type SportFormat,
  type SportSession,
} from "@/lib/core/types";

export interface SportChoices {
  teams: string[];
  sessions: SportSession[];
  autoGrabUncertain: boolean;
}

/**
 * The three things that define how a competition is followed: who, what, and
 * how sure Vaka has to be before it downloads anything.
 *
 * Shared between following a competition for the first time and changing it
 * afterwards, because they are the same decision.
 */
export function SportOptions({
  leagueId,
  format,
  value,
  onChange,
}: {
  leagueId: string;
  format: SportFormat;
  value: SportChoices;
  onChange: (next: SportChoices) => void;
}) {
  const sessions = sessionsFor(format);

  const toggleSession = (session: SportSession) =>
    onChange({
      ...value,
      sessions: value.sessions.includes(session)
        ? value.sessions.filter((item) => item !== session)
        : [...value.sessions, session],
    });

  return (
    <div className="space-y-5">
      {format === "fixture" && (
        <TeamPicker
          leagueId={leagueId}
          selected={value.teams}
          onChange={(teams) => onChange({ ...value, teams })}
        />
      )}

      <div className="space-y-2">
        <Label className="label-mono">Which parts of an event</Label>
        <div className="flex flex-wrap gap-1.5">
          {sessions.map((session) => (
            <ChipToggle
              key={session}
              active={value.sessions.includes(session)}
              onClick={() => toggleSession(session)}
            >
              {SESSION_LABELS[session]}
            </ChipToggle>
          ))}
        </div>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          {value.sessions.length
            ? value.sessions.map((session) => SESSION_HINTS[session]).join(" · ")
            : "Nothing selected — no release will be accepted."}
        </p>
      </div>

      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">Download uncertain matches too</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            Sports releases carry no episode number, so Vaka scores how well a release matches
            an event. With this off, anything short of a confident match waits under Releases
            for you to confirm it. With it on, the best guess is downloaded.
          </span>
        </span>
        <Switch
          checked={value.autoGrabUncertain}
          onCheckedChange={(autoGrabUncertain) => onChange({ ...value, autoGrabUncertain })}
        />
      </label>
    </div>
  );
}

/**
 * Which teams to follow.
 *
 * Empty means the whole competition, and for most leagues that is not what
 * anyone wants: a season is 380 fixtures, and the calendar is filtered by this
 * before anything is stored.
 */
function TeamPicker({
  leagueId,
  selected,
  onChange,
}: {
  leagueId: string;
  selected: string[];
  onChange: (teams: string[]) => void;
}) {
  const [teams, setTeams] = useState<LeagueTeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      const result = await competitionTeams(leagueId);
      setTeams(result.teams);
      setError(result.error);
    });
  }, [leagueId]);

  const visible = filter.trim()
    ? teams.filter((team) => team.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : teams;

  const toggle = (name: string) =>
    onChange(
      selected.includes(name)
        ? selected.filter((item) => item !== name)
        : [...selected, name],
    );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="label-mono">Which teams</Label>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="label-mono transition-colors hover:text-foreground"
          >
            Follow every team
          </button>
        )}
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading teams…
        </p>
      )}

      {error && (
        <p className="text-[12px] text-alert">
          {error} — you can still follow the whole competition.
        </p>
      )}

      {teams.length > 12 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter teams…"
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>
      )}

      {teams.length > 0 && (
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-sm border border-border bg-secondary/20 p-2">
          {visible.map((team) => (
            <ChipToggle
              key={team.id}
              active={selected.includes(team.name)}
              onClick={() => toggle(team.name)}
            >
              {team.name}
            </ChipToggle>
          ))}
          {visible.length === 0 && (
            <p className="px-1 py-2 text-[12px] text-muted-foreground">No team matches that.</p>
          )}
        </div>
      )}

      <p className="text-[11.5px] leading-snug text-muted-foreground">
        {selected.length === 0
          ? "Every fixture in the competition. That is a lot for a full league season — pick teams to keep it to what you watch."
          : `${selected.length} team${selected.length === 1 ? "" : "s"} — only their fixtures are tracked.`}
      </p>
    </div>
  );
}
