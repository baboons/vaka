"use client";

import { useState } from "react";
import Image from "next/image";
import { Clapperboard, Tv } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MediaKind } from "@/lib/core/types";

/**
 * Poster art in a fixed 2:3 frame.
 *
 * Providers hand out URLs that 404 — Cinemeta in particular lists titles whose
 * artwork has gone — so a failed load falls back to the same placeholder as a
 * missing URL rather than leaving a broken image icon on the page.
 */
export function Poster({
  src,
  alt,
  kind,
  sizes = "(min-width: 1280px) 180px, (min-width: 768px) 20vw, 40vw",
  className,
  priority = false,
}: {
  src: string | null;
  alt: string;
  kind: MediaKind;
  sizes?: string;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = kind === "tv" ? Tv : Clapperboard;

  return (
    <div className={cn("poster-frame", className)}>
      {src && !failed ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-surface-high to-surface p-3">
          <Icon className="size-6 text-muted-foreground/40" />
          <span className="label-mono line-clamp-3 text-center text-[9px] leading-tight">
            {alt}
          </span>
        </div>
      )}
    </div>
  );
}
