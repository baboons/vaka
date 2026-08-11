"use client";

import { useEffect, useState } from "react";

function describe(iso: string, futureHint: boolean | undefined): string {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return "—";

  // Without an explicit hint, read the direction off the timestamp itself.
  const future = futureHint ?? target > Date.now();
  const deltaSeconds = Math.round((future ? target - Date.now() : Date.now() - target) / 1000);
  if (deltaSeconds < 0) return future ? "due now" : "just now";
  if (deltaSeconds < 45) return future ? `in ${deltaSeconds}s` : `${deltaSeconds}s ago`;

  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;

  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * A compact relative timestamp that keeps ticking.
 *
 * Server and client can round to different sides of a second, so hydration
 * warnings are suppressed for this one value.
 */
export function RelativeTime({
  value,
  future,
}: {
  value: string | null;
  /** Omit to decide from the timestamp; set it when the intent is fixed. */
  future?: boolean;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (!value) return <span className="text-muted-foreground">—</span>;

  return (
    <time dateTime={value} title={new Date(value).toLocaleString()} suppressHydrationWarning>
      {describe(value, future)}
    </time>
  );
}
