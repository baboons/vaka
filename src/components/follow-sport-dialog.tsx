"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { followCompetition } from "@/app/actions";
import { QualityEditor } from "@/components/quality-editor";
import { SportOptions, type SportChoices } from "@/components/sport-options";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { LeagueDefinition } from "@/lib/core/sports";
import { defaultSessions, type QualityProfile } from "@/lib/core/types";

export function FollowSportDialog({
  league,
  defaultQuality,
  alreadyFollowed,
}: {
  league: LeagueDefinition;
  defaultQuality: QualityProfile;
  alreadyFollowed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<QualityProfile>(defaultQuality);
  const [choices, setChoices] = useState<SportChoices>({
    teams: [],
    sessions: defaultSessions(league.format),
    autoGrabUncertain: false,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pending, startTransition] = useTransition();

  if (alreadyFollowed) {
    return (
      <Button size="sm" variant="secondary" disabled className="w-full">
        <Check className="size-3.5" />
        Following
      </Button>
    );
  }

  const submit = () => {
    startTransition(async () => {
      const response = await followCompetition({
        leagueId: league.id,
        teams: choices.teams,
        sessions: choices.sessions,
        autoGrabUncertain: choices.autoGrabUncertain,
        quality,
      });

      if (response.ok) {
        toast.success(response.message);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(response.message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="w-full">
          <Plus className="size-3.5" />
          Follow
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <p className="label-mono">Follow competition</p>
          <DialogTitle className="text-[20px] tracking-[-0.02em]">{league.name}</DialogTitle>
          <DialogDescription>
            {league.fullName}. Events come from ESPN&rsquo;s public schedule — no account needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <SportOptions
            leagueId={league.id}
            format={league.format}
            value={choices}
            onChange={setChoices}
          />

          <QualityEditor
            value={quality}
            onChange={setQuality}
            kind="sport"
            compact={!showAdvanced}
          />

          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="label-mono transition-colors hover:text-foreground"
          >
            {showAdvanced ? "− Fewer options" : "+ Sources, size and word filters"}
          </button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {pending ? "Fetching calendar" : "Follow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
