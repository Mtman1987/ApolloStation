import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';

// HMO-011 / HMO-001 / HMO-003: real mounted room-control contracts.
// Loopback identity and deliberately failing Commlink stub; no donor execution.
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hmo-controls-'));
  const auth = createServer((req, res) => {
    const user = /sid=(alice|bob|carol|other)/.exec(String(req.headers.cookie ?? ''))?.[1];
    const ok = req.url === '/v1/session' && user;
    res.writeHead(ok ? 200 : 503, {'content-type': 'application/json'});
    res.end(JSON.stringify(ok ? {actorId: 'user-' + (user === 'other' ? 'alice' : user), displayName: user,
      tenantIds: [user === 'other' ? 'other' : 'crew'], scopes: []} : {}));
  });
  let host;
  t.after(async () => {
    try { if (host) await host.close(); }
    finally {
      try { if (auth.listening) await new Promise((done, fail) => auth.close(e => e ? fail(e) : done())); }
      finally { await rm(dir, {recursive: true, force: true}); }
    }
  });
  await new Promise((done, fail) => {auth.once('error', fail); auth.listen(0, '127.0.0.1', done);});
  host = createHearMeOutWebServer({spmtOrigin: `http://127.0.0.1:${auth.address().port}`,
    databasePath: join(dir, 'rooms.sqlite'), port: 0});
  await host.listen();
  const base = `http://127.0.0.1:${host.server.address().port}`;
  async function call(path, {user = 'alice', method = 'GET', body, key, origin = base} = {}) {
    const response = await fetch(base + '/api/hearmeout' + path, {method,
      headers: {cookie: 'sid=' + user, ...(method !== 'GET' ? {origin} : {}),
        ...(body === undefined ? {} : {'content-type': 'application/json'}), ...(key ? {'idempotency-key': key} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      redirect: 'manual', signal: AbortSignal.timeout(10000)});
    const text = await response.text();
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    return {status: response.status, body: JSON.parse(text), text};
  }
  async function create(name = 'Controls', privacy = 'public') {
    const r = await call('/rooms', {method: 'POST', body: {name, privacy}});
    assert.equal(r.status, 201, r.text); return '/rooms/' + r.body.roomId;
  }
  async function joinRoom(path, user = 'bob') {
    const r = await call(path + '/join', {user, method: 'POST', body: {}});
    assert.equal(r.status, 200, r.text);
  }
  return {call, create, joinRoom};
}

function denied(r, status) {
  assert.equal(r.status, status, r.text);
  assert.equal(r.body.error, 'hearmeout_green_request_failed');
  assert.equal(typeof r.body.message, 'string');
}

test('mounted moderation preserves mute, ban/unban, kick and timeout contracts', async t => {
  const f = await fixture(t), path = await f.create();
  await f.joinRoom(path);
  const moderate = (action, extra = {}) => f.call(path + '/moderation', {method: 'POST', body: {action, targetUserId: 'user-bob', ...extra}});
  denied(await f.call(path + '/moderation', {user: 'bob', method: 'POST', body: {action: 'mute', targetUserId: 'user-alice'}}), 403);
  for (const [action, muted] of [['mute', true], ['unmute', false]]) {
    const r = await moderate(action); assert.equal(r.status, 200, r.text);
    assert.equal(r.body.action, action); assert.equal(r.body.targetUserId, 'user-bob');
    assert.equal((await f.call(path)).body.members.find(m => m.userId === 'user-bob').serverMuted, muted);
  }
  const ban = await moderate('ban'); assert.equal(ban.status, 200);
  denied(await f.call(path + '/join', {user: 'bob', method: 'POST', body: {}}), 403);
  assert.equal((await moderate('unban')).status, 200);
  await f.joinRoom(path);
  assert.equal((await moderate('kick')).status, 200);
  assert.equal((await f.call(path)).body.members.some(m => m.userId === 'user-bob'), false);
  await f.joinRoom(path);
  const timeout = await moderate('timeout', {durationSeconds: 600});
  assert.equal(timeout.status, 200); assert.ok(Number.isFinite(Date.parse(timeout.body.expiresAt)));
  denied(await f.call(path + '/join', {user: 'bob', method: 'POST', body: {}}), 403);
});

test('moderation move and replay are room/tenant scoped with unchanged failure state', async t => {
  const f = await fixture(t), source = await f.create('Source'), target = await f.create('Destination');
  await f.joinRoom(source);
  const init = {method: 'POST', key: 'move-contract', body: {action: 'move', targetUserId: 'user-bob', targetRoomId: target.split('/').at(-1)}};
  denied(await f.call(source + '/moderation', {...init, user: 'other'}), 404);
  const moved = await f.call(source + '/moderation', init); assert.equal(moved.status, 200, moved.text);
  const replay = await f.call(source + '/moderation', init); assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, moved.body);
  const preview = await f.call(source, {user: 'bob'});
  assert.equal(preview.body.member, false); assert.equal(preview.body.move.targetRoomId, init.body.targetRoomId);
  assert.equal((await f.call(target, {user: 'bob'})).body.member, true);
  denied(await f.call(source + '/moderation', {...init, body: {...init.body, action: 'ban'}}), 400);
  assert.equal((await f.call(target, {user: 'bob'})).body.member, true);
});

test('voice waiting queue filters by user and retains invitations when Commlink fails', async t => {
  const f = await fixture(t), path = await f.create('Voice turns', 'private');
  for (const user of ['bob', 'carol']) {
    const init = {user, method: 'POST', body: {action: 'join'}};
    const first = await f.call(path + '/voice-queue', init); assert.equal(first.status, 201, first.text);
    assert.equal(first.body.state, 'waiting');
    assert.deepEqual((await f.call(path + '/voice-queue', init)).body, first.body);
    const own = await f.call(path + '/voice-queue', {user});
    assert.equal(own.status, 200); assert.equal(own.body.canManage, false);
    assert.deepEqual(own.body.entries.map(e => e.userId), ['user-' + user]);
  }
  assert.equal((await f.call(path + '/voice-queue')).body.entries.length, 2);
  denied(await f.call(path + '/voice-queue', {user: 'bob', method: 'POST', body: {action: 'next'}}), 403);
  denied(await f.call(path + '/voice-queue', {user: 'bob', method: 'POST', body: {action: 'remove', userId: 'user-carol'}}), 403);
  const invited = await f.call(path + '/voice-queue', {method: 'POST', key: 'voice-next', body: {action: 'next'}});
  assert.equal(invited.status, 200, invited.text); assert.equal(invited.body.delivery, 'pending');
  assert.equal(invited.body.entry.state, 'invited'); assert.equal(typeof invited.body.entry.invitationId, 'string');
  const guest = invited.body.entry.userId.replace('user-', '');
  const replay = await f.call(path + '/voice-queue', {method: 'POST', key: 'voice-next', body: {action: 'next'}});
  assert.equal(replay.status, 200); assert.deepEqual(replay.body.entry, invited.body.entry);
  await f.joinRoom(path, guest); // Invitation admits without a private-room password.
  assert.equal((await f.call(path + '/voice-queue')).body.entries.some(e => e.userId === invited.body.entry.userId), false);
  denied(await f.call(path + '/voice-queue', {user: 'other'}), 404);
});

test('legacy room chat retains bounded member-only payloads and Commlink read marker', async t => {
  const f = await fixture(t), path = await f.create('Chat contracts');
  denied(await f.call(path + '/chat', {user: 'bob'}), 403);
  const posted = await f.call(path + '/chat', {method: 'POST', body: {text: 'Fixture hello'}});
  assert.equal(posted.status, 201); assert.equal(posted.body.surface, 'legacy-room-chat');
  const read = await f.call(path + '/chat'); assert.equal(read.status, 200);
  assert.equal(read.body.surface, 'commlink'); assert.equal(read.body.messages.length, 1);
  for (const text of ['', 'x'.repeat(2001), 'line\nbreak']) denied(await f.call(path + '/chat', {method: 'POST', body: {text}}), 400);
  denied(await f.call(path + '/chat', {method: 'POST', body: {text: 'Foreign'}, origin: 'https://foreign.example'}), 400);
  assert.equal((await f.call(path + '/chat')).body.messages.length, 1);
});

test('radio validates membership, ownership and disabled-worker response contracts', async t => {
  const f = await fixture(t), path = await f.create('Radio contracts');
  assert.deepEqual((await f.call(path + '/radio')).body, {enabled: false, seed: '', history: []});
  denied(await f.call(path + '/radio', {user: 'bob'}), 403);
  await f.joinRoom(path);
  denied(await f.call(path + '/radio', {user: 'bob', method: 'POST', body: {enabled: false}}), 403);
  denied(await f.call(path + '/radio', {method: 'POST', body: {enabled: 'yes'}}), 400);
  denied(await f.call(path + '/radio', {method: 'POST', body: {enabled: true, seed: 'Jazz'}}), 400);
  const disabled = await f.call(path + '/radio', {method: 'POST', body: {enabled: false}});
  assert.equal(disabled.status, 200); assert.deepEqual(disabled.body, {updated: true});
  assert.equal((await f.call(path + '/radio')).body.enabled, false);
});
