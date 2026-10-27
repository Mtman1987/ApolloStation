import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HearMeOutWatchStateStore } from '../apps/hearmeout/dist/watch-state.js';

const alice = { tenantId: 'tenant', userId: 'alice' };
const bob = { tenantId: 'tenant', userId: 'bob' };
const otherTenant = { tenantId: 'other', userId: 'alice' };

test('pending recommendations and series progress survive a restart and stay scoped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-watch-state-'));
  const path = join(dir, 'watch-state.db');
  try {
    let store = new HearMeOutWatchStateStore(path);
    store.setRecommendation(alice, 'session-1', { itemId: 'ia-1', title: 'Night Film', kind: 'movie', year: 1958, savedAt: 1 });
    store.saveSeriesProgress(alice, { seriesId: '42', seriesTitle: 'Show', nextSeasonNumber: 2, nextEpisodeNumber: 3, updatedAt: 1 });
    store.close();

    // Simulated restart: a fresh process opens the same file.
    store = new HearMeOutWatchStateStore(path);
    assert.equal(store.takeRecommendation(bob, 'session-1'), undefined, 'recommendations do not cross users');
    assert.equal(store.takeRecommendation(otherTenant, 'session-1'), undefined, 'recommendations do not cross tenants');
    assert.equal(store.getSeriesProgress(bob, '42'), undefined, 'series progress does not cross users');
    assert.equal(store.getSeriesProgress(otherTenant, '42'), undefined, 'series progress does not cross tenants');

    const progress = store.getSeriesProgress(alice, '42');
    assert.deepEqual(progress, { provider: 'xtream', seriesId: '42', seriesTitle: 'Show', nextSeasonNumber: 2, nextEpisodeNumber: 3, updatedAt: 1 });

    const taken = store.takeRecommendation(alice, 'session-1');
    assert.equal(taken?.itemId, 'ia-1');
    assert.equal(store.takeRecommendation(alice, 'session-1'), undefined, 'accepting a recommendation consumes it');
    store.close();

    store = new HearMeOutWatchStateStore(path);
    assert.equal(store.takeRecommendation(alice, 'session-1'), undefined, 'consumption persists across restart');
    assert.equal(store.getSeriesProgress(alice, '42')?.nextEpisodeNumber, 3);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('watch state rejects playback URLs, credentials and malformed identifiers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-watch-state-reject-'));
  const store = new HearMeOutWatchStateStore(join(dir, 'watch-state.db'));
  try {
    assert.throws(() => store.setRecommendation(alice, 'session-1', { itemId: 'ia-1', title: 'Film', kind: 'movie', playbackUrl: 'https://provider.example/stream.m3u8' }), /cannot store/);
    assert.throws(() => store.setRecommendation(alice, 'session-1', { itemId: 'ia-1', title: 'Film', kind: 'movie', authorization: 'Bearer x' }), /cannot store/);
    assert.throws(() => store.saveSeriesProgress(alice, { seriesId: '42', seriesTitle: 'Show', nextSeasonNumber: 1, nextEpisodeNumber: 1, url: 'https://x.example' }), /cannot store/);
    assert.throws(() => store.setRecommendation(alice, '../session', { itemId: 'ia-1', title: 'Film', kind: 'movie' }), /Invalid session/);
    assert.throws(() => store.setRecommendation(alice, 'session-1', { itemId: 'ia-1', title: 'Film', kind: 'script' }), /Invalid recommendation kind/);
    assert.throws(() => store.saveSeriesProgress(alice, { seriesId: '42', seriesTitle: 'Show', nextSeasonNumber: 0, nextEpisodeNumber: 1 }), /Invalid season number/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
