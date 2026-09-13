import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { SpmtHearMeOutSuiteMediaResolver, hearMeOutYoutubeId } from '../apps/hearmeout/dist/suite-action-executor.js';
import { YtDlpHearMeOutResolverAdapter } from '../apps/hearmeout/dist/execution-worker.js';
import { createHearMeOutWebServer } from '../apps/hearmeout/dist/web-server-v3.js';
import { SqliteHearMeOutRoomMediaRuntime } from '../apps/hearmeout/dist/room-media-core.js';

function fixtureClient() {
  const jobs = [], worker = { workerId: 'sprite-hmo', state: 'ready', providerHealthy: true, executionTarget: 'sprite', capabilityIds: ['hearmeout.music.search', 'hearmeout.youtube.resolve'], tenantIds: ['tenant'], leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
  const receipts = new Map();
  const client = { async listExecutionWorkers() { return [worker]; }, async getExecutionJob() { throw Error('Completed fixtures should not poll'); }, async createExecutionJob(tenantId, job, key) {
    jobs.push({ tenantId, ...job, key });
    if(receipts.has(key)) return receipts.get(key);
    if (job.input.query === 'missing') return { job: { state: 'failed', error: { message: 'Provider search unavailable' } } };
    const receipt = { job: { state: 'succeeded', result: job.capabilityId.endsWith('search') ? { items: [{ id: 'abcdefghijk', title: 'New uncached song', url: 'https://youtu.be/abcdefghijk' }] } : { media: { title: 'Resolved song', audioUrl: 'https://rr1.googlevideo.com/audio', videoUrl: 'https://rr1.googlevideo.com/video', durationMs: 123000, resolvedAt: new Date().toISOString() } } } }; receipts.set(key, receipt); return receipt;
  } };
  return { client, jobs, worker };
}

test('title and YouTube page requests choose a current capable worker and resolve actual media', async () => {
  const f = fixtureClient(), resolver = new SpmtHearMeOutSuiteMediaResolver(f.client);
  const item = await resolver.resolve({ tenantId: 'tenant', query: 'new song title', lane: 'music', operationId: 'request-1' });
  assert.equal(item.playbackUrl, 'https://rr1.googlevideo.com/audio'); assert.equal(item.metadata.videoId, 'abcdefghijk');
  assert.deepEqual(f.jobs.map(j => [j.capabilityId, j.executionTarget]), [['hearmeout.music.search', 'sprite'], ['hearmeout.youtube.resolve', 'sprite']]);
  const keys = f.jobs.map(j => j.key); await resolver.resolve({ tenantId: 'tenant', query: 'new song title', lane: 'music', operationId: 'request-1' }); assert.deepEqual(f.jobs.slice(2).map(j => j.key), keys);
  const movie = await resolver.resolve({ tenantId: 'tenant', query: 'https://www.youtube.com/watch?v=abcdefghijk', lane: 'movie' }); assert.equal(movie.playbackUrl, 'https://rr1.googlevideo.com/video');
  f.worker.leaseExpiresAt = new Date(0).toISOString(); await assert.rejects(() => resolver.resolve({ tenantId: 'tenant', query: 'song', lane: 'music' }), /No HearMeOut media worker/);
  const count = f.jobs.length; const direct = await resolver.resolve({ tenantId: 'tenant', query: 'https://media.example/owned.mp3', lane: 'music' }); assert.equal(direct.playbackUrl, 'https://media.example/owned.mp3'); assert.equal(f.jobs.length, count);
  assert.equal(hearMeOutYoutubeId('https://music.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk'); assert.equal(hearMeOutYoutubeId('https://youtu.be.evil.example/abcdefghijk'), undefined); assert.throws(() => hearMeOutYoutubeId('https://youtube.com/playlist?list=x'), /video link/);
});

test('room requests use the same resolver, replay once and preserve media after provider failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hmo-provider-ui-'));
  const spmt = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ actorId: 'owner', displayName: 'Owner', tenantIds: ['tenant'], scopes: ['admin'] })); });
  await new Promise(resolve => spmt.listen(0, '127.0.0.1', resolve));
  const f = fixtureClient(), host = createHearMeOutWebServer({ spmtOrigin: `http://127.0.0.1:${spmt.address().port}`, databasePath: join(dir, 'rooms.sqlite'), port: 0, suiteMediaResolver: new SpmtHearMeOutSuiteMediaResolver(f.client) });
  await host.listen(); const rooms = new SqliteHearMeOutRoomMediaRuntime(join(dir, 'rooms.sqlite'));
  const owner = { tenantId: 'tenant', userId: 'owner', displayName: 'Owner', roles: ['admin'] }; rooms.createRoom(owner, { roomId: 'room', name: 'Music', privacy: 'public', operationId: 'create' });
  const origin = `http://127.0.0.1:${host.server.address().port}`, add = (query, key) => fetch(origin + '/api/hearmeout/rooms/room/media/music', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ query }) });
  try {
    assert.equal((await add('uncached title', 'once')).status, 201); assert.equal((await add('uncached title', 'once')).status, 201);
    const before = rooms.getSession('tenant', 'room', 'music'); assert.equal(before.current.item.source, 'youtube'); assert.equal(before.queue.length, 0);
    assert.equal((await add('missing', 'failure')).status, 400); assert.deepEqual(rooms.getSession('tenant', 'room', 'music'), before);
  } finally { rooms.close(); await host.close(); await new Promise(resolve => spmt.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('yt-dlp search treats the query as data and video selection retains audio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hmo-ytdlp-')), binary = join(dir, 'yt-dlp');
  await writeFile(binary, `#!/usr/bin/env node\nconst args=process.argv.slice(2);if(args.includes('--flat-playlist')){if(args.at(-2)!=='--')process.exit(2);console.log(JSON.stringify({entries:[{id:'abcdefghijk',title:'Title',channel:'Artist',duration:90}]}));}else{console.log(JSON.stringify({title:'Title',formats:[{url:'https://rr1.googlevideo.com/combined',vcodec:'h264',acodec:'aac'},{url:'https://rr1.googlevideo.com/silent',vcodec:'h264',acodec:'none'},{url:'https://rr1.googlevideo.com/audio',vcodec:'none',acodec:'opus'}]}));}`);
  await chmod(binary, 0o755);
  try { const adapter = new YtDlpHearMeOutResolverAdapter(binary); const found = await adapter.search('--output $(bad); artist', 5); assert.equal(found[0].duration, 90000); const resolved = await adapter.ytDlp('abcdefghijk'); assert.equal(resolved.videoUrl, 'https://rr1.googlevideo.com/combined'); assert.equal(resolved.audioUrl, 'https://rr1.googlevideo.com/audio'); } finally { await rm(dir, { recursive: true, force: true }); }
});
