"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Clapperboard,
  LayoutDashboard,
  Plus,
  Settings,
  Trophy,
  Tv,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tv", label: "TV shows", icon: Tv },
  { href: "/movies", label: "Movies", icon: Clapperboard },
  { href: "/sports", label: "Sports", icon: Trophy },
  { href: "/add", label: "Add", icon: Plus },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppNav({ horizontal = false }: { horizontal?: boolean }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  if (horizontal) {
    return (
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] font-medium transition-colors",
              isActive(item.href)
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon className="size-3.5" />
            {item.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex-1 space-y-0.5 p-3">
      {ITEMS.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-sm px-3 py-2 text-[13.5px] font-medium transition-colors",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            {/* Amber tick marks the current section, like a channel selector. */}
            <span
              className={cn(
                "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r bg-signal transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <item.icon
              className={cn(
                "size-4 transition-colors",
                active ? "text-signal" : "text-muted-foreground group-hover:text-foreground",
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
