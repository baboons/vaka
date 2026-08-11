import { getDb } from "@/lib/core/db";
import { getWorkerState, isWorkerOnline } from "@/lib/core/settings";

import { AutoRefresh } from "./auto-refresh";
import { CheckFeedsButton } from "./check-feeds-button";
import { RelativeTime } from "./relative-time";

/**
 * Whether the background watcher is alive.
 *
 * The daemon writes a heartbeat every 30s; if it goes stale the UI says so,
 * because without the watcher nothing gets downloaded no matter how the
 * library is configured.
 */
export function WatcherStatus() {
  const state = getWorkerState(getDb());
  const online = isWorkerOnline(state);

  return (
    <div className="border-t border-border p-3">
      <AutoRefresh intervalMs={20_000} />

      <div className="panel px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={online ? "text-online" : "text-alert"}>
            <span className="signal-dot" />
          </span>
          <span className="label-mono text-foreground">
            {online ? "Watcher online" : "Watcher offline"}
          </span>
        </div>

        <dl className="mt-2.5 space-y-1">
          {online ? (
            <>
              <Row label="Last check" value={<RelativeTime value={state.lastPollAt} />} />
              <Row label="Next check" value={<RelativeTime value={state.nextPollAt} future />} />
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Start it with{" "}
              <code className="mono rounded-[3px] bg-secondary px-1 py-0.5 text-[10.5px] text-foreground">
                pnpm watch
              </code>{" "}
              — nothing downloads while it is stopped.
            </p>
          )}

          {state.lastError && (
            <p className="pt-1 text-[11px] leading-snug text-alert">{state.lastError}</p>
          )}
        </dl>
      </div>

      {online && <CheckFeedsButton />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="label-mono text-[9.5px]">{label}</dt>
      <dd className="mono text-[11px] text-foreground/80">{value}</dd>
    </div>
  );
}
