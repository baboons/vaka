import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and must not be bundled by the compiler.
  serverExternalPackages: ["better-sqlite3"],
  images: {
    // Poster art is served straight from the metadata providers.
    remotePatterns: [
      { protocol: "https", hostname: "static.tvmaze.com" },
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "m.media-amazon.com" },
      { protocol: "https", hostname: "images.metahub.space" },
    ],
  },
};

export default nextConfig;
