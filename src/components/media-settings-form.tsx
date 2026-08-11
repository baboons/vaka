"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { updateMediaSettings } from "@/app/actions";
import { QualityEditor } from "@/components/quality-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Media } from "@/lib/core/types";

/** Per-title overrides: quality, destination folder and extra search titles. */
export function MediaSettingsForm({ media }: { media: Media }) {
  const [quality, setQuality] = useState(media.quality);
  const [folder, setFolder] = useState(media.folder ?? "");
  const [searchTerms, setSearchTerms] = useState(media.searchTerms.join(", "));
  const [pending, startTransition] = useTransition();

  const dirty =
    JSON.stringify(quality) !== JSON.stringify(media.quality) ||
    folder !== (media.folder ?? "") ||
    searchTerms !== media.searchTerms.join(", ");

  const save = () => {
    startTransition(async () => {
      const result = await updateMediaSettings(media.id, {
        quality,
        folder: folder.trim() || null,
        searchTerms: searchTerms
          .split(",")
          .map((term) => term.trim())
          .filter(Boolean),
      });
      if (result.ok) toast.success("Saved — re-checking cached releases");
      else toast.error(result.message);
    });
  };

  return (
    <div className="space-y-6">
      <QualityEditor value={quality} onChange={setQuality} kind={media.kind} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="label-mono">Also match these titles</Label>
          <Input
            value={searchTerms}
            onChange={(event) => setSearchTerms(event.target.value)}
            placeholder="Alternative or original title"
          />
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Comma separated. Useful when releases use a different name than{" "}
            <span className="text-foreground/80">{media.title}</span>.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="label-mono">Download folder override</Label>
          <Input
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="Leave empty to use the library default"
            className="mono text-[12.5px]"
          />
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Absolute path. Overrides the {media.kind === "tv" ? "TV" : "movie"} download folder
            for this title only.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save changes
        </Button>
        {dirty && !pending && (
          <span className="mono text-[11px] text-signal">unsaved changes</span>
        )}
      </div>
    </div>
  );
}
