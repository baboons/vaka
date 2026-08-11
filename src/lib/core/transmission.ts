/**
 * Transmission RPC.
 *
 * tvarr polls rather than asking Transmission to run a script on completion:
 * polling needs no changes to the Transmission side beyond RPC being enabled,
 * survives tvarr being restarted, and cannot lose an event while tvarr is down.
 *
 * The one quirk worth knowing is the CSRF handshake — Transmission answers the
 * first request with 409 and a session id header, which must be echoed back on
 * every subsequent call.
 */

import type { TransmissionConfig } from "./settings";

const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_HEADER = "x-transmission-session-id";

export class TransmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransmissionError";
  }
}

/** Transmission's numeric status codes. 5 = seed wait, 6 = seeding. */
export const STATUS_SEEDING = 6;
export const STATUS_SEED_WAIT = 5;

export interface TransmissionTorrent {
  id: number;
  hashString: string;
  name: string;
  percentDone: number;
  status: number;
  isFinished: boolean;
  downloadDir: string;
  doneDate: number;
  totalSize: number;
}

/** Session ids are per-connection; cached so we do not pay the 409 each time. */
const sessionIds = new Map<string, string>();

/**
 * Accept "localhost:9091" as readily as a full RPC URL.
 *
 * Parsed rather than concatenated, so a trailing slash or a query string
 * cannot produce something like "host?x=1/transmission/rpc".
 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, "");
  if (!trimmed) throw new TransmissionError("No Transmission URL configured");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    throw new TransmissionError(`"${input}" is not a valid URL`);
  }

  const cleaned = url.pathname.replace(/\/+$/, "");
  if (!cleaned.endsWith("/transmission/rpc")) {
    url.pathname = `${cleaned}/transmission/rpc`;
  }
  return url.toString();
}

async function call<T>(
  config: TransmissionConfig,
  method: string,
  args: Record<string, unknown> = {},
  retry = true,
): Promise<T> {
  const url = normalizeUrl(config.url);

  const headers: Record<string, string> = { "content-type": "application/json" };
  const cached = sessionIds.get(url);
  if (cached) headers[SESSION_HEADER] = cached;
  if (config.username || config.password) {
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    headers.authorization = `Basic ${credentials}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ method, arguments: args }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TransmissionError(`could not reach ${url} — ${reason}`);
  }

  if (response.status === 409) {
    const id = response.headers.get(SESSION_HEADER);
    if (id && retry) {
      sessionIds.set(url, id);
      return call<T>(config, method, args, false);
    }
    throw new TransmissionError("Transmission rejected the session handshake");
  }

  if (response.status === 401) {
    throw new TransmissionError("Transmission rejected the username or password (401)");
  }

  if (!response.ok) {
    throw new TransmissionError(`Transmission returned ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { result?: string; arguments?: T };
  if (body.result !== "success") {
    throw new TransmissionError(`Transmission said: ${body.result ?? "unknown error"}`);
  }
  return (body.arguments ?? {}) as T;
}

export interface TransmissionSession {
  version: string;
  downloadDir: string;
}

export async function getSession(config: TransmissionConfig): Promise<TransmissionSession> {
  const session = await call<{ version?: string; "download-dir"?: string }>(
    config,
    "session-get",
  );
  return {
    version: session.version ?? "unknown",
    downloadDir: session["download-dir"] ?? "",
  };
}

export async function listTorrents(config: TransmissionConfig): Promise<TransmissionTorrent[]> {
  const result = await call<{ torrents?: TransmissionTorrent[] }>(config, "torrent-get", {
    fields: [
      "id",
      "hashString",
      "name",
      "percentDone",
      "status",
      "isFinished",
      "downloadDir",
      "doneDate",
      "totalSize",
    ],
  });
  return result.torrents ?? [];
}

/** Downloads that have finished and are therefore safe to import. */
export async function listCompleted(config: TransmissionConfig): Promise<TransmissionTorrent[]> {
  const torrents = await listTorrents(config);
  return torrents.filter(
    (torrent) =>
      torrent.percentDone >= 1 &&
      (torrent.isFinished || torrent.status === STATUS_SEEDING || torrent.status === STATUS_SEED_WAIT),
  );
}

/**
 * Where the torrent's data is, as seen from *this* machine.
 *
 * Transmission reports its own view of the filesystem, which differs when it
 * runs in a container or on another host.
 */
export function localPathFor(
  torrent: Pick<TransmissionTorrent, "downloadDir" | "name">,
  config: TransmissionConfig,
): string {
  const remotePrefix = config.remotePathPrefix.trim().replace(/\/+$/, "");
  const localPrefix = config.localPathPrefix.trim().replace(/\/+$/, "");

  let dir = torrent.downloadDir;
  if (remotePrefix && localPrefix && dir.startsWith(remotePrefix)) {
    dir = localPrefix + dir.slice(remotePrefix.length);
  }

  const separator = dir.endsWith("/") ? "" : "/";
  return `${dir}${separator}${torrent.name}`;
}

export interface TransmissionStatus {
  version: string;
  downloadDir: string;
  total: number;
  completed: number;
}

/** Contacts the server and summarises it, for the settings screen. */
export async function testConnection(
  config: TransmissionConfig,
): Promise<TransmissionStatus> {
  const [session, torrents] = await Promise.all([getSession(config), listTorrents(config)]);
  return {
    version: session.version,
    downloadDir: session.downloadDir,
    total: torrents.length,
    completed: torrents.filter((torrent) => torrent.percentDone >= 1).length,
  };
}
