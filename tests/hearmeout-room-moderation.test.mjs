import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteHearMeOutRoomMediaRuntime } from "../apps/hearmeout/dist/room-media-core.js";

const at = "2026-09-01T10:00:00.000Z";
const principal = (userId, roles = ["member"]) => ({ tenantId: "tenant-a", userId, displayName: userId, roles });

function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "apollo-hmo-moderation-")), "hearmeout.sqlite");
  return new SqliteHearMeOutRoomMediaRuntime(path);
}

test("private rooms remain discoverable before password admission", () => {
  const runtime = fixture();
  try {
    const owner = principal("owner-1");
    const outsider = principal("guest-1");
    runtime.createRoom(owner, { roomId: "private-visible", name: "Private Visible", privacy: "private", password: "correct-horse", operationId: "create-private-visible", now: at });
    const visible = runtime.listRooms(outsider, at);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].name, "Private Visible");
    assert.equal(visible[0].privacy, "private");
    assert.throws(() => runtime.joinRoom(outsider, "private-visible", "join-no-password", at), /admission/);
    assert.equal(runtime.joinRoom(outsider, "private-visible", "join-with-password", at, { password: "correct-horse" }).roomId, "private-visible");
  } finally { runtime.close(); }
});

test("room owner can kick timeout and ban members and restrictions block re-entry", () => {
  const runtime = fixture();
  try {
    const owner = principal("owner-1");
    const guest = principal("guest-1");
    runtime.createRoom(owner, { roomId: "moderated", name: "Moderated", privacy: "public", operationId: "create-moderated", now: at });
    runtime.joinRoom(guest, "moderated", "join-guest-1", at);
    runtime.moderateMember(owner, { roomId: "moderated", targetUserId: guest.userId, action: "kick", operationId: "kick-guest", now: at });
    assert.equal(runtime.listMembers("tenant-a", "moderated", at).some((item) => item.userId === guest.userId), false);
    runtime.joinRoom(guest, "moderated", "rejoin-after-kick", "2026-09-01T10:00:10.000Z");
    runtime.moderateMember(owner, { roomId: "moderated", targetUserId: guest.userId, action: "timeout", durationSeconds: 600, operationId: "timeout-guest", now: "2026-09-01T10:00:20.000Z" });
    assert.throws(() => runtime.joinRoom(guest, "moderated", "join-during-timeout", "2026-09-01T10:05:00.000Z"), /timed out/);
    runtime.joinRoom(guest, "moderated", "join-after-timeout", "2026-09-01T10:10:21.000Z");
    runtime.moderateMember(owner, { roomId: "moderated", targetUserId: guest.userId, action: "ban", operationId: "ban-guest", now: "2026-09-01T10:10:22.000Z" });
    assert.throws(() => runtime.joinRoom(guest, "moderated", "join-after-ban", "2026-09-01T11:00:00.000Z"), /banned/);
  } finally { runtime.close(); }
});

test("room owner deletes an active room instead of leaving it", () => {
  const runtime = fixture();
  try {
    const owner = principal("owner-1");
    runtime.createRoom(owner, { roomId: "delete-me", name: "Delete Me", privacy: "public", operationId: "create-delete", now: at });
    assert.throws(() => runtime.leaveRoom(owner, "delete-me", "owner-leave", at), /delete the room instead/);
    assert.deepEqual(runtime.deleteRoom(owner, "delete-me", "delete-room", at), { deleted: true, roomId: "delete-me" });
    assert.equal(runtime.getRoom("tenant-a", "delete-me", at), undefined);
  } finally { runtime.close(); }
});

test("mute survives leave and re-entry, unban restores admission, and moves remain tenant scoped", () => {
  const runtime = fixture(), owner = principal('owner'), guest = principal('guest'), otherOwner = principal('other-owner');
  try {
    for (const [who, roomId, privacy] of [[owner, 'source', 'public'], [owner, 'target', 'private'], [otherOwner, 'restricted', 'private']]) runtime.createRoom(who, { roomId, name: roomId, privacy, operationId: 'create-' + roomId, now: at });
    runtime.joinRoom(guest, 'source', 'join', at);
    runtime.moderateMember(owner, { roomId: 'source', targetUserId: guest.userId, action: 'mute', operationId: 'mute', now: at });
    assert.equal(runtime.isServerMuted(owner.tenantId, 'source', guest.userId), true);
    runtime.leaveRoom(guest, 'source', 'leave', at); runtime.joinRoom(guest, 'source', 'rejoin', at);
    assert.equal(runtime.listMembers(owner.tenantId, 'source', at).find(member => member.userId === 'guest').serverMuted, true);
    assert.throws(() => runtime.moderateMember(guest, { roomId: 'source', targetUserId: 'owner', action: 'unmute', operationId: 'self-unmute', now: at }), /owner or an admin/);
    runtime.moderateMember(owner, { roomId: 'source', targetUserId: guest.userId, action: 'unmute', operationId: 'unmute', now: at });
    assert.equal(runtime.isServerMuted(owner.tenantId, 'source', guest.userId), false);
    assert.throws(() => runtime.moderateMember(owner, { roomId: 'source', targetUserId: guest.userId, action: 'move', targetRoomId: 'restricted', operationId: 'denied-move', now: at }), /admission/);
    assert.equal(runtime.listMembers(owner.tenantId, 'source', at).some(member => member.userId === guest.userId), true);
    runtime.moderateMember(owner, { roomId: 'source', targetUserId: guest.userId, action: 'move', targetRoomId: 'target', operationId: 'move', now: at });
    assert.equal(runtime.listMembers(owner.tenantId, 'source', at).some(member => member.userId === guest.userId), false);
    assert.equal(runtime.listMembers(owner.tenantId, 'target', at).some(member => member.userId === guest.userId), true);
    assert.equal(runtime.memberMovement(guest, 'source').targetRoomId, 'target');
    assert.equal(runtime.memberMovement({ ...guest, tenantId: 'other' }, 'source'), undefined);
    runtime.moderateMember(owner, { roomId: 'target', targetUserId: guest.userId, action: 'ban', operationId: 'ban-target', now: at });
    assert.equal(runtime.listRestrictions(owner, 'target', at)[0].kind, 'ban');
    runtime.moderateMember(owner, { roomId: 'target', targetUserId: guest.userId, action: 'unban', operationId: 'unban-target', now: at });
    assert.deepEqual(runtime.listRestrictions(owner, 'target', at), []);
    runtime.inviteToRoom(owner, { roomId: 'target', inviteeUserId: guest.userId, operationId: 'invite-again', now: at });
    runtime.joinRoom(guest, 'target', 'rejoin-unbanned', at, {});
    runtime.deleteRoom(owner, 'target', 'delete-target', at);
    assert.equal(runtime.memberMovement(guest, 'source'), undefined);
    runtime.deleteRoom(owner, 'source', 'delete-source', at);
    assert.equal(runtime.isServerMuted(owner.tenantId, 'source', guest.userId), false);
  } finally { runtime.close(); }
});
