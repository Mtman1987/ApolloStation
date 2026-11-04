import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleXtreamHlsRequest} from '../apps/hearmeout/dist/xtream-hls-route.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';

const SEGMENT = 'private-fixture-media';
const PATH = '/api/watch/xtream/hls/vod-42/';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hmo-private-hls-'));
  const previous = process.env.HEARMEOUT_HLS_DIR;
  process.env.HEARMEOUT_HLS_DIR = join(dir, 'hls');
  await mkdir(join(process.env.HEARMEOUT_HLS_DIR, 'vod-42'), {recursive: true});
  for (const [file, body] of Object.entries({
    'index.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nstream_0.m3u8\n',
    'stream_0.m3u8': '#EXTM3U\n#EXTINF:6,\nseg_00001.ts\n#EXT-X-ENDLIST\n',
    'seg_00001.ts': SEGMENT,
  })) await writeFile(join(process.env.HEARMEOUT_HLS_DIR, 'vod-42', file), body);
  t.after(async () => {
    if (previous === undefined) delete process.env.HEARMEOUT_HLS_DIR;
    else process.env.HEARMEOUT_HLS_DIR = previous;
    await rm(dir, {recursive: true, force: true});
  });
  return {dir};
}

async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function privateResponse(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie, Authorization');
}

function routeServer(authorize) {
  return createServer(async (request, response) => {
    try {
      const handled = await handleXtreamHlsRequest(request, response, new URL(request.url, 'http://fixture').pathname, authorize);
      if (!handled) { response.writeHead(404); response.end(); }
    } catch { response.writeHead(500); response.end('fixture failure'); }
  });
}

test('authorized master, variant, segment and byte range cannot enter shared HTTP caches', async t => {
  await fixture(t);
  let checks = 0;
  const base = await listen(t, routeServer(async (_request, id) => {
    checks++;
    assert.equal(id, 'vod-42');
  }));
  for (const [file, headers, status, expected] of [
    ['index.m3u8', {}, 200, '#EXTM3U'],
    ['stream_0.m3u8', {}, 200, '#EXTM3U'],
    ['seg_00001.ts', {}, 200, SEGMENT],
    ['seg_00001.ts', {range: 'bytes=2-5'}, 206, SEGMENT.slice(2, 6)],
  ]) {
    const before = checks;
    const response = await fetch(base + PATH + file, {headers, signal: AbortSignal.timeout(10000)});
    assert.equal(response.status, status);
    privateResponse(response);
    assert.ok((await response.text()).startsWith(expected));
    assert.equal(checks - before, 2, 'authorize before lookup and immediately before sending bytes');
    if (status === 206) assert.equal(response.headers.get('content-range'), `bytes 2-5/${SEGMENT.length}`);
  }
});

for (const file of ['index.m3u8', 'stream_0.m3u8', 'seg_00001.ts']) {
  test(`revocation during preparation refuses ${file} before any media bytes`, async t => {
    await fixture(t);
    let checks = 0;
    const base = await listen(t, routeServer(async () => {
      if (++checks === 2) throw Object.assign(Error('revoked'), {status: 403});
    }));
    const response = await fetch(base + PATH + file, {signal: AbortSignal.timeout(10000)});
    assert.equal(response.status, 403);
    privateResponse(response);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), {error: 'playback_forbidden'});
    assert.doesNotMatch(body, /private-fixture-media|#EXTM3U/);
    assert.equal(checks, 2);
  });
}

test('mounted private-room HLS checks tenant, session, membership, leave and active playback for every segment', async t => {
  const {dir} = await fixture(t);
  const users = {
    owner: {actorId: 'owner', displayName: 'Owner', tenantIds: ['crew'], scopes: []},
    outsider: {actorId: 'outsider', displayName: 'Outsider', tenantIds: ['crew'], scopes: []},
    other: {actorId: 'owner', displayName: 'Other tenant', tenantIds: ['other'], scopes: []},
  };
  const spmtOrigin = await listen(t, createServer((request, response) => {
    const sid = /sid=([^;]+)/.exec(String(request.headers.cookie ?? ''))?.[1];
    const user = users[sid];
    response.writeHead(request.url === '/v1/session' && user ? 200 : 401, {'content-type': 'application/json'});
    response.end(JSON.stringify(user ?? {}));
  }));
  const databasePath = join(dir, 'rooms.sqlite');
  const rooms = new SqliteHearMeOutRoomMediaRuntime(databasePath);
  const owner = {tenantId: 'crew', userId: 'owner', displayName: 'Owner', roles: ['member']};
  rooms.createRoom(owner, {roomId: 'private', name: 'Private', privacy: 'private', password: 'fixture-password', operationId: 'create'});
  rooms.enqueue(owner, {roomId: 'private', lane: 'movie', operationId: 'queue', item: {
    itemId: 'film', type: 'movie', title: 'Fixture', source: 'test', playbackUrl: PATH + 'index.m3u8',
  }});
  const host = createHearMeOutWebServer({spmtOrigin, databasePath, port: 0});
  t.after(async () => { await host.close(); rooms.close(); });
  await host.listen();
  const base = `http://127.0.0.1:${host.server.address().port}`;
  async function read(sid) {
    const response = await fetch(base + PATH + 'seg_00001.ts', {
      headers: sid ? {cookie: `sid=${sid}`} : {}, signal: AbortSignal.timeout(10000),
    });
    privateResponse(response);
    return {status: response.status, body: await response.text()};
  }
  assert.deepEqual(await read('owner'), {status: 200, body: SEGMENT});
  for (const sid of [undefined, 'outsider', 'other']) {
    const denied = await read(sid);
    assert.equal(denied.status, sid === undefined ? 401 : 403, String(sid));
    assert.doesNotMatch(denied.body, /private-fixture-media/);
  }
  rooms.leaveRoom(owner, 'private', 'leave');
  assert.equal((await read('owner')).status, 403);
  rooms.joinRoom(owner, 'private', 'return');
  assert.equal((await read('owner')).status, 200);
  rooms.control(owner, {roomId: 'private', lane: 'movie', action: 'clear', operationId: 'clear'});
  const inactive = await read('owner');
  assert.equal(inactive.status, 404);
  assert.deepEqual(JSON.parse(inactive.body), {error: 'playback_not_active'});
});
