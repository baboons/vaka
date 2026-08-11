"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders server components on an interval.
 *
 * The watcher runs in another process, so the only way the UI learns that a
 * grab happened is to ask again. A soft refresh keeps client state (open
 * dialogs, half-typed forms) intact.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      // Pointless while the tab is hidden, and it keeps laptops asleep.
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
