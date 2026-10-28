import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hearMeOutMovieProviderUrl } from '../apps/hearmeout/dist/movie-provider.js';
import {
  HEARMEOUT_WATCH_STATE_FILE,
  createHearMeOutWatchRuntime,
  watchStatePathFor,
} from '../apps/hearmeout/dist/watch-runtime.js';

const origin = 'https://donor.example.test';
const scope = { tenantId: 'tenant', userId: 'alice' };

function withRuntime(options, run) {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-watch-runtime-'));
  const runtime = createHearMeOutWatchRuntime({ statePath: join(dir, 'watch-state.sqlite'), donorOrigin: origin, ...options });
  return Promise.resolve()
    .then(() => run(runtime))
    .finally(() => {
      runtime.close();
      rmSync(dir, { recursive: true, force: true });
    });
}

const episodeEntry = {
  id: 'xtream-episode-77-mkv',
  type: 'movie',
  title: 'Show S1E2',
  playbackUrl: '/activity-provider/xtream/episode/77-mkv',
  metadata: { kind: 'series-episode', seriesId: '9', seriesTitle: 'Show', seasonNumber: 1, episodeNumber: 2 },
};

const manifestFetch = async () => new Response('#EXTM3U\n#EXTINF:10,\nseg.ts\n', { status: 200 });

test('watch state path defaults beside the room database and honours the override', () => {
  assert.equal(
    watchStatePathFor({}, '/data/hearmeout/rooms.sqlite'),
    join('/data/hearmeout', HEARMEOUT_WATCH_STATE_FILE),
  );
  assert.equal(
    watchStatePathFor({ HEARMEOUT_WATCH_STATE_PATH: ' /srv/watch.sqlite ' }, '/data/rooms.sqlite'),
    '/srv/watch.sqlite',
  );
});

test('the episode HLS route is accepted and foreign or traversal routes are refused', () => {
  assert.ok(hearMeOutMovieProviderUrl(`${origin}/api/watch/xtream/hls/episode-77-mkv/index.m3u8`, origin));
  assert.ok(hearMeOutMovieProviderUrl(`${origin}/api/watch/xtream/hls/episode-77-mkv/seg001.ts`, origin));
  assert.equal(hearMeOutMovieProviderUrl(`https://evil.example.test/api/watch/xtream/hls/episode-77-mkv/index.m3u8`, origin), undefined);
  assert.equal(hearMeOutMovieProviderUrl(`${origin}/api/watch/xtream/hls/episode-77-mkv/../../x.m3u8`, origin), undefined);
  assert.equal(hearMeOutMovieProviderUrl(`https://user:pass@donor.example.test/api/watch/xtream/hls/episode-77-mkv/index.m3u8`, origin), undefined);
});

test('a request with no catalog match returns no-match and never reaches the provider fetch', async () => {
  let fetched = 0;
  await withRuntime({
    findSeriesEpisode: async () => null,
    getNextSeriesEpisode: async () => null,
    fetchImpl: async () => { fetched += 1; return new Response('', { status: 500 }); },
  }, async runtime => {
    const result = await runtime.request(scope, 'nothing here');
    assert.deepEqual(result, { status: 'no-match' });
  });
  assert.equal(fetched, 0);
});

test('a matched episode is prepared through the validated HLS route and returned as an IPTV item', async () => {
  const calls = [];
  await withRuntime({
    findSeriesEpisode: async () => episodeEntry,
    getNextSeriesEpisode: async () => null,
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return manifestFetch(); },
  }, async runtime => {
    const result = await runtime.request(scope, 'show');
    assert.equal(result.status, 'matched');
    assert.equal(result.item.source, 'iptv');
    assert.equal(result.item.title, 'Show S1E2');
    assert.match(result.item.playbackUrl, /\/api\/watch\/xtream\/hls\/episode-77-mkv\/index\.m3u8$/);
    assert.ok(result.item.playbackUrl.startsWith(origin + '/'));
    assert.doesNotMatch(result.item.playbackUrl, /activity-provider|password|token|username/i);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
});

test('a provider that keeps answering 202 fails closed instead of returning a playable item', async () => {
  await withRuntime({
    findSeriesEpisode: async () => episodeEntry,
    getNextSeriesEpisode: async () => null,
    fetchImpl: async () => new Response('', { status: 202 }),
  }, async runtime => {
    await assert.rejects(runtime.request(scope, 'show'), /still preparing/);
  });
});

test('a non-playlist provider body is refused', async () => {
  await withRuntime({
    findSeriesEpisode: async () => episodeEntry,
    getNextSeriesEpisode: async () => null,
    fetchImpl: async () => new Response('<html>login</html>', { status: 200 }),
  }, async runtime => {
    await assert.rejects(runtime.request(scope, 'show'), /did not return playable episode media/);
  });
});

test('a provider redirect is never followed', async () => {
  await withRuntime({
    findSeriesEpisode: async () => episodeEntry,
    getNextSeriesEpisode: async () => null,
    fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://evil.example.test/x.m3u8' } }),
  }, async runtime => {
    await assert.rejects(runtime.request(scope, 'show'), /could not prepare that episode \(HTTP 302\)/);
  });
});
