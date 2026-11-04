import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteHearMeOutRoomMediaRuntime } from '../apps/hearmeout/dist/room-media-core.js';

test('saved music survives room expiry, can be removed, and never crosses user or tenant boundaries', () => {
  const rooms = new SqliteHearMeOutRoomMediaRuntime(':memory:'), user = { tenantId: 'tenant', userId: 'alice', displayName: 'Alice', roles: ['member'] };
  const item = { itemId: 'song', type: 'music', title: 'Song', source: 'user-url', playbackUrl: 'https://example.com/song.mp3' }, now = '2026-09-01T00:00:00Z';
  try {
    rooms.createRoom(user, { roomId: 'old', name: 'Old room', privacy: 'public', operationId: 'create-old', now });
    const saved = rooms.saveFavorite(user, item, now);
    rooms.enqueue(user, { roomId: 'old', lane: 'music', item, operationId: 'first-play', now });
    rooms.enqueue(user, { roomId: 'old', lane: 'music', item, operationId: 'first-play', now });
    rooms.control(user, { roomId: 'old', lane: 'music', action: 'pause', operationId: 'pause', now });
    rooms.control(user, { roomId: 'old', lane: 'music', action: 'play', operationId: 'resume', now });
    assert.equal(rooms.musicLibrary(user).recent[0].playCount, 1, 'resume and retry do not inflate play counts');
    rooms.pruneExpiredRooms('2026-09-02T00:00:00Z');
    assert.equal(rooms.listRooms(user).length, 0);
    assert.equal(rooms.musicLibrary(user).favorites[0].item.title, 'Song');
    assert.equal(rooms.musicLibrary({ ...user, userId: 'bob' }).favorites.length, 0);
    assert.equal(rooms.musicLibrary({ ...user, tenantId: 'other' }).favorites.length, 0);
    rooms.removeFavorite({ ...user, userId: 'bob' }, saved.itemId);
    assert.equal(rooms.musicLibrary(user).favorites.length, 1);
    rooms.createRoom(user, { roomId: 'new', name: 'New room', privacy: 'public', operationId: 'create-new' });
    rooms.queueFavorite(user, 'new', saved.itemId, 'second-play');
    assert.equal(rooms.getSession('tenant', 'new', 'music').current.item.title, 'Song');
    assert.equal(rooms.musicLibrary(user).mostPlayed[0].playCount, 2);
    rooms.removeFavorite(user, saved.itemId);
    assert.equal(rooms.musicLibrary(user).favorites.length, 0);
    assert.equal(rooms.musicLibrary(user).recent.length, 1);
  } finally { rooms.close(); }
});
