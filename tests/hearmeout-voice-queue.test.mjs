import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteHearMeOutRoomMediaRuntime } from '../apps/hearmeout/dist/room-media-core.js';

const at = '2026-09-01T00:00:00Z', user = userId => ({ tenantId: 'tenant', userId, displayName: userId, roles: ['member'] });
test('voice admission is FIFO, private, retry safe and expires before acceptance', () => {
  const rooms = new SqliteHearMeOutRoomMediaRuntime(':memory:'), owner = user('owner'), alice = user('alice'), bob = user('bob');
  try {
    rooms.createRoom(owner, { roomId: 'private', name: 'Private', privacy: 'private', operationId: 'create', now: at });
    rooms.requestVoiceTurn(alice, 'private', at); rooms.requestVoiceTurn(alice, 'private', at);
    rooms.requestVoiceTurn(bob, 'private', '2026-09-01T00:00:01Z');
    assert.equal(rooms.voiceQueue(owner, 'private', at).length, 2);
    assert.equal(rooms.voiceQueue(bob, 'private', at).length, 1);
    assert.throws(() => rooms.admitNextVoiceTurn(bob, 'private', 'not-owner', at), /owner or an admin/);
    assert.throws(() => rooms.joinRoom(alice, 'private', 'before-invite', at), /admission/);
    const admitted = rooms.admitNextVoiceTurn(owner, 'private', 'first-invite', at);
    assert.equal(admitted.userId, 'alice');
    assert.deepEqual(rooms.admitNextVoiceTurn(owner, 'private', 'first-invite', at), admitted);
    assert.equal(rooms.voiceQueue(owner, 'private', at).find(entry => entry.userId === 'bob').state, 'waiting');
    rooms.joinRoom(alice, 'private', 'accept-invite', '2026-09-01T00:01:00Z');
    assert.equal(rooms.voiceQueue(owner, 'private', at).length, 1);
    rooms.admitNextVoiceTurn(owner, 'private', 'second-invite', at);
    assert.throws(() => rooms.joinRoom(bob, 'private', 'expired-invite', '2026-09-01T00:05:01Z'), /admission/);
    rooms.requestVoiceTurn(bob, 'private', '2026-09-01T00:06:00Z');
    rooms.admitNextVoiceTurn(owner, 'private', 'retry-invite', '2026-09-01T00:06:00Z');
    rooms.removeVoiceTurn(owner, 'private', bob.userId, '2026-09-01T00:06:01Z');
    assert.throws(() => rooms.joinRoom(bob, 'private', 'revoked-invite', '2026-09-01T00:06:02Z'), /admission/);
    rooms.requestVoiceTurn(bob, 'private', '2026-09-01T00:07:00Z');
    rooms.pruneExpiredRooms('2026-09-02T00:00:00Z');
    rooms.createRoom(owner, { roomId: 'private', name: 'Fresh', privacy: 'private', operationId: 'fresh', now: '2026-09-02T00:00:00Z' });
    assert.deepEqual(rooms.voiceQueue(owner, 'private', '2026-09-02T00:00:00Z'), []);
    assert.throws(() => rooms.joinRoom(bob, 'private', 'old-access', '2026-09-02T00:00:01Z'), /admission/);
  } finally { rooms.close(); }
});
