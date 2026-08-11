/**
 * RSS ingestion.
 *
 * Torrent feeds are RSS 2.0 but agree on very little beyond that: the download
 * URL may be the `<link>`, an `<enclosure>`, or a magnet URI, and size/seeders
 * may arrive as Torznab attributes, a `<torrent>` block, or nothing at all.
 * Everything here is about normalizing those shapes into one FeedItem.
 */

import { XMLParser } from "fast-xml-parser";

import type { FeedItem } from "./types";

const REQUEST_TIMEOUT_MS = 30_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Values like a 40-char hex info hash must not be coerced to a number.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Reads a tag that may be a bare string or `{ "#text": "..." }`. */
function text(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const record = node as XmlNode;
    const value = record["#text"];
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function toNumber(value: unknown): number | null {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : text(value);
  if (raw === null) return null;
  const parsed = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Torznab and newznab feeds carry their metadata as repeated
 * `<torznab:attr name="seeders" value="12" />` elements.
 */
function readAttrs(item: XmlNode): Record<string, string> {
  const attrs: Record<string, string> = {};
  const candidates = [
    ...asArray(item["torznab:attr"] as XmlNode | XmlNode[]),
    ...asArray(item["newznab:attr"] as XmlNode | XmlNode[]),
    ...asArray(item.attr as XmlNode | XmlNode[]),
  ];
  for (const attr of candidates) {
    const name = attr?.["@_name"];
    const value = attr?.["@_value"];
    if (typeof name === "string" && value !== undefined) {
      attrs[name.toLowerCase()] = String(value);
    }
  }
  return attrs;
}

function isMagnet(value: string | null): boolean {
  return Boolean(value && value.startsWith("magnet:"));
}

function normalizeItem(item: XmlNode, feedId: number): FeedItem | null {
  const title = text(item.title);
  if (!title) return null;

  const attrs = readAttrs(item);

  // The download URL hides in one of several places depending on the tracker.
  const link = text(item.link);
  const enclosures = asArray(item.enclosure as XmlNode | XmlNode[]);
  const enclosureUrl = enclosures.map((e) => e?.["@_url"]).find((u) => typeof u === "string") as
    | string
    | undefined;
  const magnetTag = text(item.magnetURI ?? item.magnet ?? item["torrent:magnetURI"]);

  const candidates = [magnetTag, link, enclosureUrl ?? null, attrs.magneturl ?? null];
  const magnet = candidates.find(isMagnet) ?? null;
  const download =
    [enclosureUrl ?? null, link, attrs.downloadurl ?? null].find(
      (value) => typeof value === "string" && value.length > 0 && !isMagnet(value),
    ) ?? null;

  if (!magnet && !download) return null;

  // Some feeds nest details under a <torrent> element.
  const torrent = (item.torrent ?? {}) as XmlNode;

  const guid =
    text(item.guid) ??
    attrs.infohash ??
    text(torrent.infoHash) ??
    download ??
    magnet ??
    title;

  const size =
    toNumber(attrs.size) ??
    toNumber(item.size) ??
    toNumber(torrent.contentLength) ??
    toNumber(enclosures.map((e) => e?.["@_length"]).find((l) => l !== undefined)) ??
    null;

  const seeders =
    toNumber(attrs.seeders) ?? toNumber(item.seeders) ?? toNumber(torrent.seeders) ?? null;

  const leechers =
    toNumber(attrs.leechers) ??
    toNumber(attrs.peers) ??
    toNumber(item.leechers) ??
    toNumber(torrent.leechers) ??
    null;

  return {
    feedId,
    guid: String(guid),
    title,
    link: download,
    magnet,
    publishedAt: toIsoDate(item.pubDate ?? item.published ?? item.date),
    sizeBytes: size !== null ? Math.round(size) : null,
    seeders,
    leechers,
  };
}

/** Parse a raw RSS/Atom document into normalized items. */
export function parseFeedXml(xml: string, feedId: number): FeedItem[] {
  const document = parser.parse(xml) as XmlNode;

  const rss = document.rss as XmlNode | undefined;
  const channel = (rss?.channel ?? document.channel) as XmlNode | undefined;
  const feed = document.feed as XmlNode | undefined;

  const rawItems = channel
    ? asArray(channel.item as XmlNode | XmlNode[])
    : feed
      ? asArray(feed.entry as XmlNode | XmlNode[])
      : [];

  const items: FeedItem[] = [];
  for (const raw of rawItems) {
    const item = normalizeItem(raw, feedId);
    if (item) items.push(item);
  }
  return items;
}

export interface FetchFeedResult {
  items: FeedItem[];
  status: number;
}

export async function fetchFeed(url: string, feedId: number): Promise<FetchFeedResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      accept: "application/rss+xml, application/xml, text/xml, */*",
      "user-agent": "tvarr/1.0",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`feed returned ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  if (!body.trim()) throw new Error("feed returned an empty body");

  const items = parseFeedXml(body, feedId);
  if (!items.length && !/<(item|entry)\b/i.test(body)) {
    throw new Error("response did not look like an RSS feed");
  }

  return { items, status: response.status };
}
