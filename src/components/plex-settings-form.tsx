"use client";

import { useState, useTransition } from "react";
import { Loader2, PlugZap, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import { requestPlexSync, savePlexSettings, testPlexConnection } from "@/app/actions";
import { Pill } from "@/components/bits";
import { PlexTokenHelp } from "@/components/plex-token-help";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PlexConfig, PlexState } from "@/lib/core/settings";

export function PlexSettingsForm({
  initial,
  state,
}: {
  initial: PlexConfig;
  state: PlexState;
}) {
  const [config, setConfig] = useState<PlexConfig>(initial);
  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();
  const [syncing, startSyncing] = useTransition();

  const act = (
    start: typeof startSaving,
    run: () => Promise<{ ok: boolean; message: string }>,
  ) =>
    start(async () => {
      const result = await run();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  return (
    <div className="space-y-6">
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-medium">Use my Plex library</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            Anything Plex already has is crossed off, so the watcher stops looking for it.
            tvarr only reads — it never changes anything in Plex.
          </span>
        </span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
        />
      </label>

      <div className="space-y-2">
        <Label className="label-mono">Server address</Label>
        <Input
          value={config.url}
          onChange={(event) => setConfig({ ...config, url: event.target.value })}
          placeholder="http://192.168.1.10:32400"
          className="mono text-[12.5px]"
        />
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Use the server&apos;s address on your network. Plain{" "}
          <span className="mono">http</span> is fine on a LAN and avoids certificate trouble.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="label-mono">Plex token</Label>
        <Input
          value={config.token}
          onChange={(event) => setConfig({ ...config, token: event.target.value })}
          placeholder="X-Plex-Token"
          type="password"
          autoComplete="off"
          className="mono text-[12.5px]"
        />
        <PlexTokenHelp />
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Treat this like a password — it grants full access to your Plex account. tvarr keeps it
          in plain text in its database, so that file deserves the same care as an SSH key.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="label-mono">Scan every</Label>
        <div className="relative w-40">
          <Input
            type="number"
            min={5}
            max={1440}
            value={config.syncIntervalMinutes}
            className="mono pr-16"
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                setConfig({
                  ...config,
                  syncIntervalMinutes: Math.min(1440, Math.max(5, next)),
                });
              }
            }}
          />
          <span className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            min
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => act(startSaving, () => savePlexSettings(config))} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>

        <Button
          variant="secondary"
          disabled={testing || !config.url.trim() || !config.token.trim()}
          onClick={() => act(startTesting, () => testPlexConnection(config))}
        >
          {testing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <PlugZap className="size-3.5" />
          )}
          Test connection
        </Button>

        <Button
          variant="ghost"
          disabled={syncing || !initial.enabled}
          onClick={() => act(startSyncing, () => requestPlexSync())}
        >
          {syncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Scan now
        </Button>
      </div>

      <div className="rule" />

      <div>
        <p className="label-mono mb-2">Last scan</p>
        {state.lastSyncAt ? (
          <div className="space-y-1.5">
            <p className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <Pill tone={state.lastStatus === "ok" ? "online" : "alert"}>
                {state.lastStatus === "ok" ? "ok" : "failed"}
              </Pill>
              <span className="mono text-muted-foreground">
                <RelativeTime value={state.lastSyncAt} />
              </span>
              {state.serverName && (
                <span className="text-muted-foreground">on {state.serverName}</span>
              )}
            </p>

            {state.lastStatus === "ok" ? (
              <p className="text-[12px] text-muted-foreground">
                Matched {state.matchedTitles} title{state.matchedTitles === 1 ? "" : "s"} · crossed
                off {state.markedEpisodes} episode{state.markedEpisodes === 1 ? "" : "s"} and{" "}
                {state.markedMovies} movie{state.markedMovies === 1 ? "" : "s"} in total.
              </p>
            ) : (
              <p className="text-[12px] text-alert">{state.lastError}</p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No scan yet. The watcher runs one as soon as Plex is turned on.
          </p>
        )}
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Scanning only ever marks things as already had — it never marks something wanted again.
        That way a Plex server that is offline, mid-scan or missing a drive can never trigger a
        wave of re-downloads. To want something again, use the episode or movie controls.
      </p>
    </div>
  );
}
