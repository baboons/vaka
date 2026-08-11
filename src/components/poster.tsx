import Image from "next/image";
import { Clapperboard, Tv } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MediaKind } from "@/lib/core/types";

/**
 * Poster art in a fixed 2:3 frame.
 *
 * Providers occasionally return nothing, so the fallback has to look
 * deliberate rather than broken.
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
  const Icon = kind === "tv" ? Tv : Clapperboard;

  return (
    <div className={cn("poster-frame", className)}>
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
          // Provider art is fetched over the network and may 404 later.
          unoptimized={false}
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
