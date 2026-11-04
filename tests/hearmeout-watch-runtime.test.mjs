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

const origin = 'https://provider.example.test';
const scope = { tenantId: 'tenant', userId: 'alice' };

function withRuntime(options, run) {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-watch-runtime-'));
  const runtime = createHearMeOutWatchRuntime({ statePath: join(dir, 'watch-state.sqlite'), ...options });
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

test('watch state path defaults beside the room database and honours the override', () => {
  assert.equal(watchStatePathFor({}, '/data/hearmeout/rooms.sqlite'), join('/data/hearmeout', HEARMEOUT_WATCH_STATE_FILE));
  assert.equal(watchStatePathFor({ HEARMEOUT_WATCH_STATE_PATH: ' /srv/watch.sqlite ' }, '/data/rooms.sqlite'), '/srv/watch.sqlite');
});

test('the episode HLS route validator rejects foreign and traversal URLs', () => {
  assert.ok(hearMeOutMovieProviderUrl(`${origin}/api/watch/xtream/hls/episode-77-mkv/index.m3u8`, origin));
  assert.ok(hearMeOutMovieProviderUrl(`${origin}/api/watch/xtream/hls/episode-77-mkv/seg001.ts`, origin));
  assert.equal(hearMeOutMovieProviderUrl('https://evil.example.test/api/watch/xtream/hls/episode-77-mkv/index.m3u8', origin), undefined);
  assert.equal(hearMeOutMovieProviderUrl(`${origin}/api/watch/xtream/hls/episode-77-mkv/../../x.m3u8`, origin), undefined);
  assert.equal(hearMeOutMovieProviderUrl('https://user:pass@provider.example.test/api/watch/xtream/hls/episode-77-mkv/index.m3u8', origin), undefined);
});

test('a request with no catalog match returns no-match without queueing', async () => {
  await withRuntime({ findSeriesEpisode: async () => null, getNextSeriesEpisode: async () => null }, async runtime => {
    assert.deepEqual(await runtime.request(scope, 'nothing here'), { status: 'no-match' });
  });
});

test('a matched episode queues only its Apollo HLS route without contacting a donor', async () => {
  await withRuntime({ findSeriesEpisode: async () => episodeEntry, getNextSeriesEpisode: async () => null }, async runtime => {
    const result = await runtime.request(scope, 'show');
    assert.equal(result.status, 'matched');
    assert.equal(result.item.source, 'iptv');
    assert.equal(result.item.title, 'Show S1E2');
    assert.equal(result.item.itemId, episodeEntry.id);
    assert.equal(result.item.playbackUrl, '/api/watch/xtream/hls/episode-77-mkv/index.m3u8');
    assert.match(result.item.playbackUrl, /^\/api\/watch\/xtream\/hls\//);
    assert.doesNotMatch(result.item.playbackUrl, /activity-provider|https?:\/\/|password|token|username/i);
  });
});

test('a matched item with a non-Apollo playback route fails closed', async () => {
  await withRuntime({ findSeriesEpisode: async () => ({ ...episodeEntry, playbackUrl: 'https://provider.example/secret.m3u8' }), getNextSeriesEpisode: async () => null }, async runtime => {
    await assert.rejects(runtime.request(scope, 'show'), /Invalid Apollo IPTV playback route/);
  });
});
