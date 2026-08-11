"use server";

/**
 * Server actions used by the UI.
 *
 * Anything that touches the network or the filesystem in a long-running way is
 * handed to the watcher daemon as a job rather than being run here, so the UI
 * stays responsive and there is exactly one process doing the downloading.
 */

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/core/db";
import { addMedia as addMediaToLibrary, type MonitorMode } from "@/lib/core/engine";
import { fetchFeed } from "@/lib/core/feed";
import { checkDownloadDir } from "@/lib/core/grab";
import * as providers from "@/lib/core/providers";
import * as repo from "@/lib/core/repo";
import {
  generalConfigSchema,
  getConfig,
  kindConfigSchema,
  saveGeneralConfig,
  saveKindConfig,
  type GeneralConfig,
  type KindConfig,
} from "@/lib/core/settings";
import type { EpisodeState, MediaKind, QualityProfile } from "@/lib/core/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

function refreshAllViews(): void {
  revalidatePath("/", "layout");
}

/* ------------------------------------------------------------------ */
/* Library                                                              */
/* ------------------------------------------------------------------ */

export async function addToLibrary(input: {
  kind: MediaKind;
  provider: string;
  providerId: string;
  quality: QualityProfile;
  monitorMode: MonitorMode;
  folder?: string | null;
  searchTerms?: string[];
}): Promise<ActionResult> {
  const db = getDb();
  const config = getConfig(db);

  try {
    const existing = repo.findMediaByProvider(input.provider, input.providerId, db);
    if (existing) {
      return { ok: false, message: `${existing.title} is already in your library` };
    }

    const details = await providers.refreshMetadata(
      input.kind,
      input.provider,
      input.providerId,
      config.general.tmdbApiKey,
    );

    const media = await addMediaToLibrary(
      {
        result: details,
        quality: input.quality,
        monitorMode: input.monitorMode,
        folder: input.folder ?? null,
        searchTerms: input.searchTerms ?? [],
      },
      db,
    );

    refreshAllViews();
    return {
      ok: true,
      message: `Added ${media.title} — the watcher will start looking for releases`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not add this title",
    };
  }
}

export async function removeFromLibrary(mediaId: number): Promise<ActionResult> {
  const media = repo.getMedia(mediaId);
  repo.deleteMedia(mediaId);
  refreshAllViews();
  return { ok: true, message: `Removed ${media?.title ?? "title"} from your library` };
}

export async function setMediaMonitored(
  mediaId: number,
  monitored: boolean,
): Promise<ActionResult> {
  repo.updateMedia(mediaId, { monitored });
  if (monitored) repo.enqueueJob("search_media", { mediaId });
  refreshAllViews();
  return { ok: true, message: monitored ? "Now watching" : "Paused" };
}

export async function updateMediaSettings(
  mediaId: number,
  patch: { quality?: QualityProfile; folder?: string | null; searchTerms?: string[] },
): Promise<ActionResult> {
  repo.updateMedia(mediaId, patch);
  repo.enqueueJob("search_media", { mediaId });
  refreshAllViews();
  return { ok: true, message: "Saved" };
}

export async function setMovieState(
  mediaId: number,
  state: "wanted" | "ignored",
): Promise<ActionResult> {
  repo.updateMedia(mediaId, { state });
  if (state === "wanted") repo.enqueueJob("search_media", { mediaId });
  refreshAllViews();
  return { ok: true, message: state === "wanted" ? "Marked as wanted" : "Ignored" };
}

/* ------------------------------------------------------------------ */
/* Episodes                                                             */
/* ------------------------------------------------------------------ */

export async function setEpisodeMonitored(
  episodeId: number,
  monitored: boolean,
): Promise<ActionResult> {
  repo.updateEpisode(episodeId, { monitored });
  refreshAllViews();
  return { ok: true, message: monitored ? "Monitoring episode" : "Ignoring episode" };
}

export async function setSeasonMonitored(
  mediaId: number,
  season: number,
  monitored: boolean,
): Promise<ActionResult> {
  repo.setSeasonMonitored(mediaId, season, monitored);
  if (monitored) repo.enqueueJob("search_media", { mediaId });
  refreshAllViews();
  return {
    ok: true,
    message: `Season ${season} ${monitored ? "monitored" : "ignored"}`,
  };
}

export async function setEpisodeState(
  episodeId: number,
  state: EpisodeState,
): Promise<ActionResult> {
  repo.updateEpisode(episodeId, {
    state,
    ...(state === "wanted" ? { grabbedQuality: null, grabbedAt: null } : {}),
  });
  refreshAllViews();
  return { ok: true, message: "Updated" };
}

/* ------------------------------------------------------------------ */
/* Watcher jobs                                                         */
/* ------------------------------------------------------------------ */

export async function requestFeedCheck(): Promise<ActionResult> {
  repo.enqueueJob("poll_feeds");
  refreshAllViews();
  return { ok: true, message: "Queued a feed check — the watcher picks it up within seconds" };
}

export async function requestSearch(mediaId: number): Promise<ActionResult> {
  repo.enqueueJob("search_media", { mediaId });
  refreshAllViews();
  return { ok: true, message: "Searching cached releases…" };
}

export async function requestRefresh(mediaId: number): Promise<ActionResult> {
  repo.enqueueJob("refresh_media", { mediaId });
  refreshAllViews();
  return { ok: true, message: "Queued a metadata refresh" };
}

export async function requestRefreshAll(): Promise<ActionResult> {
  repo.enqueueJob("refresh_all");
  refreshAllViews();
  return { ok: true, message: "Queued a refresh of every title" };
}

export async function grabRelease(itemId: number, mediaId: number): Promise<ActionResult> {
  repo.enqueueJob("grab_item", { itemId, mediaId });
  refreshAllViews();
  return { ok: true, message: "Queued the download" };
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export async function saveLibrarySettings(
  kind: MediaKind,
  config: KindConfig,
): Promise<ActionResult> {
  const parsed = kindConfigSchema.safeParse(config);
  if (!parsed.success) {
    return { ok: false, message: "Those settings are not valid" };
  }

  saveKindConfig(kind, parsed.data);
  refreshAllViews();

  const check = await checkDownloadDir(parsed.data.downloadDir);
  return {
    ok: true,
    message: check.ok
      ? `Saved. Downloads go to ${check.resolved}`
      : `Saved, but the folder is not usable: ${check.message}`,
  };
}

export async function saveGeneralSettings(config: GeneralConfig): Promise<ActionResult> {
  const parsed = generalConfigSchema.safeParse(config);
  if (!parsed.success) return { ok: false, message: "Those settings are not valid" };

  saveGeneralConfig(parsed.data);
  refreshAllViews();
  return { ok: true, message: "Settings saved" };
}

export async function verifyDownloadDir(dir: string): Promise<ActionResult> {
  const check = await checkDownloadDir(dir);
  return { ok: check.ok, message: check.ok ? `${check.resolved} is writable` : check.message };
}

/* ------------------------------------------------------------------ */
/* Feeds                                                                */
/* ------------------------------------------------------------------ */

export async function addFeed(input: {
  name: string;
  url: string;
  kind: MediaKind | "any";
}): Promise<ActionResult> {
  if (!input.name.trim() || !input.url.trim()) {
    return { ok: false, message: "A name and URL are required" };
  }
  try {
    new URL(input.url);
  } catch {
    return { ok: false, message: "That URL is not valid" };
  }

  repo.insertFeed({ name: input.name.trim(), url: input.url.trim(), kind: input.kind });
  repo.enqueueJob("poll_feeds");
  refreshAllViews();
  return { ok: true, message: `Added ${input.name.trim()}` };
}

export async function updateFeedSettings(
  feedId: number,
  patch: { name?: string; url?: string; kind?: MediaKind | "any"; enabled?: boolean },
): Promise<ActionResult> {
  repo.updateFeed(feedId, patch);
  refreshAllViews();
  return { ok: true, message: "Feed updated" };
}

export async function deleteFeed(feedId: number): Promise<ActionResult> {
  repo.deleteFeed(feedId);
  refreshAllViews();
  return { ok: true, message: "Feed removed" };
}

/** Fetch a feed right now and report what it contains, without grabbing. */
export async function testFeed(url: string): Promise<ActionResult> {
  try {
    const { items } = await fetchFeed(url, 0);
    if (!items.length) {
      return { ok: false, message: "The feed responded but contained no usable releases" };
    }
    return {
      ok: true,
      message: `Found ${items.length} releases — newest: ${items[0].title.slice(0, 80)}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not read that feed",
    };
  }
}
