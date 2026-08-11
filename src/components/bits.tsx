import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Page title block. The mono eyebrow keeps the control-room register. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="grid-texture border-b border-border">
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-6 md:px-8 md:py-8">
        <div className="min-w-0">
          {eyebrow && <p className="label-mono mb-2">{eyebrow}</p>}
          <h1 className="text-[26px] font-bold leading-none tracking-[-0.02em] md:text-[32px]">
            {title}
          </h1>
          {description && (
            <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const PILL_TONES = {
  neutral: "border-border bg-secondary text-muted-foreground",
  signal: "border-signal/30 bg-signal/10 text-signal",
  online: "border-online/30 bg-online/10 text-online",
  alert: "border-alert/30 bg-alert/10 text-alert",
  info: "border-info/30 bg-info/10 text-info",
} as const;

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof PILL_TONES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mono inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        {description && (
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** A labelled number, used across the dashboard and detail headers. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "signal" | "online" | "alert";
}) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="label-mono">{label}</p>
      <p
        className={cn(
          "mono mt-1.5 text-[22px] font-semibold leading-none tracking-tight",
          tone === "signal" && "text-signal",
          tone === "online" && "text-online",
          tone === "alert" && "text-alert",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="label-mono text-foreground/70">{children}</h2>
      {action}
    </div>
  );
}
