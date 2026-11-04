import type { HearMeOutPendingRecommendationV1, HearMeOutWatchStateScope, HearMeOutWatchStateStore } from './watch-state.js';
import type { XtreamSeriesProgress } from './xtream-provider.js';

// Watch request flow ported from the donor's watch-request-service: series resume
// lookup, next-episode progression after a series episode is queued, and the
// pending-recommendation take-on-accept. Provider access is injected so the flow
// never sees credentials or playback URLs; it only handles stable catalog ids.

export type WatchCatalogEntry = {
  id: string;
  type: 'movie' | 'live';
  title: string;
  year?: number;
  metadata?: {
    kind?: 'series-episode';
    seriesId?: string;
    seriesTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
  };
};

export type WatchRequestDeps = {
  store: Pick<HearMeOutWatchStateStore, 'setRecommendation' | 'takeRecommendation' | 'saveSeriesProgress' | 'getSeriesProgress'>;
  findSeriesEpisode: (
    query: string,
    getProgress?: (seriesId: string) => XtreamSeriesProgress | undefined,
  ) => Promise<WatchCatalogEntry | null>;
  getNextSeriesEpisode: (
    seriesId: string,
    seasonNumber: number,
    episodeNumber: number,
    seriesTitle?: string,
  ) => Promise<WatchCatalogEntry | null>;
};

// Resume lookup handed to findXtreamSeriesEpisode. Reads only the stored next-episode numbers.
export function seriesProgressLookup(deps: WatchRequestDeps, scope: HearMeOutWatchStateScope) {
  return (seriesId: string): XtreamSeriesProgress | undefined => {
    const progress = deps.store.getSeriesProgress(scope, seriesId);
    return progress ? { seasonNumber: progress.nextSeasonNumber, episodeNumber: progress.nextEpisodeNumber } : undefined;
  };
}

// Resolves a Watch request. An explicit series query with a stored resume point starts at that episode.
export async function requestWatch(deps: WatchRequestDeps, scope: HearMeOutWatchStateScope, query: string) {
  const entry = await deps.findSeriesEpisode(query, seriesProgressLookup(deps, scope));
  return entry ? { status: 'matched' as const, entry } : { status: 'no-match' as const };
}

// Stores a candidate the user can accept later, for example from a fallback source when no catalog item matched.
export function recordRecommendation(deps: WatchRequestDeps, scope: HearMeOutWatchStateScope, sessionId: string, entry: WatchCatalogEntry) {
  const kind: HearMeOutPendingRecommendationV1['kind'] = entry.metadata?.kind === 'series-episode'
    ? 'episode'
    : entry.type === 'live'
      ? 'live'
      : 'movie';
  const year = typeof entry.year === 'number' && Number.isSafeInteger(entry.year) && entry.year >= 1 ? entry.year : undefined;
  return deps.store.setRecommendation(scope, sessionId, {
    itemId: entry.id,
    title: entry.title,
    kind,
    ...(year === undefined ? {} : { year }),
  });
}

// Consumes the pending recommendation for this session and user. Returns undefined when none is pending.
export function acceptRecommendation(deps: WatchRequestDeps, scope: HearMeOutWatchStateScope, sessionId: string) {
  return deps.store.takeRecommendation(scope, sessionId);
}

// Call after a series episode is queued. Stores the next episode as the resume point,
// mirroring the donor: falls back to the same season with episode + 1 when the provider has no next entry.
export async function recordSeriesEpisodeQueued(deps: WatchRequestDeps, scope: HearMeOutWatchStateScope, entry: WatchCatalogEntry) {
  const metadata = entry.metadata;
  if (metadata?.kind !== 'series-episode' || !metadata.seriesId) return undefined;
  const seasonNumber = Number(metadata.seasonNumber || 1);
  const episodeNumber = Number(metadata.episodeNumber || 1);
  const next = await deps.getNextSeriesEpisode(metadata.seriesId, seasonNumber, episodeNumber, metadata.seriesTitle).catch(() => null);
  const nextMetadata = next?.metadata;
  return deps.store.saveSeriesProgress(scope, {
    seriesId: metadata.seriesId,
    seriesTitle: metadata.seriesTitle || entry.title,
    nextSeasonNumber: Number(nextMetadata?.seasonNumber || seasonNumber),
    nextEpisodeNumber: Number(nextMetadata?.episodeNumber || episodeNumber + 1),
  });
}
