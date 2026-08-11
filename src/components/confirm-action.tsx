"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/app/actions";

/** Destructive action behind a confirmation step. */
export function ConfirmAction({
  action,
  title,
  description,
  confirmLabel,
  children,
  redirectTo,
}: {
  action: () => Promise<ActionResult>;
  title: string;
  description: string;
  confirmLabel: string;
  children: ReactNode;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:bg-alert/10 hover:text-alert"
        >
          {children}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-alert text-white hover:bg-alert/90"
            onClick={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await action();
                if (result.ok) {
                  toast.success(result.message);
                  setOpen(false);
                  if (redirectTo) router.push(redirectTo);
                } else {
                  toast.error(result.message);
                }
              });
            }}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
