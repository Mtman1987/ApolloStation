import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HEARMEOUT_PRESENCE_STALE_MS, SqliteHearMeOutRoomMediaRuntime } from "../apps/hearmeout/dist/room-media-core.js";

const at = "2026-08-23T12:00:00.000Z";
const principal = (userId, tenantId = "tenant-a", roles = ["member"]) => ({ tenantId, userId, displayName: userId, roles });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "apollo-hmo-admission-"));
  const path = join(dir, "hearmeout.sqlite");
  return { path, runtime: new SqliteHearMeOutRoomMediaRuntime(path) };
}

function rawFiles(path) {
  return [path, `${path}-wal`].filter(existsSync).map((file) => readFileSync(file).toString("latin1")).join("");
}

test("private-room passwords are enforced server-side and never persisted in plaintext", () => {
  const { path, runtime } = fixture();
  try {
    const owner = principal("owner-1");
    const guest = principal("guest-1");
    const room = runtime.createRoom(owner, { roomId: "private-room", name: "Private Room", privacy: "private", password: "super-secret-room", operationId: "create-private", now: at });
    assert.equal("password" in room, false);
    assert.throws(() => runtime.joinRoom(guest, room.roomId, "join-missing", at), /admission/);
    assert.throws(() => runtime.joinRoom(guest, room.roomId, "join-wrong", at, { password: "wrong-password" }), /admission/);
    runtime.joinRoom(guest, room.roomId, "join-correct", at, { password: "super-secret-room" });
    assert.deepEqual(runtime.listMembers("tenant-a", room.roomId, at).map((member) => member.userId), ["guest-1", "owner-1"]);
    assert.equal(rawFiles(path).includes("super-secret-room"), false);
    runtime.leaveRoom(guest, room.roomId, "leave-guest", at);
    assert.throws(() => runtime.joinRoom(guest, room.roomId, "rejoin-without-password", at), /admission/);
    assert.equal(runtime.joinRoom(guest, room.roomId, "rejoin-with-password", at, { password: "super-secret-room" }).roomId, room.roomId);
  } finally { runtime.close(); }
});

test("identity-bound invitations admit only the intended tenant user and survive restart", () => {
  const { path, runtime } = fixture();
  let reopened;
  try {
    const owner = principal("owner-1");
    const invited = principal("invited-1");
    const other = principal("other-1");
    runtime.createRoom(owner, { roomId: "invite-only", name: "Invite Only", privacy: "private", operationId: "create-invite-only", now: at });
    const invitation = runtime.inviteToRoom(owner, { roomId: "invite-only", inviteeUserId: invited.userId, operationId: "invite-1", ttlMs: 60_000, now: at });
    assert.equal(invitation.inviteeUserId, invited.userId);
    assert.throws(() => runtime.joinRoom(other, "invite-only", "join-other", at), /admission/);
    runtime.close();
    reopened = new SqliteHearMeOutRoomMediaRuntime(path);
    assert.equal(reopened.joinRoom(invited, "invite-only", "join-invited", "2026-08-23T12:00:30.000Z").roomId, "invite-only");
    reopened.leaveRoom(invited, "invite-only", "leave-invited", "2026-08-23T12:00:31.000Z");
    assert.equal(reopened.joinRoom(invited, "invite-only", "rejoin-invited", "2026-08-23T12:02:00.000Z").roomId, "invite-only");
  } finally { try { runtime.close(); } catch {} reopened?.close(); }
});

test("presence uses donor-compatible 45-second staleness with tenant and membership isolation", () => {
  const { runtime } = fixture();
  try {
    const owner = principal("owner-1");
    const guest = principal("guest-1");
    runtime.createRoom(owner, { roomId: "room-1", name: "Room One", privacy: "public", operationId: "create-a", now: at });
    runtime.createRoom(principal("owner-1", "tenant-b"), { roomId: "room-1", name: "Room B", privacy: "public", operationId: "create-b", now: at });
    assert.equal(HEARMEOUT_PRESENCE_STALE_MS, 45_000);
    assert.throws(() => runtime.heartbeatPresence(guest, "room-1", "browser-1", at), /membership/);
    runtime.joinRoom(guest, "room-1", "join-guest", at);
    runtime.heartbeatPresence(owner, "room-1", "browser-owner", at);
    runtime.heartbeatPresence(guest, "room-1", "browser-guest", "2026-08-23T12:00:10.000Z");
    assert.deepEqual(runtime.listActivePresence("tenant-a", "room-1", "2026-08-23T12:00:44.999Z").map((presence) => presence.userId), ["guest-1", "owner-1"]);
    assert.deepEqual(runtime.listActivePresence("tenant-a", "room-1", "2026-08-23T12:00:45.000Z").map((presence) => presence.userId), ["guest-1"]);
    assert.deepEqual(runtime.listActivePresence("tenant-b", "room-1", "2026-08-23T12:00:45.000Z"), []);
    assert.equal(runtime.prunePresence("2026-08-23T12:00:55.000Z"), 2);
    runtime.heartbeatPresence(guest, "room-1", "browser-guest", "2026-08-23T12:01:00.000Z");
    runtime.leavePresence(guest, "room-1", "browser-guest", "2026-08-23T12:01:01.000Z");
    assert.deepEqual(runtime.listActivePresence("tenant-a", "room-1", "2026-08-23T12:01:01.000Z"), []);
  } finally { runtime.close(); }
});
