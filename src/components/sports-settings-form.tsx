"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import { requestSportSync, saveSportsSettings, verifyDownloadDir } from "@/app/actions";
import { QualityEditor } from "@/components/quality-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SportsConfig } from "@/lib/core/settings";

/**
 * Settings for the sports library.
 *
 * The calendar window is the setting that matters most here, and it cuts both
 * ways: too narrow and a release lands before the event is known about, too
 * wide and a league season fills the database with fixtures nobody will ever
 * download.
 */
export function SportsSettingsForm({ initial }: { initial: SportsConfig }) {
  const [config, setConfig] = useState<SportsConfig>(initial);
  const [pending, startTransition] = useTransition();
  const [checking, startChecking] = useTransition();
  const [syncing, startSyncing] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveSportsSettings(config);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  const verify = () =>
    startChecking(async () => {
      const result = await verifyDownloadDir(config.downloadDir);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  const sync = () =>
    startSyncing(async () => {
      const result = await requestSportSync();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <Label className="label-mono">Download folder</Label>
        <div className="flex gap-2">
          <Input
            value={config.downloadDir}
            onChange={(event) => setConfig({ ...config, downloadDir: event.target.value })}
            placeholder="~/Downloads/vaka/sports"
            className="mono text-[12.5px]"
          />
          <Button variant="secondary" onClick={verify} disabled={checking}>
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Check
          </Button>
        </div>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Matching events are written here as <span className="mono">.torrent</span> files,
          always directly in this folder.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="label-mono">Calendar window</h3>
          <div className="rule flex-1" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Days ahead">
            <Input
              type="number"
              min={1}
              max={365}
              className="mono"
              value={config.lookaheadDays}
              onChange={(event) =>
                setConfig({
                  ...config,
                  lookaheadDays: clamp(Number(event.target.value), 1, 365),
                })
              }
            />
          </Field>
          <Field label="Days behind">
            <Input
              type="number"
              min={0}
              max={365}
              className="mono"
              value={config.lookbehindDays}
              onChange={(event) =>
                setConfig({
                  ...config,
                  lookbehindDays: clamp(Number(event.target.value), 0, 365),
                })
              }
            />
          </Field>
          <Field label="Refresh every (hours)">
            <Input
              type="number"
              min={1}
              max={168}
              className="mono"
              value={config.syncIntervalHours}
              onChange={(event) =>
                setConfig({
                  ...config,
                  syncIntervalHours: clamp(Number(event.target.value), 1, 168),
                })
              }
            />
          </Field>
        </div>

        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Only events inside this window are stored, and only they can be matched. Days behind
          matters because a release always lands after the broadcast — a week or two is usually
          enough, longer if your feeds are slow.
        </p>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-3">
          <h3 className="label-mono">Default quality for new competitions</h3>
          <div className="rule flex-1" />
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
          Sports broadcasts are rarely posted above 1080p, and 4K is usually a different feed
          rather than a better one.
        </p>
        <QualityEditor
          value={config.quality}
          onChange={(quality) => setConfig({ ...config, quality })}
          kind="sport"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save sports settings
        </Button>
        <Button variant="secondary" onClick={sync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Refresh every calendar now
        </Button>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="label-mono">{label}</Label>
      {children}
    </div>
  );
}
