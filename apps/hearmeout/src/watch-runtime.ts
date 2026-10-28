
import { dirname, join, resolve } from 'node:path';
import { configuredDonorOrigin } from './donor-origin.js';
import { hearMeOutMovieProviderUrl } from './movie-provider.js';
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
  donorOrigin: string;
  fetchImpl?: typeof fetch;
  findSeriesEpisode?: (
    query: string,
    getProgress?: (seriesId: string) => { seasonNumber: number; episodeNumber: number } | undefined,
  ) => Promise<CatalogEpisode | null>;
  getNextSeriesEpisode?: WatchRequestDeps['getNextSeriesEpisode'];
}

export function createHearMeOutWatchRuntime(options: HearMeOutWatchRuntimeOptions): HearMeOutWatchRuntime {
  const store = new HearMeOutWatchStateStore(options.statePath);
  const fetchImpl = options.fetchImpl ?? fetch;
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
      const item = await prepareEpisode(result.entry, playbackPath, options.donorOrigin, fetchImpl);
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
    donorOrigin: configuredDonorOrigin(environment),
  });
}

// Same contract as the movie provider: validated route, bounded manifest read, 202 means still preparing.
async function prepareEpisode(entry: WatchCatalogEntry, playbackPath: string, donorOrigin: string, fetchImpl: typeof fetch): Promise<HearMeOutMediaItemV1> {
  const hlsPath = xtreamHlsUrl(playbackPath);
  const url = new URL(hlsPath, donorOrigin);
  if (!hearMeOutMovieProviderUrl(url, donorOrigin)) throw Error('Invalid IPTV provider route');
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/vnd.apple.mpegurl', 'user-agent': 'HearMeOut/1.0' },
      signal: AbortSignal.timeout(60000),
    });
    if (response.status === 202) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(`The IPTV provider could not prepare that episode (HTTP ${response.status})`);
    }
    const manifest = await boundedText(response);
    if (!manifest.startsWith('#EXTM3U')) throw Error('The IPTV provider did not return playable episode media');
    return { itemId: entry.id, type: 'movie', title: entry.title, source: 'iptv', playbackUrl: url.href };
  }
  throw Error('The IPTV provider is still preparing that episode. Retry your request.');
}

async function boundedText(response: Response) {
  if (!response.body) throw Error('The IPTV provider returned an empty response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > 1024 * 1024) throw Error('The IPTV provider response is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
