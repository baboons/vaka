"use client";

import { useState, useTransition } from "react";
import { FolderSearch, Loader2, Save, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { analyseLibrary, saveLibraryNaming } from "@/app/actions";
import { Pill } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { previewDestination, type NamingTemplates } from "@/lib/core/naming";
import type { LibraryReport } from "@/lib/core/inspect-library";
import type { KindConfig } from "@/lib/core/settings";
import type { MediaKind } from "@/lib/core/types";

const TOKENS = [
  "{title}",
  "{year}",
  "{season}",
  "{season:00}",
  "{episode}",
  "{episode:00}",
  "{episodeTitle}",
  "{airDate}",
  "{quality}",
  "{group}",
];

/**
 * Destination folder and naming for one library, with a live preview.
 *
 * "Analyse" reads what is already on disk and proposes templates that match
 * it, rather than renaming a library someone has kept tidy for years.
 */
const FOLDER_LABELS: Record<MediaKind, string> = {
  tv: "TV library folder",
  movie: "Movie library folder",
  sport: "Sports library folder",
};

const FOLDER_PLACEHOLDERS: Record<MediaKind, string> = {
  tv: "e.g. /media/TV",
  movie: "e.g. /media/Movies",
  sport: "e.g. /media/Sports",
};

const FILED_NOUNS: Record<MediaKind, string> = {
  tv: "episodes",
  movie: "films",
  sport: "events",
};

const SAVE_LABELS: Record<MediaKind, string> = {
  tv: "TV",
  movie: "movie",
  sport: "sports",
};

export function LibraryNamingForm({ kind, initial }: { kind: MediaKind; initial: KindConfig }) {
  const [libraryDir, setLibraryDir] = useState(initial.libraryDir);
  const [templates, setTemplates] = useState<NamingTemplates>({
    folder: initial.folderTemplate,
    season: initial.seasonTemplate,
    file: initial.fileTemplate,
  });
  const [report, setReport] = useState<LibraryReport | null>(null);
  const [saving, startSaving] = useTransition();
  const [analysing, startAnalysing] = useTransition();

  const preview = previewDestination(kind, libraryDir, templates);

  const save = () =>
    startSaving(async () => {
      const result = await saveLibraryNaming(kind, {
        libraryDir,
        folderTemplate: templates.folder,
        seasonTemplate: templates.season,
        fileTemplate: templates.file,
      });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });

  const analyse = () =>
    startAnalysing(async () => {
      const result = await analyseLibrary(kind, libraryDir);
      setReport(result.report ?? null);
      if (result.ok) toast.success("Read your library — see what vaka found below");
      else toast.error(result.message);
    });

  const applyProposal = () => {
    if (!report) return;
    setTemplates(report.proposed);
    toast.success("Templates set to match your library — save to keep them");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="label-mono flex items-center gap-2">
          {FOLDER_LABELS[kind]}
          {/*
            An empty path is easy to mistake for the placeholder, and the
            consequence is silent: imports are skipped with "no library folder
            is configured". Say so on the label itself.
          */}
          {!libraryDir.trim() && <Pill tone="alert">not set</Pill>}
        </Label>
        <div className="flex gap-2">
          <Input
            value={libraryDir}
            onChange={(event) => setLibraryDir(event.target.value)}
            placeholder={FOLDER_PLACEHOLDERS[kind]}
            className="mono text-[12.5px]"
          />
          <Button
            variant="secondary"
            onClick={analyse}
            disabled={analysing || !libraryDir.trim()}
          >
            {analysing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderSearch className="size-3.5" />
            )}
            Analyse
          </Button>
        </div>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Where Plex reads this library from.{" "}
          {libraryDir.trim() ? (
            <>Finished {FILED_NOUNS[kind]} are filed in here.</>
          ) : (
            <span className="text-alert">
              While this is empty, {FILED_NOUNS[kind]} are downloaded but never
              filed — imports are skipped with “no library folder is configured”.
            </span>
          )}
        </p>
      </div>

      {report && (
        <div className="rounded-sm border border-border bg-secondary/20 p-3.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="label-mono">What vaka found</p>
            {report.exists && <Pill tone="online">{report.titleCount} folders</Pill>}
            {report.seasonStyles.map((style) => (
              <Pill key={style.example} tone="info">
                {style.example} ×{style.count}
              </Pill>
            ))}
          </div>

          <p className="text-[12px] leading-relaxed text-muted-foreground">{report.summary}</p>

          {report.samples.length > 0 && (
            <p className="mono mt-2 truncate text-[11px] text-muted-foreground/80">
              e.g. {report.samples.slice(0, 3).join("  ·  ")}
            </p>
          )}

          <Button size="sm" variant="secondary" className="mt-3" onClick={applyProposal}>
            <Wand2 className="size-3.5" />
            Use these conventions
          </Button>
        </div>
      )}

      <div className="space-y-4">
        <TemplateField
          label="Title folder"
          value={templates.folder}
          onChange={(folder) => setTemplates({ ...templates, folder })}
        />
        {kind !== "movie" && (
          <TemplateField
            label={kind === "sport" ? "Year folder" : "Season folder"}
            hint={
              kind === "sport"
                ? "Created automatically. Sports events are grouped by the year they belong to."
                : "Created automatically when a season has no folder yet."
            }
            value={templates.season}
            onChange={(season) => setTemplates({ ...templates, season })}
          />
        )}
        <TemplateField
          label="File name"
          value={templates.file}
          onChange={(file) => setTemplates({ ...templates, file })}
        />

        <div className="space-y-1.5">
          <p className="label-mono">Available tokens</p>
          <div className="flex flex-wrap gap-1">
            {TOKENS.map((token) => (
              <code
                key={token}
                className="mono rounded-[3px] border border-border bg-background px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
              >
                {token}
              </code>
            ))}
          </div>
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            <span className="mono">{"{season:00}"}</span> pads to two digits;{" "}
            <span className="mono">{"{season}"}</span> does not. Empty values disappear along
            with any brackets around them.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="label-mono">Preview</p>
        {/*
          The root is shown above rather than inline: library paths are long,
          and the part being edited is the part below it.
        */}
        <div className="rounded-sm border border-border bg-background px-3 py-2.5">
          <p className="mono truncate text-[11px] text-muted-foreground" title={libraryDir}>
            {libraryDir || "…"}/
          </p>
          <p className="mono mt-1 break-all text-[12px] text-signal">{preview}</p>
        </div>
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Save {SAVE_LABELS[kind]} naming
      </Button>
    </div>
  );
}

function TemplateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="label-mono">{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mono text-[12.5px]"
      />
      {hint && <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
