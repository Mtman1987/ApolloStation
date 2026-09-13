import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { HearMeOutRoomRtcGateway } from '../apps/hearmeout/dist/rtc-room-gateway.js';

async function fixture(t) {
  const allowed = new Set(['alice', 'bob', 'outsider']);
  const muted = new Set();
  let sessionStatus = 200;
  const server = createServer();
  const gateway = new HearMeOutRoomRtcGateway({
    resolvePrincipal: async request => {
      if (sessionStatus !== 200) throw Object.assign(new Error('Session unavailable'), { status: sessionStatus });
      const userId = request.headers.cookie?.replace('session=', '');
      if (!allowed.has(userId)) throw Object.assign(new Error('No session'), { status: 401 });
      return { userId, tenantId: userId === 'outsider' ? 'other-tenant' : 'tenant', displayName: userId, roles: ['member'] };
    },
    requireMembership: (principal, roomId) => { if (roomId !== 'room' || !allowed.has(principal.userId)) throw new Error('Not admitted'); },
    membershipCheckMs: 50, iceServers: [],
    isServerMuted: (_tenantId, _roomId, userId) => muted.has(userId),
  });
  gateway.attach(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { gateway.close(); await new Promise(resolve => server.close(resolve)); });
  const connect = async user => {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/hearmeout/rtc?roomId=room', { headers: { Origin: origin, Cookie: `session=${user}` } });
    const messages = [];
    socket.on('message', (value, binary) => messages.push(binary ? Buffer.from(value) : JSON.parse(value)));
    await once(socket, 'open');
    return { socket, messages, send: message => socket.send(JSON.stringify(message)), async next(predicate) {
      for (let i = 0; i < 300; i++) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Expected RTC message did not arrive');
    } };
  };
  return { connect, allowed, muted, gateway, setStatus: status => { sessionStatus = status; } };
}

test('server mute drops relay frames even when the sender ignores its microphone state', async t => {
  const { connect, gateway, muted } = await fixture(t), alice = await connect('alice'), bob = await connect('bob');
  const direct = await alice.next(value => value.mode === 'peer-webrtc');
  alice.send({ type: 'failed', epoch: direct.epoch, transport: 'peer-webrtc', reason: 'test fallback' });
  await bob.next(value => value.mode === 'wss-relay');
  muted.add('alice'); await gateway.moderateMember('tenant', 'room', 'alice', 'mute');
  await bob.next(value => value.type === 'room' && value.peers.some(peer => peer.userId === 'alice' && peer.serverMuted));
  alice.socket.send(Buffer.alloc(1280, 45));
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(bob.messages.some(Buffer.isBuffer), false);
  muted.delete('alice'); await gateway.moderateMember('tenant', 'room', 'alice', 'unmute');
  await bob.next(value => value.type === 'room' && value.epoch > direct.epoch + 1 && value.peers.every(peer => !peer.serverMuted));
  alice.socket.send(Buffer.alloc(1280, 45)); assert.equal((await bob.next(Buffer.isBuffer)).length, 1292);
  const closed = once(alice.socket, 'close');
  await gateway.moderateMember('tenant', 'room', 'alice', 'move', 'destination');
  assert.equal((await alice.next(value => value.type === 'move')).targetRoomId, 'destination');
  assert.equal((await closed)[0], 4403);
});

test('the room gateway reuses SPMT capacity instead of rejecting the ninth connection', async t => {
  const { connect, gateway, allowed } = await fixture(t); let last;
  for (let index = 0; index < 9; index++) { const userId = 'participant-' + index; allowed.add(userId); last = await connect(userId); }
  assert.equal((await last.next(value => value.type === 'room' && value.peers.length === 9)).peers.length, 9);
  assert.equal(gateway.diagnostics().relay[0].participants.length, 9);
});

test('room coordinator keeps solo users idle, isolates tenants, and forwards real relay frames after a coordinated switch', { timeout: 8000 }, async t => {
  const { connect, gateway, allowed } = await fixture(t);
  const alice = await connect('alice');
  await alice.next(value => value.mode === 'waiting');
  const duplicate = await connect('alice');
  await duplicate.next(value => value.mode === 'waiting');
  const outsider = await connect('outsider');
  await outsider.next(value => value.mode === 'waiting');
  const bob = await connect('bob');
  const directA = await alice.next(value => value.mode === 'peer-webrtc');
  const directB = await bob.next(value => value.mode === 'peer-webrtc');
  assert.equal(gateway.diagnostics().rooms, 2);
  assert.equal(directA.peers.length, 3);
  assert.equal(directA.epoch, directB.epoch);
  alice.send({ type: 'failed', epoch: directA.epoch, transport: 'peer-webrtc', reason: 'ICE failed' });
  const relayA = await alice.next(value => value.mode === 'wss-relay');
  const relayB = await bob.next(value => value.mode === 'wss-relay');
  assert.equal(relayA.epoch, relayB.epoch);
  const pcm = Buffer.alloc(1280, 73);
  alice.socket.send(pcm);
  const received = await bob.next(Buffer.isBuffer);
  assert.equal(received.readUInt32BE(0), directA.id);
  assert.equal(received.readUInt32BE(8), relayB.epoch);
  assert.deepEqual(received.subarray(12), pcm);
  assert.equal(outsider.messages.some(Buffer.isBuffer), false);
  assert.equal(alice.messages.some(Buffer.isBuffer), false);
  const closed = once(bob.socket, 'close');
  allowed.delete('bob');
  assert.equal((await closed)[0], 4403);
  await alice.next(value => value.mode === 'waiting');
});

test('temporary session failures preserve a room connection but explicit expiry closes it', { timeout: 4000 }, async t => {
  const { connect, setStatus } = await fixture(t);
  const alice = await connect('alice');
  await alice.next(value => value.mode === 'waiting');
  setStatus(503);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(alice.socket.readyState, WebSocket.OPEN);
  const closed = once(alice.socket, 'close');
  setStatus(401);
  assert.equal((await closed)[0], 4403);
});
