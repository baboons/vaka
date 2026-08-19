"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { updateSportSubscription } from "@/app/actions";
import { SportOptions, type SportChoices } from "@/components/sport-options";
import { Button } from "@/components/ui/button";
import type { SportFormat, SportSubscription } from "@/lib/core/types";

/**
 * Change how a competition is followed.
 *
 * Saving re-syncs the calendar, because the team filter decides which
 * fixtures are stored in the first place — narrowing it leaves rows behind,
 * widening it needs the new ones fetched.
 */
export function SportSubscriptionForm({
  mediaId,
  format,
  subscription,
}: {
  mediaId: number;
  format: SportFormat;
  subscription: SportSubscription;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<SportChoices>({
    teams: subscription.teams,
    sessions: subscription.sessions,
    autoGrabUncertain: subscription.autoGrabUncertain,
  });
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await updateSportSubscription(mediaId, choices);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });

  return (
    <div className="space-y-5">
      <SportOptions
        leagueId={subscription.league}
        format={format}
        value={choices}
        onChange={setChoices}
      />

      <Button onClick={save} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Save and refresh the calendar
      </Button>
    </div>
  );
}
