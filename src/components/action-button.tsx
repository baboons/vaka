"use client";

import { useTransition, type ComponentProps, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/app/actions";

/**
 * Runs a bound server action and reports the outcome as a toast.
 *
 * Actions are bound on the server (`requestSearch.bind(null, id)`) and passed
 * in, which keeps argument plumbing out of the client bundle.
 */
export function ActionButton({
  action,
  children,
  icon,
  pendingLabel,
  onDone,
  ...props
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  icon?: ReactNode;
  pendingLabel?: string;
  onDone?: (result: ActionResult) => void;
} & Omit<ComponentProps<typeof Button>, "onClick" | "action">) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await action();
            if (result.ok) toast.success(result.message);
            else toast.error(result.message);
            onDone?.(result);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Something went wrong");
          }
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
