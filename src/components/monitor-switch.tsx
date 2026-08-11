"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/app/actions";

/**
 * Optimistic on/off control backed by a server action. Used for the
 * per-title, per-season and per-episode monitoring flags.
 */
export function MonitorSwitch({
  checked,
  action,
  label,
  size = "default",
}: {
  checked: boolean;
  action: (next: boolean) => Promise<ActionResult>;
  label: string;
  size?: "default" | "sm";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Switch
      checked={checked}
      aria-label={label}
      disabled={pending}
      className={cn(size === "sm" && "h-4 w-7 [&_[data-slot=switch-thumb]]:size-3")}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const result = await action(next);
          if (!result.ok) toast.error(result.message);
        })
      }
    />
  );
}
