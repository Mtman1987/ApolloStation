import { dirname, join, resolve } from 'node:path';
import type { HearMeOutMediaItemV1 } from './room-media-core.js';
import { xtreamHlsUrl } from './xtream-hls.js';
import { findXtreamSeriesEpisode, getNextXtreamSeriesEpisode } from './xtream-provider.js';
import {
  acceptRecommendation,
  recordSeriesEpisodeQueued,
  requestWatch,
  type WatchCatalogEntry,
  type WatchRequestDeps,
} from './watch-request-flow.js';
import {
  HearMeOutWatchStateStore,
  type HearMeOutPendingRecommendationV1,
  type HearMeOutWatchStateScope,
} from './watch-state.js';

// The web process owns the Watch request flow. It runs next to the Xtream lookups so
// provider credentials never leave this process. The media worker only receives the
// prepared playable item, never a credential or a provider route.

export const HEARMEOUT_WATCH_STATE_FILE = 'hearmeout-watch-state.sqlite';

// HEARMEOUT_WATCH_STATE_PATH wins. Otherwise the file sits in the same data directory as the room database.
export function watchStatePathFor(environment: NodeJS.ProcessEnv, databasePath: string): string {
  const configured = environment.HEARMEOUT_WATCH_STATE_PATH;
  if (configured !== undefined && configured.trim() !== '') return resolve(configured.trim());
  return join(dirname(resolve(databasePath)), HEARMEOUT_WATCH_STATE_FILE);
}

// A catalog episode carries its playback route. The route stays in this process and is never stored.
type CatalogEpisode = WatchCatalogEntry & { playbackUrl?: string };

export type HearMeOutWatchRequestResult =
  | { status: 'no-match' }
  | { status: 'matched'; entry: WatchCatalogEntry; item: HearMeOutMediaItemV1 };

export interface HearMeOutWatchRuntime {
  request(scope: HearMeOutWatchStateScope, query: string): Promise<HearMeOutWatchRequestResult>;
  recordQueued(scope: HearMeOutWatchStateScope, entry: WatchCatalogEntry): Promise<unknown>;
  accept(scope: HearMeOutWatchStateScope, sessionId: string): HearMeOutPendingRecommendationV1 | undefined;
  close(): void;
}

export interface HearMeOutWatchRuntimeOptions {
  statePath: string;
  findSeriesEpisode?: (
    query: string,
    getProgress?: (seriesId: string) => { seasonNumber: number; episodeNumber: number } | undefined,
  ) => Promise<CatalogEpisode | null>;
  getNextSeriesEpisode?: WatchRequestDeps['getNextSeriesEpisode'];
}

export function createHearMeOutWatchRuntime(options: HearMeOutWatchRuntimeOptions): HearMeOutWatchRuntime {
  const store = new HearMeOutWatchStateStore(options.statePath);
  // Casts bridge the Xtream catalog item shape to the flow's entry shape. Only id, title and metadata are read from the entry.
  const findSeries = options.findSeriesEpisode
    ?? ((query: string, getProgress?: Parameters<typeof findXtreamSeriesEpisode>[1]) =>
      findXtreamSeriesEpisode(query, getProgress) as unknown as Promise<CatalogEpisode | null>);
  const nextSeries = options.getNextSeriesEpisode
    ?? ((seriesId: string, seasonNumber: number, episodeNumber: number, seriesTitle?: string) =>
      getNextXtreamSeriesEpisode(seriesId, seasonNumber, episodeNumber, seriesTitle) as unknown as Promise<WatchCatalogEntry | null>);

  // Captures the playable route of the matched catalog item for this call only.
  const depsFor = (capture: { item?: CatalogEpisode | undefined }): WatchRequestDeps => ({
    store,
    findSeriesEpisode: async (query, getProgress) => {
      const item = await findSeries(query, getProgress);
      capture.item = item ?? undefined;
      return item ?? null;
    },
    getNextSeriesEpisode: nextSeries,
  });

  return {
    async request(scope, query) {
      const capture: { item?: CatalogEpisode | undefined } = {};
      const result = await requestWatch(depsFor(capture), scope, query);
      if (result.status !== 'matched') return { status: 'no-match' };
      const playbackPath = capture.item?.playbackUrl;
      if (!playbackPath || result.entry.metadata?.kind !== 'series-episode') {
        throw Object.assign(new Error('That title is not playable on the IPTV provider'), { status: 422 });
      }
      const playbackUrl = xtreamHlsUrl(playbackPath);
      if (!playbackUrl.startsWith('/api/watch/xtream/hls/')) throw Error('Invalid Apollo IPTV playback route');
      // Acquisition/conversion belongs to Apollo's HLS handler. Do not make a
      // donor request during queueing: it duplicates work and can leave the
      // queue pointed at a local path whose source was prepared elsewhere.
      const item: HearMeOutMediaItemV1 = { itemId: result.entry.id, type: 'movie', title: result.entry.title, source: 'iptv', playbackUrl };
      return { status: 'matched', entry: result.entry, item };
    },
    recordQueued(scope, entry) {
      return recordSeriesEpisodeQueued(depsFor({}), scope, entry);
    },
    accept(scope, sessionId) {
      return acceptRecommendation(depsFor({}), scope, sessionId);
    },
    close() {
      store.close();
    },
  };
}

export function createHearMeOutWatchRuntimeFromEnvironment(environment: NodeJS.ProcessEnv, databasePath: string) {
  return createHearMeOutWatchRuntime({
    statePath: watchStatePathFor(environment, databasePath),
  });
}

