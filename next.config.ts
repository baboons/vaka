import os from "node:os";

import type { NextConfig } from "next";

/**
 * Origins allowed to load dev assets (`/_next/*`, the HMR socket).
 *
 * Next only trusts localhost by default, so opening the dev server from
 * another machine on the LAN returns 403 for every chunk and the HMR
 * websocket fails. tvarr is normally run on a home server and opened from a
 * laptop, so this machine's own LAN addresses are allowlisted automatically.
 *
 * Add hostnames (e.g. "tvarr.local") with TVARR_DEV_ORIGINS, comma separated.
 */
function devOrigins(): string[] {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface!.address);

  const configured = (process.env.TVARR_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([...addresses, ...configured, "localhost", "127.0.0.1", "*.local"])];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(),
  // better-sqlite3 is a native module and must not be bundled by the compiler.
  serverExternalPackages: ["better-sqlite3"],
  images: {
    // Poster art is served straight from the metadata providers.
    remotePatterns: [
      { protocol: "https", hostname: "static.tvmaze.com" },
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "m.media-amazon.com" },
      { protocol: "https", hostname: "images.metahub.space" },
      // Competition badges for the sports library.
      { protocol: "https", hostname: "a.espncdn.com" },
    ],
  },
};

export default nextConfig;
