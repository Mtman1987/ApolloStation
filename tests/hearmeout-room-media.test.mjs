import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HEARMEOUT_ROOM_LIFETIME_MS, SqliteHearMeOutRoomMediaRuntime, playbackPosition } from "../apps/hearmeout/dist/room-media-core.js";

const at = "2026-08-23T12:00:00.000Z";
const owner = (tenantId = "tenant-a") => ({ tenantId, userId: "owner-1", displayName: "Owner", roles: ["member"] });
const admin = (tenantId = "tenant-a") => ({ tenantId, userId: "admin-1", displayName: "Admin", roles: ["admin"] });
const member = (tenantId = "tenant-a") => ({ tenantId, userId: "member-1", displayName: "Listener", roles: ["member"] });
const media = (id, type = "movie") => ({ itemId: id, type, title: `Title ${id}`, source: "first-party-test", playbackUrl: `/media/${id}.m3u8`, durationSeconds: 600 });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "apollo-hmo-"));
  return { path: join(dir, "hearmeout.sqlite"), runtime: new SqliteHearMeOutRoomMediaRuntime(join(dir, "hearmeout.sqlite")) };
}

test("ordinary rooms have the donor six-hour lifetime while system rooms require an admin", () => {
  const { runtime } = fixture();
  try {
    const room = runtime.createRoom(owner(), { roomId: "watch-party", name: "Watch Party", privacy: "public", operationId: "room-create-1", now: at });
    assert.equal(Date.parse(room.expiresAt) - Date.parse(at), HEARMEOUT_ROOM_LIFETIME_MS);
    assert.equal(runtime.getRoom("tenant-a", "watch-party", "2026-08-23T17:59:59.999Z")?.roomId, "watch-party");
    assert.equal(runtime.getRoom("tenant-a", "watch-party", "2026-08-23T18:00:00.000Z"), undefined);
    assert.throws(() => runtime.createRoom(owner(), { roomId: "activity", name: "Activity", privacy: "public", systemRoom: true, operationId: "room-system-deny", now: at }), /admin/);
    const system = runtime.createRoom(admin(), { roomId: "activity", name: "Discord Activities", privacy: "public", systemRoom: true, operationId: "room-system", now: at });
    assert.equal(system.expiresAt, undefined);
  } finally { runtime.close(); }
});

test("room membership and media state are tenant-private", () => {
  const { runtime } = fixture();
  try {
    runtime.createRoom(owner(), { roomId: "room-1", name: "Room One", privacy: "private", password: "correct-horse", operationId: "create-a", now: at });
    runtime.createRoom(owner("tenant-b"), { roomId: "room-1", name: "Other Tenant Room", privacy: "public", operationId: "create-b", now: at });
    runtime.joinRoom(member(), "room-1", "join-member", at, { password: "correct-horse" });
    assert.deepEqual(runtime.listMembers("tenant-a", "room-1", at).map((entry) => entry.userId), ["member-1", "owner-1"]);
    assert.deepEqual(runtime.listMembers("tenant-b", "room-1", at).map((entry) => entry.userId), ["owner-1"]);
    assert.throws(() => runtime.enqueue(member("tenant-b"), { roomId: "room-1", lane: "movie", item: media("x"), operationId: "foreign", now: at }), /membership/);
  } finally { runtime.close(); }
});

test("movie and music queues are canonical per-room lanes with durable idempotency and restart", () => {
  const { path, runtime } = fixture();
  let reopened;
  try {
    runtime.createRoom(owner(), { roomId: "room-1", name: "Room One", privacy: "public", operationId: "create", now: at });
    const first = runtime.enqueue(owner(), { roomId: "room-1", lane: "movie", item: media("movie-1"), operationId: "enqueue-1", now: at });
    assert.equal(first.current.item.itemId, "movie-1");
    assert.equal(first.playback.status, "playing");
    const second = runtime.enqueue(owner(), { roomId: "room-1", lane: "movie", item: media("movie-2"), operationId: "enqueue-2", now: "2026-08-23T12:00:05.000Z" });
    assert.equal(second.queue.length, 1);
    const replay = runtime.enqueue(owner(), { roomId: "room-1", lane: "movie", item: media("ignored"), operationId: "enqueue-2", now: "2026-08-23T12:00:06.000Z" });
    assert.equal(replay.queue.length, 1);
    assert.equal(replay.queue[0].item.itemId, "movie-2");
    const music = runtime.enqueue(owner(), { roomId: "room-1", lane: "music", item: media("song-1", "music"), operationId: "music-1", now: at });
    assert.equal(music.current.item.itemId, "song-1");
    runtime.close();
    reopened = new SqliteHearMeOutRoomMediaRuntime(path);
    assert.equal(reopened.getSession("tenant-a", "room-1", "movie", "2026-08-23T12:05:00.000Z").queue[0].item.itemId, "movie-2");
    assert.equal(reopened.getSession("tenant-a", "room-1", "music", "2026-08-23T12:05:00.000Z").current.item.itemId, "song-1");
  } finally { try { runtime.close(); } catch {} reopened?.close(); }
});

test("host controls preserve playback position and requester controls stay bounded", () => {
  const { runtime } = fixture();
  try {
    runtime.createRoom(owner(), { roomId: "room-1", name: "Room One", privacy: "public", operationId: "create", now: at });
    runtime.joinRoom(member(), "room-1", "join", at);
    const first = runtime.enqueue(owner(), { roomId: "room-1", lane: "movie", item: media("movie-1"), operationId: "enqueue-owner", now: at });
    runtime.enqueue(member(), { roomId: "room-1", lane: "movie", item: media("movie-2"), operationId: "enqueue-member", now: "2026-08-23T12:00:01.000Z" });
    assert.throws(() => runtime.control(member(), { roomId: "room-1", lane: "movie", action: "pause", operationId: "member-pause", now: "2026-08-23T12:00:10.000Z" }), /host or an admin/);
    const paused = runtime.control(owner(), { roomId: "room-1", lane: "movie", action: "pause", operationId: "owner-pause", now: "2026-08-23T12:00:10.000Z" });
    assert.equal(paused.playback.position, 10);
    assert.equal(playbackPosition(paused, "2026-08-23T12:01:00.000Z"), 10);
    const stale = runtime.control(member(), { roomId: "room-1", lane: "movie", action: "next", expectedRequestId: "stale-request", operationId: "stale-next", now: "2026-08-23T12:00:11.000Z" });
    assert.equal(stale.current.requestId, first.current.requestId);
    const advanced = runtime.control(member(), { roomId: "room-1", lane: "movie", action: "next", expectedRequestId: first.current.requestId, operationId: "member-next", now: "2026-08-23T12:00:12.000Z" });
    assert.equal(advanced.current.item.itemId, "movie-2");
    assert.equal(advanced.playback.status, "playing");
  } finally { runtime.close(); }
});
