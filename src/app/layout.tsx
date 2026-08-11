import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";

import { AppNav } from "@/components/app-nav";
import { LogoMark } from "@/components/logo";
import { WatcherStatus } from "@/components/watcher-status";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "tvarr — release watcher",
  description:
    "Follow TV shows and movies, watch your torrent RSS feeds and download the qualities you want.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
            <div className="grid-texture border-b border-border px-5 py-5">
              <Wordmark />
            </div>
            <AppNav />
            <WatcherStatus />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="grid-texture sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur md:hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <Wordmark compact />
              </div>
              <AppNav horizontal />
            </header>

            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>

        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}

/** The mark plus the name, the one piece of branding in the interface. */
function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className="size-6 shrink-0" />
      <span className="leading-none">
        <span className="block text-[17px] font-bold tracking-[-0.02em] text-foreground">
          tvarr
        </span>
        {!compact && (
          <span className="label-mono mt-1 block text-[9px]">Release watcher</span>
        )}
      </span>
    </div>
  );
}
