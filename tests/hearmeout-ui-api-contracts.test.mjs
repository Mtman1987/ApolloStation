import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';

// HMO-011 first batch: exercise the mounted handler, not source-text matches.
// Only the fixture's loopback SPMT stub is contacted. No donor/provider runs.
// Build-dependent imports match Oracle's existing tests/*.test.mjs discovery.
const ROOT = '/api/hearmeout';
const ERROR = 'hearmeout_green_request_failed';
const users = {
  alice: {actorId: 'user-alice', displayName: 'Alice', tenantIds: ['crew'], scopes: []},
  bob: {actorId: 'user-bob', displayName: 'Bob', tenantIds: ['crew'], scopes: []},
  // Same actor ID in another tenant: identity alone must not grant room access.
  other: {actorId: 'user-alice', displayName: 'Other tenant', tenantIds: ['other'], scopes: []},
};

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hmo-ui-contracts-'));
  const calls = [];
  const auth = createServer((req, res) => {
    calls.push({path: req.url, app: req.headers['x-spmt-app']});
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(String(req.headers.cookie ?? ''))?.[1];
    const user = users[sid];
    const status = sid === 'unavailable' ? 503 : req.url === '/v1/session' && user ? 200 : 401;
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify(status === 200 ? user : {}));
  });
  let host;
  t.after(async () => {
    try { if (host) await host.close(); }
    finally {
      try { if (auth.listening) await new Promise((resolve, reject) => auth.close(e => e ? reject(e) : resolve())); }
      finally { await rm(dir, {recursive: true, force: true}); }
    }
  });
  await new Promise((resolve, reject) => {
    auth.once('error', reject);
    auth.listen(0, '127.0.0.1', resolve);
  });
  host = createHearMeOutWebServer({
    spmtOrigin: `http://127.0.0.1:${auth.address().port}`,
    databasePath: join(dir, 'rooms.sqlite'), port: 0,
  });
  await host.listen();
  const base = `http://127.0.0.1:${host.server.address().port}`;
  async function request(path, {sid = 'alice', method = 'GET', body, raw, origin = base, headers = {}} = {}) {
    const h = {...(sid ? {cookie: `sid=${sid}`} : {}), ...headers};
    if (method !== 'GET' && origin !== null) h.origin = origin;
    if (body !== undefined || raw !== undefined) h['content-type'] = 'application/json';
    const response = await fetch(base + ROOT + path, {
      method, headers: h,
      ...(raw !== undefined ? {body: raw} : body !== undefined ? {body: JSON.stringify(body)} : {}),
      redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
    return {status: response.status, body: JSON.parse(text), text};
  }
  async function create(body = {name: 'Contract Room', privacy: 'public'}) {
    const result = await request('/rooms', {method: 'POST', body});
    assert.equal(result.status, 201, result.text);
    assert.equal(typeof result.body.roomId, 'string');
    return result.body;
  }
  return {request, create, calls};
}

function failed(result, status) {
  assert.equal(result.status, status, result.text);
  assert.equal(result.body.error, ERROR);
  assert.equal(typeof result.body.message, 'string');
  assert.ok(result.body.message.length > 0 && result.body.message.length <= 400);
  assert.deepEqual(Object.keys(result.body).sort(), ['error', 'message']);
}

function entries(session) {
  return [...(session.current ? [session.current] : []), ...session.queue];
}

test('room create/list/detail/join/presence/leave contracts match browser consumers', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/rooms')).body, {rooms: []});
  const room = await f.create();
  assert.equal(room.schemaVersion, 1);
  assert.equal(room.tenantId, 'crew');
  assert.equal(room.ownerUserId, 'user-alice');
  assert.equal(room.privacy, 'public');
  assert.ok(Number.isFinite(Date.parse(room.expiresAt)));
  const path = `/rooms/${room.roomId}`;
  const listed = await f.request('/rooms');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.rooms[0].roomId, room.roomId);
  assert.equal(listed.body.rooms[0].member, true);
  assert.equal(listed.body.rooms[0].canManage, true);
  const lobby = await f.request(path, {sid: 'bob'});
  assert.equal(lobby.status, 200);
  assert.equal(lobby.body.lobby, true);
  assert.equal(lobby.body.member, false);
  assert.equal(lobby.body.viewer.canManage, false);
  assert.equal('music' in lobby.body, false);
  const joined = await f.request(path + '/join', {sid: 'bob', method: 'POST', body: {}});
  assert.equal(joined.status, 200);
  assert.equal(joined.body.roomId, room.roomId);
  const presence = await f.request(path + '/presence', {sid: 'bob', method: 'POST', body: {connectionId: 'browser-1'}});
  assert.equal(presence.status, 200);
  assert.equal(presence.body.userId, 'user-bob');
  assert.equal(presence.body.connectionId, 'browser-1');
  const detail = await f.request(path, {sid: 'bob'});
  assert.equal(detail.status, 200);
  assert.equal(detail.body.member, true);
  for (const key of ['members', 'presence', 'chat', 'personas']) assert.ok(Array.isArray(detail.body[key]), key);
  for (const lane of ['music', 'movie']) {
    assert.ok(Array.isArray(detail.body[lane].queue));
    assert.equal(detail.body[lane].broadcast.configured, false);
    assert.equal(detail.body[lane].broadcast.playbackUrl, `${ROOT}${path}/broadcast/${lane}/index.m3u8`);
  }
  const left = await f.request(path + '/leave', {sid: 'bob', method: 'POST'});
  assert.equal(left.status, 200);
  assert.deepEqual(left.body, {left: true});
  const after = await f.request(path);
  assert.equal(after.body.members.some(m => m.userId === 'user-bob'), false);
  assert.equal(after.body.presence.some(p => p.userId === 'user-bob'), false);
  assert.ok(f.calls.every(c => c.path === '/v1/session' && c.app === 'hearmeout'));
});

test('private room summaries and previews hide state until password admission', async t => {
  const f = await fixture(t);
  const password = 'fixture-password-123';
  const room = await f.create({name: 'Private Contract', privacy: 'private', password});
  const path = `/rooms/${room.roomId}`;
  const listed = await f.request('/rooms', {sid: 'bob'});
  assert.deepEqual(Object.keys(listed.body.rooms[0]).sort(), ['locked', 'member', 'name', 'participantCount', 'privacy', 'roomId']);
  assert.equal(listed.body.rooms[0].locked, true);
  const preview = await f.request(path, {sid: 'bob'});
  assert.equal(preview.status, 200);
  assert.equal(preview.body.locked, true);
  for (const key of ['music', 'movie', 'members', 'presence', 'chat', 'personas']) assert.equal(key in preview.body, false, key);
  for (const body of [{}, {password: 'wrong-password'}]) {
    // Current message-based classifier maps "admission" to 400 (known gap).
    failed(await f.request(path + '/join', {sid: 'bob', method: 'POST', body}), 400);
    assert.equal((await f.request(path, {sid: 'bob'})).body.member, false);
  }
  const admitted = await f.request(path + '/join', {sid: 'bob', method: 'POST', body: {password}});
  assert.equal(admitted.status, 200);
  const detail = await f.request(path, {sid: 'bob'});
  assert.equal(detail.body.member, true);
  for (const r of [listed, preview, admitted, detail]) {
    assert.equal(r.text.includes(password), false);
    assert.doesNotMatch(r.text, /password_hash|password_salt/);
  }
});

test('tenant boundaries and owner-only deletion are enforced by mounted routes', async t => {
  const f = await fixture(t);
  const room = await f.create();
  const path = `/rooms/${room.roomId}`;
  assert.deepEqual((await f.request('/rooms', {sid: 'other'})).body, {rooms: []});
  const absent = await f.request(path, {sid: 'other'});
  assert.equal(absent.status, 404);
  assert.equal(absent.body.error, 'room_not_found');
  failed(await f.request(path + '/join', {sid: 'other', method: 'POST', body: {}}), 404);
  await f.request(path + '/join', {sid: 'bob', method: 'POST', body: {}});
  failed(await f.request(path, {sid: 'bob', method: 'DELETE'}), 403);
  assert.equal((await f.request(path)).status, 200);
  const deleted = await f.request(path, {method: 'DELETE'});
  assert.equal(deleted.status, 200);
  assert.equal((await f.request(path)).status, 404);
  assert.deepEqual((await f.request('/rooms')).body, {rooms: []});
});

test('session failures use stable 401/503 envelopes before room mutation', async t => {
  const f = await fixture(t);
  for (const [sid, status] of [[null, 401], ['unavailable', 503]]) {
    failed(await f.request('/rooms', {sid}), status);
    failed(await f.request('/rooms', {sid, method: 'POST', body: {name: 'Must not exist'}}), status);
  }
  assert.deepEqual((await f.request('/rooms')).body, {rooms: []});
});

test('create rejects malformed/object-shape/size/name inputs without a room', async t => {
  const f = await fixture(t);
  const cases = [
    {raw: '{'}, {raw: 'null'}, {raw: '[]'}, {raw: '"text"'},
    {body: {}}, {body: {name: 42}}, {body: {name: ' trailing '}},
    {body: {name: 'x'.repeat(121)}}, {body: {name: 'line\nbreak'}},
    {body: {name: 'nul\0byte'}},
    {body: {name: 'Large body', padding: 'x'.repeat(64 * 1024)}},
  ];
  for (const input of cases) {
    failed(await f.request('/rooms', {method: 'POST', ...input}), 400);
    assert.deepEqual((await f.request('/rooms')).body, {rooms: []});
  }
});

test('cross-host mutations are refused before changing room or queue state', async t => {
  const f = await fixture(t);
  const room = await f.create();
  const path = `/rooms/${room.roomId}`;
  const cases = [
    ['/rooms', 'POST', {name: 'Cross origin'}], [path, 'DELETE'],
    [path + '/join', 'POST', {}], [path + '/leave', 'POST'],
    [path + '/presence', 'POST', {connectionId: 'bad'}],
    [path + '/media/music', 'POST', {title: 'Track', playbackUrl: 'https://media.example/track.mp3'}],
    [path + '/media/music/control', 'POST', {action: 'clear'}],
  ];
  for (const [route, method, body] of cases) {
    const r = await f.request(route, {method, body, origin: 'https://foreign.example'});
    failed(r, 400); // Current legacy helper maps invalid origin to 400, not 403.
    assert.match(r.body.message, /origin is invalid/);
  }
  const detail = await f.request(path);
  assert.equal(detail.body.member, true);
  assert.equal(entries(detail.body.music).length, 0);
  assert.equal(detail.body.presence.length, 0);
  assert.equal((await f.request('/rooms')).body.rooms.length, 1);
});

test('member-only routes reject an authenticated outsider with a stable envelope', async t => {
  const f = await fixture(t);
  const room = await f.create();
  const path = `/rooms/${room.roomId}`;
  for (const [suffix, method, body] of [
    ['/presence', 'POST', {connectionId: 'outsider'}], ['/chat', 'GET'],
    ['/media/music', 'POST', {title: 'Track', playbackUrl: 'https://media.example/track.mp3'}],
    ['/media/music/control', 'POST', {action: 'clear'}],
  ]) failed(await f.request(path + suffix, {sid: 'bob', method, body}), 403);
  assert.equal(entries((await f.request(path)).body.music).length, 0);
});

test('music enqueue replay and favorites are scoped to actor and tenant', async t => {
  const f = await fixture(t);
  const room = await f.create();
  const path = `/rooms/${room.roomId}`;
  const body = {title: 'Fixture track', playbackUrl: 'https://media.example/track.mp3', durationSeconds: 90};
  const init = {method: 'POST', body, headers: {'idempotency-key': 'music-1'}};
  const first = await f.request(path + '/media/music', init);
  assert.equal(first.status, 201, first.text);
  const replay = await f.request(path + '/media/music', init);
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, first.body);
  const queued = entries(first.body);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].item.title, body.title);
  assert.equal(queued[0].item.type, 'music');
  assert.equal(queued[0].item.durationSeconds, 90);
  const saved = await f.request('/music/favorites', {method: 'POST', body: {roomId: room.roomId, requestId: queued[0].requestId}});
  assert.equal(saved.status, 201, saved.text);
  const library = await f.request('/music/library');
  assert.equal(library.status, 200);
  for (const key of ['favorites', 'recent', 'mostPlayed']) assert.ok(Array.isArray(library.body[key]));
  assert.equal(library.body.favorites.length, 1);
  for (const sid of ['bob', 'other']) {
    assert.deepEqual((await f.request('/music/library', {sid})).body.favorites, []);
  }
  const itemId = library.body.favorites[0].itemId;
  await f.request(path + '/join', {sid: 'bob', method: 'POST', body: {}});
  failed(await f.request(`/music/favorites/${itemId}`, {sid: 'bob', method: 'POST', body: {roomId: room.roomId}}), 404);
  const distinct = await f.request(path + '/media/music', {...init, headers: {'idempotency-key': 'music-2'}});
  assert.equal(distinct.status, 201);
  assert.equal(entries(distinct.body).length, 2);
  assert.equal(entries((await f.request(path)).body.music).length, 2);
  const paused = await f.request(path + '/media/music/control', {method: 'POST', body: {action: 'pause'}});
  assert.equal(paused.status, 200);
  assert.equal(paused.body.playback.status, 'paused');
  assert.equal(entries(paused.body).length, 2);
  const removed = await f.request(`/music/favorites/${itemId}`, {method: 'DELETE'});
  assert.equal(removed.status, 200);
  assert.deepEqual((await f.request('/music/library')).body.favorites, []);
  const cleared = await f.request(path + '/media/music/control', {method: 'POST', body: {action: 'clear'}});
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.playback.status, 'idle');
  assert.equal(entries(cleared.body).length, 0);
});

test('invalid media and library contracts leave the music queue unchanged', async t => {
  const f = await fixture(t);
  const room = await f.create();
  const path = `/rooms/${room.roomId}`;
  for (const body of [
    {title: 'Track', playbackUrl: 'file:///etc/passwd'},
    {title: 'Track', playbackUrl: 'https://name:password@media.example/track.mp3'},
    {title: 'Track', playbackUrl: 'https://media.example/track.mp3', durationSeconds: -1},
  ]) failed(await f.request(path + '/media/music', {method: 'POST', body}), 400);
  failed(await f.request(path + '/media/music/control', {method: 'POST', body: {action: 'invalid'}}), 400);
  for (const offset of ['-1', '1.5', 'NaN']) failed(await f.request('/music/library?offset=' + offset), 400);
  assert.equal(entries((await f.request(path)).body.music).length, 0);
});

test('unknown paths and unsupported room methods retain the current 404 contract', async t => {
  const f = await fixture(t);
  for (const [path, method] of [['/unknown-contract-route', 'GET'], ['/rooms', 'PUT']]) {
    const result = await f.request(path, {method});
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, {error: 'not_found', message: 'Unknown HearMeOut Green route'});
  }
});
