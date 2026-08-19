"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, Plus, Rss, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import { addFeed, deleteFeed, testFeed, updateFeedSettings } from "@/app/actions";
import { Pill } from "@/components/bits";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Feed, MediaKind } from "@/lib/core/types";

const KINDS: Array<{ value: MediaKind | "any"; label: string }> = [
  { value: "any", label: "Everything" },
  { value: "tv", label: "TV only" },
  { value: "movie", label: "Movies only" },
  { value: "sport", label: "Sports only" },
];

export function FeedManager({ feeds }: { feeds: Feed[] }) {
  return (
    <div className="space-y-5">
      {feeds.length > 0 && (
        <ul className="panel divide-y divide-border">
          {feeds.map((feed) => (
            <FeedRow key={feed.id} feed={feed} />
          ))}
        </ul>
      )}

      <AddFeedForm hasFeeds={feeds.length > 0} />
    </div>
  );
}

function FeedRow({ feed }: { feed: Feed }) {
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const failing = feed.enabled && feed.lastStatus === "error";

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Rss
          className={cn(
            "mt-0.5 size-4 shrink-0",
            failing ? "text-alert" : feed.enabled ? "text-online" : "text-muted-foreground",
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13.5px] font-medium">{feed.name}</p>
            <Pill>{KINDS.find((kind) => kind.value === feed.kind)?.label ?? feed.kind}</Pill>
            {!feed.enabled && <Pill>disabled</Pill>}
            {failing && <Pill tone="alert">failing</Pill>}
          </div>

          <p className="mono mt-1 truncate text-[11px] text-muted-foreground">{feed.url}</p>

          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {feed.lastCheckedAt ? (
              <>
                Checked <RelativeTime value={feed.lastCheckedAt} />
                {feed.lastStatus === "ok" && ` · ${feed.itemCount} releases`}
              </>
            ) : (
              "Not checked yet"
            )}
          </p>

          {failing && feed.lastError && (
            <p className="mt-1 text-[11.5px] text-alert">{feed.lastError}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={testing}
            onClick={() =>
              startTesting(async () => {
                const result = await testFeed(feed.url);
                if (result.ok) toast.success(result.message);
                else toast.error(result.message);
              })
            }
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          </Button>

          <Switch
            checked={feed.enabled}
            aria-label={`Enable ${feed.name}`}
            disabled={pending}
            onCheckedChange={(enabled) =>
              startTransition(async () => {
                await updateFeedSettings(feed.id, { enabled });
              })
            }
          />

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-alert/10 hover:text-alert"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteFeed(feed.id);
                toast.success(result.message);
              })
            }
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

function AddFeedForm({ hasFeeds }: { hasFeeds: boolean }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<MediaKind | "any">("any");
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await addFeed({ name, url, kind });
      if (result.ok) {
        toast.success(result.message);
        setName("");
        setUrl("");
      } else {
        toast.error(result.message);
      }
    });

  return (
    <form
      className="panel space-y-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="label-mono">{hasFeeds ? "Add another feed" : "Add your first feed"}</p>

      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <div className="space-y-1.5">
          <Label className="label-mono text-[9px]">Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My tracker"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="label-mono text-[9px]">RSS URL</Label>
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://tracker.example/rss?passkey=…"
            className="mono text-[12.5px]"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="label-mono text-[9px]">This feed carries</Label>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              aria-pressed={kind === option.value}
              className={cn(
                "mono rounded-[3px] border px-2.5 py-1.5 text-[11px] uppercase tracking-[0.06em] transition-colors",
                kind === option.value
                  ? "border-signal/50 bg-signal/15 text-signal"
                  : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="pt-1 text-[11.5px] leading-snug text-muted-foreground">
          Restricting a feed stops movie releases matching a show of the same name, and vice
          versa.
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !name.trim() || !url.trim()}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add feed
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={testing || !url.trim()}
          onClick={() =>
            startTesting(async () => {
              const result = await testFeed(url);
              if (result.ok) toast.success(result.message);
              else toast.error(result.message);
            })
          }
        >
          {testing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          Test without saving
        </Button>
      </div>
    </form>
  );
}
