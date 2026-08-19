/**
 * Writing a release to disk.
 *
 * Vaka never talks to a torrent client. It drops a `.torrent` file into a
 * watched ("blackhole") folder and lets the client pick it up, which works
 * with every client and needs no credentials.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { expandHome } from "./db";
import type { KindConfig } from "./settings";
import type { FeedItem, Media } from "./types";

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
/** A sane ceiling for a metadata file; anything larger is not a torrent. */
const MAX_TORRENT_BYTES = 10 * 1024 * 1024;

export interface GrabResult {
  path: string;
  format: "torrent" | "magnet";
  bytes: number;
}

export class GrabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrabError";
  }
}

/**
 * Make a string safe to use as a single path segment. Also strips separators
 * and traversal, since release titles come from an untrusted feed.
 */
export function sanitizeFilename(input: string, fallback = "download"): string {
  const cleaned = input
    .replace(/[/\\]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "")
    // A leading dot hides the file; "." and ".." would be traversal.
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Leave room for the extension within the usual 255 byte filename limit.
  const truncated = cleaned.slice(0, 200).trim();
  return truncated || fallback;
}

/**
 * Destination directory for a title's `.torrent` file.
 *
 * Always the folder itself, never a subfolder: torrent clients watch a single
 * directory and do not look inside it, so a per-show subfolder would leave the
 * file sitting there forever without being picked up.
 *
 * A per-title override still works — it just names a different flat folder.
 */
export function resolveTargetDir(media: Media, config: KindConfig): string {
  if (media.folder && media.folder.trim()) {
    return path.resolve(expandHome(media.folder.trim()));
  }
  return path.resolve(expandHome(config.downloadDir));
}

/** Avoid clobbering an existing file by appending a counter. */
async function uniquePath(target: string): Promise<string> {
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? target : path.join(dir, `${base} (${attempt})${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new GrabError(`could not find a free filename for ${base}`);
}

/**
 * Fetch a .torrent, following redirects by hand so that a tracker redirecting
 * to a magnet URI is detected rather than failing on an unsupported scheme.
 */
async function fetchTorrent(
  url: string,
): Promise<{ buffer: Buffer } | { magnet: string }> {
  let current = url;

  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    if (current.startsWith("magnet:")) return { magnet: current };

    const response = await fetch(current, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: "manual",
      headers: { accept: "application/x-bittorrent, */*", "user-agent": "vaka/1.0" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new GrabError(`redirect without a location header`);
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) {
      throw new GrabError(`download failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength === 0) throw new GrabError("download was empty");
    if (buffer.byteLength > MAX_TORRENT_BYTES) {
      throw new GrabError("download was too large to be a torrent file");
    }

    // Bencoded torrents always start with a dictionary marker. An HTML body
    // here usually means a login page or a rate limit notice.
    if (buffer[0] !== 0x64) {
      const preview = buffer.subarray(0, 200).toString("utf8");
      if (preview.trimStart().startsWith("magnet:")) {
        return { magnet: preview.trim().split(/\s/)[0] };
      }
      const hint = contentType.includes("html")
        ? "got an HTML page (is the feed URL missing an API key?)"
        : `unexpected content-type "${contentType || "unknown"}"`;
      throw new GrabError(`response was not a torrent file — ${hint}`);
    }

    return { buffer };
  }

  throw new GrabError("too many redirects");
}

/**
 * Download a release into the blackhole folder.
 *
 * Prefers a real .torrent file; falls back to writing the magnet link when
 * that is all the feed offers and the config allows it.
 */
export async function grabRelease(
  item: FeedItem,
  media: Media,
  config: KindConfig,
  options: { writeMagnetFiles: boolean },
): Promise<GrabResult> {
  const targetDir = resolveTargetDir(media, config);
  await fs.mkdir(targetDir, { recursive: true });

  const baseName = sanitizeFilename(item.title, `release-${item.guid.slice(0, 12)}`);

  if (item.link) {
    const result = await fetchTorrent(item.link);
    if ("buffer" in result) {
      const target = await uniquePath(path.join(targetDir, `${baseName}.torrent`));
      await fs.writeFile(target, result.buffer);
      return { path: target, format: "torrent", bytes: result.buffer.byteLength };
    }
    return writeMagnet(targetDir, baseName, result.magnet, options.writeMagnetFiles);
  }

  if (item.magnet) {
    return writeMagnet(targetDir, baseName, item.magnet, options.writeMagnetFiles);
  }

  throw new GrabError("release has no download link");
}

async function writeMagnet(
  targetDir: string,
  baseName: string,
  magnet: string,
  enabled: boolean,
): Promise<GrabResult> {
  if (!enabled) {
    throw new GrabError("only a magnet link was available and magnet files are disabled");
  }
  const target = await uniquePath(path.join(targetDir, `${baseName}.magnet`));
  const body = `${magnet}\n`;
  await fs.writeFile(target, body, "utf8");
  return { path: target, format: "magnet", bytes: Buffer.byteLength(body) };
}

/** Verify the blackhole folder is usable, for the settings screen. */
export async function checkDownloadDir(
  dir: string,
): Promise<{ ok: boolean; message: string; resolved: string }> {
  const resolved = path.resolve(expandHome(dir.trim()));
  if (!dir.trim()) {
    return { ok: false, message: "No folder configured", resolved };
  }
  try {
    await fs.mkdir(resolved, { recursive: true });
    await fs.access(resolved, fs.constants.W_OK);
    return { ok: true, message: "Folder exists and is writable", resolved };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: reason, resolved };
  }
}
