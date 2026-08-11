"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { ChipToggle } from "@/components/quality-editor";

type Method = "web" | "file";
type Platform = "linux" | "docker" | "macos" | "windows";

const PLATFORMS: Array<{ value: Platform; label: string; path: string; command: string }> = [
  {
    value: "linux",
    label: "Linux",
    path: "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Preferences.xml",
    command:
      "sudo grep -o 'PlexOnlineToken=\"[^\"]*\"' \\\n  \"/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Preferences.xml\"",
  },
  {
    value: "docker",
    label: "Docker",
    path: "<config volume>/Library/Application Support/Plex Media Server/Preferences.xml",
    command:
      "docker exec plex grep -o 'PlexOnlineToken=\"[^\"]*\"' \\\n  \"/config/Library/Application Support/Plex Media Server/Preferences.xml\"",
  },
  {
    value: "macos",
    label: "macOS",
    path: "~/Library/Application Support/Plex Media Server/Preferences.xml",
    command:
      "grep -o 'PlexOnlineToken=\"[^\"]*\"' \\\n  \"$HOME/Library/Application Support/Plex Media Server/Preferences.xml\"",
  },
  {
    value: "windows",
    label: "Windows",
    path: "%LOCALAPPDATA%\\Plex Media Server\\Preferences.xml",
    command:
      "Select-String -Path \"$env:LOCALAPPDATA\\Plex Media Server\\Preferences.xml\" `\n  -Pattern 'PlexOnlineToken=\"[^\"]*\"'",
  },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="shrink-0 rounded-[3px] p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      aria-label="Copy command"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard access needs a secure context; over plain http on a LAN
          // it is blocked, so say so instead of failing silently.
          toast.error("Your browser blocked clipboard access — select and copy manually");
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-online" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mono mt-px flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-secondary text-[9.5px] font-semibold text-foreground/70">
        {n}
      </span>
      <span className="text-[12px] leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}

function Ui({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground/85">{children}</span>;
}

/** Two ways to get an X-Plex-Token, since neither suits everyone. */
export function PlexTokenHelp() {
  const [method, setMethod] = useState<Method>("web");
  const [platform, setPlatform] = useState<Platform>("linux");

  const selected = PLATFORMS.find((entry) => entry.value === platform)!;

  return (
    <div className="rounded-sm border border-border bg-secondary/20 p-3.5">
      <p className="label-mono mb-2.5">Where to find your token</p>

      <div className="mb-3.5 flex flex-wrap gap-1.5">
        <ChipToggle active={method === "web"} onClick={() => setMethod("web")}>
          Plex web app
        </ChipToggle>
        <ChipToggle active={method === "file"} onClick={() => setMethod("file")}>
          Server config file
        </ChipToggle>
      </div>

      {method === "web" ? (
        <div className="space-y-3">
          <ol className="space-y-1.5">
            <Step n={1}>
              Open Plex Web — <span className="mono text-foreground/70">app.plex.tv</span>, or{" "}
              <span className="mono text-foreground/70">http://your-server:32400/web</span>
            </Step>
            <Step n={2}>Click any movie or episode</Step>
            <Step n={3}>
              Open the <Ui>⋯</Ui> (three dots) menu → <Ui>Get Info</Ui>
            </Step>
            <Step n={4}>
              In the dialog, click <Ui>View XML</Ui> (bottom-left)
            </Step>
            <Step n={5}>
              A new tab opens with raw XML. The <Ui>address bar</Ui> ends with your token:
            </Step>
          </ol>

          <div className="overflow-x-auto rounded-sm border border-border bg-background px-3 py-2">
            <code className="mono whitespace-nowrap text-[11.5px] text-muted-foreground">
              …?X-Plex-Token=
              <span className="text-signal">sX1zRk9mQ2pLvN4tYbHw</span>
            </code>
          </div>

          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Copy only the part after <span className="mono">X-Plex-Token=</span> — around 20
            letters and digits. Menu wording varies a little between Plex versions.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            No browser needed — read it straight off the machine running Plex. Look for{" "}
            <span className="mono text-foreground/70">PlexOnlineToken</span> in{" "}
            <span className="mono text-foreground/70">Preferences.xml</span>.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((entry) => (
              <ChipToggle
                key={entry.value}
                tone="info"
                active={platform === entry.value}
                onClick={() => setPlatform(entry.value)}
              >
                {entry.label}
              </ChipToggle>
            ))}
          </div>

          <div className="flex items-start gap-2 rounded-sm border border-border bg-background px-3 py-2">
            <span className="mono mt-0.5 shrink-0 text-signal">$</span>
            <pre className="mono min-w-0 flex-1 overflow-x-auto whitespace-pre text-[11.5px] leading-relaxed text-foreground/85">
              {selected.command}
            </pre>
            <CopyButton value={selected.command.replace(/\\\n\s*/g, "").replace(/`\n\s*/g, "")} />
          </div>

          <p className="break-all text-[11.5px] leading-snug text-muted-foreground">
            File: <span className="mono text-foreground/70">{selected.path}</span>
          </p>
        </div>
      )}
    </div>
  );
}
