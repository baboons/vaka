"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { saveGeneralSettings } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { GeneralConfig } from "@/lib/core/settings";

export function GeneralSettingsForm({ initial }: { initial: GeneralConfig }) {
  const [config, setConfig] = useState<GeneralConfig>(initial);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveGeneralSettings(config);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          label="Check feeds every"
          suffix="min"
          value={config.pollIntervalMinutes}
          min={1}
          max={1440}
          onChange={(pollIntervalMinutes) => setConfig({ ...config, pollIntervalMinutes })}
        />
        <NumberField
          label="Refresh metadata every"
          suffix="hours"
          value={config.refreshIntervalHours}
          min={1}
          max={168}
          onChange={(refreshIntervalHours) => setConfig({ ...config, refreshIntervalHours })}
        />
        <NumberField
          label="Keep feed history"
          suffix="days"
          value={config.feedRetentionDays}
          min={1}
          max={365}
          onChange={(feedRetentionDays) => setConfig({ ...config, feedRetentionDays })}
        />
      </div>

      <NumberField
        label="Wait before grabbing"
        suffix="min"
        value={config.grabDelayMinutes}
        min={0}
        max={1440}
        hint="Gives trackers time to post a better release before the first match is taken. 0 grabs immediately."
        onChange={(grabDelayMinutes) => setConfig({ ...config, grabDelayMinutes })}
      />

      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-medium">Write .magnet files</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            When a feed offers only a magnet link, save it as a{" "}
            <span className="mono">.magnet</span> text file. Not every client watches for these —
            turn it off to skip magnet-only releases instead.
          </span>
        </span>
        <Switch
          checked={config.writeMagnetFiles}
          onCheckedChange={(writeMagnetFiles) => setConfig({ ...config, writeMagnetFiles })}
        />
      </label>

      <div className="space-y-2">
        <Label className="label-mono">TMDB API key</Label>
        <Input
          value={config.tmdbApiKey}
          onChange={(event) => setConfig({ ...config, tmdbApiKey: event.target.value })}
          placeholder="Optional"
          className="mono text-[12.5px]"
          type="password"
          autoComplete="off"
        />
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Optional. Without a key, movie search uses Cinemeta — an IMDb-backed catalogue that
          needs no credentials but carries less detail. TV always comes from TVmaze and never
          needs a key.
        </p>
      </div>

      <Button onClick={save} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Save
      </Button>
    </div>
  );
}

function NumberField({
  label,
  suffix,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="label-mono">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          min={min}
          max={max}
          value={value}
          className="mono pr-14"
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
        />
        <span className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {suffix}
        </span>
      </div>
      {hint && <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
