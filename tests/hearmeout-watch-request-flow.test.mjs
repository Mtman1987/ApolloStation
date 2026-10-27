import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HearMeOutWatchStateStore } from '../apps/hearmeout/dist/watch-state.js';
import {
  acceptRecommendation,
  recordRecommendation,
  recordSeriesEpisodeQueued,
  requestWatch,
  seriesProgressLookup,
} from '../apps/hearmeout/dist/watch-request-flow.js';

const alice = { tenantId: 'tenant', userId: 'alice' };
const bob = { tenantId: 'tenant', userId: 'bob' };

const episode = (seriesId, season, number, title = 'Show') => ({
  id: `xtream-episode-${seriesId}-${season}-${number}`,
  type: 'movie',
  title: `${title} S${season}E${number}`,
  metadata: { kind: 'series-episode', seriesId, seriesTitle: title, seasonNumber: season, episodeNumber: number },
});

function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-watch-flow-'));
  const store = new HearMeOutWatchStateStore(join(dir, 'watch-state.db'));
  try {
    return run(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a series request resumes at the stored next episode and only for the same user', async () => {
  await withStoreAsync(async store => {
    const deps = {
      store,
      findSeriesEpisode: async (_query, getProgress) => {
        const progress = getProgress?.('42');
        return episode('42', progress?.seasonNumber ?? 1, progress?.episodeNumber ?? 1);
      },
      getNextSeriesEpisode: async () => null,
    };
    await recordSeriesEpisodeQueued(deps, alice, episode('42', 1, 4));

    const resumed = await requestWatch(deps, alice, 'show resume');
    assert.equal(resumed.status, 'matched');
    assert.equal(resumed.entry.id, 'xtream-episode-42-1-5');

    const fresh = await requestWatch(deps, bob, 'show resume');
    assert.equal(fresh.entry.id, 'xtream-episode-42-1-1', 'progress does not cross users');
    assert.equal(seriesProgressLookup(deps, bob)('42'), undefined);
  });
});

test('after an episode is queued the provider next episode becomes the resume point', async () => {
  await withStoreAsync(async store => {
    const deps = {
      store,
      findSeriesEpisode: async () => null,
      getNextSeriesEpisode: async (seriesId, season, number) => (number === 4 ? episode(seriesId, season + 1, 1) : null),
    };
    const saved = await recordSeriesEpisodeQueued(deps, alice, episode('42', 1, 4));
    assert.deepEqual(
      { s: saved.nextSeasonNumber, e: saved.nextEpisodeNumber },
      { s: 2, e: 1 },
      'uses the provider next entry, including season rollover',
    );
    assert.deepEqual(seriesProgressLookup(deps, alice)('42'), { seasonNumber: 2, episodeNumber: 1 });
  });
});

test('when the provider has no next entry the flow falls back to episode + 1 in the same season', async () => {
  await withStoreAsync(async store => {
    const deps = {
      store,
      findSeriesEpisode: async () => null,
      getNextSeriesEpisode: async () => {
        throw new Error('provider unavailable');
      },
    };
    const saved = await recordSeriesEpisodeQueued(deps, alice, episode('42', 3, 7, 'Other'));
    assert.equal(saved.nextSeasonNumber, 3);
    assert.equal(saved.nextEpisodeNumber, 8);
    assert.equal(saved.seriesTitle, 'Other');
  });
});

test('movies and live entries never write series progress', async () => {
  await withStoreAsync(async store => {
    const deps = { store, findSeriesEpisode: async () => null, getNextSeriesEpisode: async () => null };
    const saved = await recordSeriesEpisodeQueued(deps, alice, { id: 'xtream-vod-9', type: 'movie', title: 'Film' });
    assert.equal(saved, undefined);
    assert.equal(store.getSeriesProgress(alice, '9'), undefined);
  });
});

test('a pending recommendation is stored as an id and consumed exactly once on accept', () => {
  withStore(store => {
    const deps = { store, findSeriesEpisode: async () => null, getNextSeriesEpisode: async () => null };
    recordRecommendation(deps, alice, 'session-1', { id: 'xtream-vod-77', type: 'movie', title: 'Night Film', year: 1958 });

    assert.equal(acceptRecommendation(deps, bob, 'session-1'), undefined, 'recommendations do not cross users');
    const accepted = acceptRecommendation(deps, alice, 'session-1');
    assert.deepEqual(accepted, { itemId: 'xtream-vod-77', title: 'Night Film', kind: 'movie', year: 1958, savedAt: accepted.savedAt });
    assert.equal(acceptRecommendation(deps, alice, 'session-1'), undefined, 'a second accept cannot queue it again');
  });
});

test('recommendation kinds map from catalog entries and no playback fields are stored', () => {
  withStore(store => {
    const deps = { store, findSeriesEpisode: async () => null, getNextSeriesEpisode: async () => null };
    const stored = recordRecommendation(deps, alice, 'session-2', { id: 'xtream-live-5', type: 'live', title: 'Channel 5' });
    assert.equal(stored.kind, 'live');
    assert.equal('year' in stored, false);
    const ep = recordRecommendation(deps, alice, 'session-3', episode('42', 1, 2));
    assert.equal(ep.kind, 'episode');
    for (const key of Object.keys(ep)) assert.doesNotMatch(key, /url|token|credential|authorization|password|secret/i);
  });
});

test('a request with no catalog match reports no-match and writes nothing', async () => {
  await withStoreAsync(async store => {
    const deps = { store, findSeriesEpisode: async () => null, getNextSeriesEpisode: async () => null };
    assert.deepEqual(await requestWatch(deps, alice, 'unknown'), { status: 'no-match' });
    assert.equal(acceptRecommendation(deps, alice, 'session-1'), undefined);
  });
});

async function withStoreAsync(run) {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-watch-flow-async-'));
  const store = new HearMeOutWatchStateStore(join(dir, 'watch-state.db'));
  try {
    return await run(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
