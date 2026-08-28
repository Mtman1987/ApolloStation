import assert from "node:assert/strict";
import test from "node:test";
import {
  HEARMEOUT_ACTIVITY_ROOM_ID,
  HEARMEOUT_ACTIVITY_ROOM_NAME,
  HEARMEOUT_GLOBAL_WATCH_SESSION_ID,
  HEARMEOUT_MUSIC_WATCH_SESSION_ID,
  SqliteHearMeOutRoomMediaRuntime,
  ensureHearMeOutDiscordActivityRoom,
  getHearMeOutDiscordWatchSessionId,
  getHearMeOutRoomWatchSessionId,
  hearMeOutLaneForWatchSession,
  isHearMeOutDiscordActivityWatchSession,
  joinHearMeOutDiscordActivityRoom,
  normalizeHearMeOutWatchSessionAlias,
} from "../apps/hearmeout/dist/index.js";

const admin = { tenantId: "tenant-a", userId: "owner-a", displayName: "Owner", roles: ["admin"] };
const member = { tenantId: "tenant-a", userId: "user-a", displayName: "Viewer", roles: ["member"] };

test("Discord Activity keeps the donor stable room and global watch session identities", () => {
  assert.equal(HEARMEOUT_ACTIVITY_ROOM_ID, "discord-activity");
  assert.equal(HEARMEOUT_ACTIVITY_ROOM_NAME, "Discord Activities");
  assert.equal(HEARMEOUT_GLOBAL_WATCH_SESSION_ID, "discord-watch-room");
  assert.equal(HEARMEOUT_MUSIC_WATCH_SESSION_ID, "discord-music-room");
  assert.equal(getHearMeOutRoomWatchSessionId("discord-activity", "movie"), HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
  assert.equal(getHearMeOutRoomWatchSessionId("discord-activity", "music"), HEARMEOUT_MUSIC_WATCH_SESSION_ID);
  assert.equal(getHearMeOutDiscordWatchSessionId("123", "456", "movie"), "watch-discord-123-456-movie");
  assert.equal(normalizeHearMeOutWatchSessionAlias("watch-discord-123-456-music"), HEARMEOUT_MUSIC_WATCH_SESSION_ID);
  assert.equal(normalizeHearMeOutWatchSessionAlias("movies"), HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
  assert.equal(normalizeHearMeOutWatchSessionAlias("radio"), HEARMEOUT_MUSIC_WATCH_SESSION_ID);
  assert.equal(isHearMeOutDiscordActivityWatchSession("watch-discord-1-2-movie"), true);
  assert.equal(hearMeOutLaneForWatchSession("discord-music-room"), "music");
});

test("Discord Activity room is one durable public system room per tenant and never expires", () => {
  const runtime = new SqliteHearMeOutRoomMediaRuntime(":memory:");
  try {
    const first = ensureHearMeOutDiscordActivityRoom(runtime, admin, "2026-08-25T12:00:00.000Z");
    const second = ensureHearMeOutDiscordActivityRoom(runtime, admin, "2026-08-26T12:00:00.000Z");
    assert.equal(first.roomId, HEARMEOUT_ACTIVITY_ROOM_ID);
    assert.equal(first.ownerUserId, HEARMEOUT_ACTIVITY_ROOM_ID);
    assert.equal(first.systemRoom, true);
    assert.equal(first.privacy, "public");
    assert.equal(first.expiresAt, undefined);
    assert.deepEqual(second, first);
    assert.equal(runtime.getRoom("tenant-a", HEARMEOUT_ACTIVITY_ROOM_ID, "2099-01-01T00:00:00.000Z")?.roomId, HEARMEOUT_ACTIVITY_ROOM_ID);
  } finally { runtime.close(); }
});

test("ordinary members cannot mint the system Activity room but can join it after admin initialization", () => {
  const runtime = new SqliteHearMeOutRoomMediaRuntime(":memory:");
  try {
    assert.throws(() => ensureHearMeOutDiscordActivityRoom(runtime, member), /admin principal/);
    ensureHearMeOutDiscordActivityRoom(runtime, admin, "2026-08-25T12:00:00.000Z");
    const joined = joinHearMeOutDiscordActivityRoom(runtime, member, "activity-join:user-a", "2026-08-25T12:00:05.000Z");
    assert.equal(joined.roomId, HEARMEOUT_ACTIVITY_ROOM_ID);
    assert.equal(runtime.listMembers("tenant-a", HEARMEOUT_ACTIVITY_ROOM_ID, "2026-08-25T12:00:05.000Z").some((entry) => entry.userId === "user-a"), true);
  } finally { runtime.close(); }
});

test("Discord Activity rooms remain tenant isolated even though the donor room id is shared", () => {
  const runtime = new SqliteHearMeOutRoomMediaRuntime(":memory:");
  try {
    const otherAdmin = { ...admin, tenantId: "tenant-b", userId: "owner-b" };
    ensureHearMeOutDiscordActivityRoom(runtime, admin, "2026-08-25T12:00:00.000Z");
    ensureHearMeOutDiscordActivityRoom(runtime, otherAdmin, "2026-08-25T12:00:00.000Z");
    assert.equal(runtime.getRoom("tenant-a", HEARMEOUT_ACTIVITY_ROOM_ID)?.tenantId, "tenant-a");
    assert.equal(runtime.getRoom("tenant-b", HEARMEOUT_ACTIVITY_ROOM_ID)?.tenantId, "tenant-b");
  } finally { runtime.close(); }
});
