"use client";

import { useState, useTransition } from "react";
import { FolderCheck, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { saveLibrarySettings, verifyDownloadDir } from "@/app/actions";
import { QualityEditor } from "@/components/quality-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { KindConfig } from "@/lib/core/settings";
import type { MediaKind } from "@/lib/core/types";

/**
 * Per-library configuration. TV and movies each get their own copy of this,
 * which is the point — different folders and different quality targets.
 */
export function LibrarySettingsForm({
  kind,
  initial,
}: {
  kind: MediaKind;
  initial: KindConfig;
}) {
  const [config, setConfig] = useState<KindConfig>(initial);
  const [pending, startTransition] = useTransition();
  const [checking, startChecking] = useTransition();

  const noun = kind === "tv" ? "episodes" : "movies";

  const save = () =>
    startTransition(async () => {
      const result = await saveLibrarySettings(kind, config);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  const verify = () =>
    startChecking(async () => {
      const result = await verifyDownloadDir(config.downloadDir);
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
            placeholder="~/Downloads/tvarr"
            className="mono text-[12.5px]"
          />
          <Button variant="secondary" onClick={verify} disabled={checking}>
            {checking ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderCheck className="size-3.5" />
            )}
            Check
          </Button>
        </div>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Matching {noun} are written here as <span className="mono">.torrent</span> files. Point
          your torrent client&apos;s watch folder at the same path and it will pick them up.
          <span className="mono"> ~</span> expands to your home folder.
        </p>
      </div>

      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-medium">Create a folder per title</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            {config.createFolders
              ? "Files go into a subfolder named after the show or film."
              : "All files land directly in the download folder."}
          </span>
        </span>
        <Switch
          checked={config.createFolders}
          onCheckedChange={(createFolders) => setConfig({ ...config, createFolders })}
        />
      </label>

      <div>
        <div className="mb-3 flex items-center gap-3">
          <h3 className="label-mono">Default quality for new {kind === "tv" ? "shows" : "movies"}</h3>
          <div className="rule flex-1" />
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
          Applied when you add something new. Each title keeps its own copy afterwards, so
          changing this does not touch what you already follow.
        </p>
        <QualityEditor
          value={config.quality}
          onChange={(quality) => setConfig({ ...config, quality })}
          kind={kind}
        />
      </div>

      <Button onClick={save} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Save {kind === "tv" ? "TV" : "movie"} settings
      </Button>
    </div>
  );
}
