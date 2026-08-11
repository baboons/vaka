"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { addToLibrary } from "@/app/actions";
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
import { Label } from "@/components/ui/label";
import { QualityEditor } from "@/components/quality-editor";
import { cn } from "@/lib/utils";
import type { MonitorMode } from "@/lib/core/engine";
import type { SearchResult } from "@/lib/core/providers";
import type { QualityProfile } from "@/lib/core/types";

const MONITOR_OPTIONS: Array<{ value: MonitorMode; label: string; hint: string }> = [
  { value: "future", label: "From now on", hint: "Only episodes that have not aired yet" },
  { value: "all", label: "Everything", hint: "Including the back catalogue" },
  { value: "none", label: "Nothing yet", hint: "Add it, choose seasons later" },
];

export function AddDialog({
  result,
  defaultQuality,
  alreadyAdded,
}: {
  result: SearchResult;
  defaultQuality: QualityProfile;
  alreadyAdded: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<QualityProfile>(defaultQuality);
  const [monitorMode, setMonitorMode] = useState<MonitorMode>("future");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pending, startTransition] = useTransition();

  if (alreadyAdded) {
    return (
      <Button size="sm" variant="secondary" disabled className="w-full">
        <Check className="size-3.5" />
        In library
      </Button>
    );
  }

  const submit = () => {
    startTransition(async () => {
      const response = await addToLibrary({
        kind: result.kind,
        provider: result.provider,
        providerId: result.providerId,
        quality,
        monitorMode,
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
          {result.kind === "tv" ? "Follow" : "Add"}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <p className="label-mono">{result.kind === "tv" ? "Follow show" : "Add movie"}</p>
          <DialogTitle className="text-[20px] tracking-[-0.02em]">
            {result.title}
            {result.year && (
              <span className="mono ml-2 text-[15px] font-normal text-muted-foreground">
                {result.year}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="line-clamp-3">
            {result.overview ?? "No description available."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {result.kind === "tv" && (
            <div className="space-y-2">
              <Label className="label-mono">Which episodes to watch for</Label>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {MONITOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setMonitorMode(option.value)}
                    aria-pressed={monitorMode === option.value}
                    className={cn(
                      "rounded-sm border px-3 py-2.5 text-left transition-colors",
                      monitorMode === option.value
                        ? "border-signal/50 bg-signal/10"
                        : "border-border bg-secondary/30 hover:border-line-strong",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-[13px] font-medium",
                        monitorMode === option.value && "text-signal",
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {option.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <QualityEditor
            value={quality}
            onChange={setQuality}
            kind={result.kind}
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
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {result.kind === "tv" ? "Follow show" : "Add movie"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
