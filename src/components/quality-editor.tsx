"use client";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  RESOLUTIONS,
  RESOLUTION_LABELS,
  SOURCES,
  SOURCE_LABELS,
  type MediaKind,
  type QualityProfile,
  type Resolution,
  type Source,
} from "@/lib/core/types";

/** Best first — the order people think in when picking a quality. */
const RESOLUTION_ORDER = [...RESOLUTIONS].reverse();
const SOURCE_ORDER = [...SOURCES].filter((source) => source !== "unknown").reverse();

export function ChipToggle({
  active,
  onClick,
  children,
  tone = "signal",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "signal" | "info";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "mono rounded-[3px] border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors",
        active
          ? tone === "signal"
            ? "border-signal/50 bg-signal/15 text-signal"
            : "border-info/50 bg-info/15 text-info"
          : "border-border bg-secondary/40 text-muted-foreground hover:border-line-strong hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="label-mono">{label}</Label>
      {children}
      {hint && <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function wordsToText(words: string[]): string {
  return words.join(", ");
}

function textToWords(text: string): string[] {
  return text
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
}

export function QualityEditor({
  value,
  onChange,
  kind,
  compact = false,
}: {
  value: QualityProfile;
  onChange: (next: QualityProfile) => void;
  kind: MediaKind;
  compact?: boolean;
}) {
  const patch = (next: Partial<QualityProfile>) => onChange({ ...value, ...next });

  const toggleResolution = (resolution: Resolution) => {
    const allowed = value.allowed.includes(resolution)
      ? value.allowed.filter((item) => item !== resolution)
      : [...value.allowed, resolution];

    // The preferred quality must stay within what is allowed.
    const preferred =
      value.preferred && !allowed.includes(value.preferred)
        ? (allowed.slice().sort((a, b) => RESOLUTIONS.indexOf(b) - RESOLUTIONS.indexOf(a))[0] ??
          null)
        : value.preferred;

    patch({ allowed, preferred });
  };

  const toggleSource = (source: Source) => {
    patch({
      sources: value.sources.includes(source)
        ? value.sources.filter((item) => item !== source)
        : [...value.sources, source],
    });
  };

  const orderedAllowed = RESOLUTION_ORDER.filter((resolution) =>
    value.allowed.includes(resolution),
  );

  return (
    <div className="space-y-5">
      <Field
        label="Accepted qualities"
        hint={
          value.allowed.length
            ? "Releases outside this list are ignored."
            : "Nothing selected — every quality will be accepted."
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {RESOLUTION_ORDER.map((resolution) => (
            <ChipToggle
              key={resolution}
              active={value.allowed.includes(resolution)}
              onClick={() => toggleResolution(resolution)}
            >
              {RESOLUTION_LABELS[resolution]}
            </ChipToggle>
          ))}
        </div>
      </Field>

      {orderedAllowed.length > 1 && (
        <Field label="Preferred" hint="Picked first when several releases match.">
          <div className="flex flex-wrap gap-1.5">
            {orderedAllowed.map((resolution) => (
              <ChipToggle
                key={resolution}
                tone="info"
                active={value.preferred === resolution}
                onClick={() =>
                  patch({ preferred: value.preferred === resolution ? null : resolution })
                }
              >
                {RESOLUTION_LABELS[resolution]}
              </ChipToggle>
            ))}
          </div>
        </Field>
      )}

      <div className="space-y-3">
        <ToggleRow
          label="Upgrade when a better release appears"
          hint="Re-downloads at a higher quality until the preferred one is reached."
          checked={value.upgrade}
          onCheckedChange={(upgrade) => patch({ upgrade })}
        />

        {kind === "tv" && (
          <ToggleRow
            label="Allow season packs"
            hint="Grabs whole-season torrents when individual episodes are wanted."
            checked={value.allowSeasonPacks}
            onCheckedChange={(allowSeasonPacks) => patch({ allowSeasonPacks })}
          />
        )}
      </div>

      {!compact && (
        <>
          <Field
            label="Accepted sources"
            hint="Leave empty to accept any source. Releases with an unrecognisable source are always allowed through."
          >
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_ORDER.map((source) => (
                <ChipToggle
                  key={source}
                  active={value.sources.includes(source)}
                  onClick={() => toggleSource(source)}
                >
                  {SOURCE_LABELS[source]}
                </ChipToggle>
              ))}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Min seeders">
              <Input
                type="number"
                min={0}
                className="mono"
                value={value.minSeeders}
                onChange={(event) =>
                  patch({ minSeeders: Math.max(0, Number(event.target.value) || 0) })
                }
              />
            </Field>
            <Field label="Max size (GB)">
              <Input
                type="number"
                min={0}
                step="0.5"
                className="mono"
                value={value.maxSizeGb}
                onChange={(event) =>
                  patch({ maxSizeGb: Math.max(0, Number(event.target.value) || 0) })
                }
              />
            </Field>
            <Field label="Min size (MB)">
              <Input
                type="number"
                min={0}
                className="mono"
                value={value.minSizeMb}
                onChange={(event) =>
                  patch({ minSizeMb: Math.max(0, Number(event.target.value) || 0) })
                }
              />
            </Field>
          </div>
          <p className="-mt-2 text-[11.5px] text-muted-foreground">
            Set a limit to 0 to disable it.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Must contain" hint="Comma separated.">
              <Input
                value={wordsToText(value.requiredWords)}
                placeholder="e.g. NORDiC"
                onChange={(event) => patch({ requiredWords: textToWords(event.target.value) })}
              />
            </Field>
            <Field label="Never contain" hint="Comma separated, matched as whole words.">
              <Input
                value={wordsToText(value.bannedWords)}
                placeholder="e.g. cam, hdts"
                onChange={(event) => patch({ bannedWords: textToWords(event.target.value) })}
              />
            </Field>
            <Field label="Prefer" hint="Scored higher, never required.">
              <Input
                value={wordsToText(value.preferredWords)}
                placeholder="e.g. NTb, FLUX"
                onChange={(event) => patch({ preferredWords: textToWords(event.target.value) })}
              />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
