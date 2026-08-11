"use client";

import { useState, useTransition } from "react";
import { Loader2, PlugZap, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import {
  requestImportScan,
  saveImportSettings,
  saveTransmissionSettings,
  testTransmission,
} from "@/app/actions";
import { Pill } from "@/components/bits";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ImportRecord } from "@/lib/core/repo";
import type { ImportConfig, TransmissionConfig } from "@/lib/core/settings";

const MODES: Array<{ value: ImportConfig["mode"]; label: string; hint: string }> = [
  {
    value: "hardlink",
    label: "Hardlink",
    hint: "No extra disk space, and the torrent keeps seeding. Falls back to a copy across drives.",
  },
  {
    value: "copy",
    label: "Copy",
    hint: "Duplicates the file. Seeding continues, but the space is used twice.",
  },
  {
    value: "move",
    label: "Move",
    hint: "Frees the space immediately, but the torrent stops seeding.",
  },
];

export function ImportSettingsForm({
  initial,
  transmission,
  recent,
}: {
  initial: ImportConfig;
  transmission: TransmissionConfig;
  recent: ImportRecord[];
}) {
  const [config, setConfig] = useState<ImportConfig>(initial);
  const [client, setClient] = useState<TransmissionConfig>(transmission);
  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();
  const [scanning, startScanning] = useTransition();

  const run = (
    start: typeof startSaving,
    action: () => Promise<{ ok: boolean; message: string }>,
  ) =>
    start(async () => {
      const result = await action();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  return (
    <div className="space-y-7">
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-medium">
            File finished downloads into my library
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            Renames each finished download into the Plex layout you set under TV and Movies,
            creating season folders as needed.
          </span>
        </span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
        />
      </label>

      <div className="space-y-2">
        <Label className="label-mono">How to place files</Label>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setConfig({ ...config, mode: mode.value })}
              aria-pressed={config.mode === mode.value}
              className={cn(
                "rounded-sm border px-3 py-2.5 text-left transition-colors",
                config.mode === mode.value
                  ? "border-signal/50 bg-signal/10"
                  : "border-border bg-secondary/30 hover:border-line-strong",
              )}
            >
              <span
                className={cn(
                  "block text-[13px] font-medium",
                  config.mode === mode.value && "text-signal",
                )}
              >
                {mode.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                {mode.hint}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="label-mono">Watch folder (optional)</Label>
          <Input
            value={config.watchDir}
            onChange={(event) => setConfig({ ...config, watchDir: event.target.value })}
            placeholder="/downloads/complete"
            className="mono text-[12.5px]"
          />
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Anything that appears here is filed. Leave empty if Transmission tells tvarr about
            finished downloads instead.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="label-mono">Ignore below</Label>
            <div className="relative">
              <Input
                type="number"
                min={0}
                value={config.minSizeMb}
                className="mono pr-12"
                onChange={(event) =>
                  setConfig({ ...config, minSizeMb: Math.max(0, Number(event.target.value) || 0) })
                }
              />
              <span className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                MB
              </span>
            </div>
            <p className="text-[11.5px] leading-snug text-muted-foreground">Skips samples.</p>
          </div>

          <div className="space-y-2">
            <Label className="label-mono">Scan every</Label>
            <div className="relative">
              <Input
                type="number"
                min={1}
                max={1440}
                value={config.scanIntervalMinutes}
                className="mono pr-12"
                onChange={(event) =>
                  setConfig({
                    ...config,
                    scanIntervalMinutes: Math.min(1440, Math.max(1, Number(event.target.value) || 1)),
                  })
                }
              />
              <span className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                min
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run(startSaving, () => saveImportSettings(config))} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
        <Button
          variant="ghost"
          disabled={scanning || !initial.enabled}
          onClick={() => run(startScanning, () => requestImportScan())}
        >
          {scanning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Scan now
        </Button>
      </div>

      <div className="rule" />

      {/* ---------------- Retiring finished torrents ---------------- */}

      <div className="space-y-4">
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">
              Retire torrents once they have seeded enough
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
              Removes the torrent from Transmission and clears the download folder. Your library
              copy is kept.
            </span>
          </span>
          <Switch
            checked={config.cleanupEnabled}
            onCheckedChange={(cleanupEnabled) => setConfig({ ...config, cleanupEnabled })}
          />
        </label>

        {config.cleanupEnabled && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="label-mono">After seeding for</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    value={config.cleanupAfterDays}
                    className="mono pr-14"
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        cleanupAfterDays: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                  <span className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                    days
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="label-mono">Or once the ratio reaches</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={config.cleanupMinRatio}
                  className="mono"
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      cleanupMinRatio: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                />
              </div>
            </div>

            <p className="text-[11.5px] leading-snug text-muted-foreground">
              Set either to <span className="mono">0</span> to ignore it. With both at 0 nothing
              is ever retired.
            </p>

            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
              <span>
                <span className="block text-[13px] font-medium">Require both, not either</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                  {config.cleanupRequireBoth
                    ? "Waits for the days and the ratio."
                    : "Retires on whichever comes first, which is how trackers usually word their rules."}
                </span>
              </span>
              <Switch
                checked={config.cleanupRequireBoth}
                onCheckedChange={(cleanupRequireBoth) =>
                  setConfig({ ...config, cleanupRequireBoth })
                }
              />
            </label>

            <div className="rounded-sm border border-border bg-background px-3 py-2.5">
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {config.mode === "hardlink" ? (
                  <>
                    With <span className="text-foreground/80">hardlink</span>, the download and
                    the library file are the same data on disk, so retiring frees no space — it
                    ends seeding and clears the download folder. It does free space when the
                    hardlink had to fall back to a copy across drives.
                  </>
                ) : config.mode === "copy" ? (
                  <>
                    With <span className="text-foreground/80">copy</span>, retiring deletes the
                    duplicate and genuinely frees the space.
                  </>
                ) : (
                  <>
                    With <span className="text-foreground/80">move</span>, the download is
                    already gone; retiring only clears the dead torrent out of Transmission.
                  </>
                )}
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Only torrents tvarr imported are touched, and never before checking the library
                copy is still there.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="rule" />

      {/* ---------------- Transmission ---------------- */}

      <div className="space-y-5">
        <div>
          <h3 className="text-[14px] font-semibold">Transmission</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            tvarr asks Transmission which downloads have finished, so files are filed as soon as
            they complete. Nothing needs to change in Transmission beyond having remote access
            enabled.
          </p>
        </div>

        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
          <span className="text-[13px] font-medium">Ask Transmission about finished downloads</span>
          <Switch
            checked={client.enabled}
            onCheckedChange={(enabled) => setClient({ ...client, enabled })}
          />
        </label>

        <div className="space-y-2">
          <Label className="label-mono">RPC address</Label>
          <Input
            value={client.url}
            onChange={(event) => setClient({ ...client, url: event.target.value })}
            placeholder="http://localhost:9091/transmission/rpc"
            className="mono text-[12.5px]"
          />
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            <span className="mono">localhost:9091</span> works too — tvarr adds the rest.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="label-mono">Username</Label>
            <Input
              value={client.username}
              autoComplete="off"
              onChange={(event) => setClient({ ...client, username: event.target.value })}
              placeholder="Only if you set one"
            />
          </div>
          <div className="space-y-2">
            <Label className="label-mono">Password</Label>
            <Input
              type="password"
              value={client.password}
              autoComplete="off"
              onChange={(event) => setClient({ ...client, password: event.target.value })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="label-mono">Path mapping (only if paths differ)</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={client.remotePathPrefix}
              onChange={(event) => setClient({ ...client, remotePathPrefix: event.target.value })}
              placeholder="Transmission sees /downloads"
              className="mono text-[12.5px]"
            />
            <Input
              value={client.localPathPrefix}
              onChange={(event) => setClient({ ...client, localPathPrefix: event.target.value })}
              placeholder="tvarr sees /mnt/nas/downloads"
              className="mono text-[12.5px]"
            />
          </div>
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Needed when Transmission runs in a container or on another machine. Leave both empty
            when they share a filesystem.
          </p>
        </div>

        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">
              Also import what is already finished
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
              Off by default: connecting tvarr to a client with years of history should not
              suddenly file years of downloads. Existing torrents are noted and left alone.
            </span>
          </span>
          <Switch
            checked={client.importExisting}
            onCheckedChange={(importExisting) => setClient({ ...client, importExisting })}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => run(startSaving, () => saveTransmissionSettings(client))}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save Transmission
          </Button>
          <Button
            variant="secondary"
            disabled={testing || !client.url.trim()}
            onClick={() => run(startTesting, () => testTransmission(client))}
          >
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PlugZap className="size-3.5" />
            )}
            Test connection
          </Button>
        </div>
      </div>

      {recent.length > 0 && (
        <>
          <div className="rule" />
          <div>
            <p className="label-mono mb-2">Recently filed</p>
            <ul className="panel divide-y divide-border">
              {recent.slice(0, 8).map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-3 py-2">
                  <Pill
                    tone={
                      entry.status === "done"
                        ? "online"
                        : entry.status === "failed"
                          ? "alert"
                          : "neutral"
                    }
                    className="mt-0.5 shrink-0"
                  >
                    {entry.status === "done" ? `${entry.fileCount} file` : entry.status}
                  </Pill>
                  <div className="min-w-0 flex-1">
                    <p className="mono truncate text-[11.5px] text-foreground/85">{entry.name}</p>
                    {entry.detail && (
                      <p className="truncate text-[11px] text-muted-foreground">{entry.detail}</p>
                    )}
                  </div>
                  <span className="mono shrink-0 text-[10.5px] text-muted-foreground">
                    <RelativeTime value={entry.createdAt} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
