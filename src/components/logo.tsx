import { cn } from "@/lib/utils";

/**
 * The vaka mark: the app's own live-signal indicator — a dark core inside a
 * broken scanner ring, on a signal-amber tile.
 *
 * Kept in sync with `public/logo.svg` and `src/app/icon.svg` (the favicon).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-6", className)}
      role="img"
      aria-label="vaka"
    >
      <defs>
        <linearGradient id="vaka-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFC65B" />
          <stop offset="0.55" stopColor="#F5A524" />
          <stop offset="1" stopColor="#E8930C" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="15" fill="url(#vaka-tile)" />
      <path
        d="M15 1.5h34"
        stroke="#FFFFFF"
        strokeOpacity="0.38"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      <g stroke="#17120A" fill="#17120A">
        {/* 30/17.12 dash on a 94.25 circumference gives two arcs, evenly gapped. */}
        <circle
          cx="32"
          cy="32"
          r="15"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="30 17.12"
          transform="rotate(-45 32 32)"
        />
        <circle cx="32" cy="32" r="6.75" />
      </g>
    </svg>
  );
}
