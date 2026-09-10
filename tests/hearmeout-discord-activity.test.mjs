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
  readHearMeOutActivityState,
  renderHearMeOutActivity,
  handleHearMeOutActivityRequest,
} from "../apps/hearmeout/dist/index.js";
import vm from "node:vm";

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

test("Activity state reads the same request and playback as the website without trusting a tenant query", () => {
  const runtime = new SqliteHearMeOutRoomMediaRuntime(":memory:");
  try {
    ensureHearMeOutDiscordActivityRoom(runtime, admin);
    joinHearMeOutDiscordActivityRoom(runtime, admin, "activity-owner-join");
    const queued = runtime.enqueue(admin, { roomId: HEARMEOUT_ACTIVITY_ROOM_ID, lane: "music", operationId: "song-request", item: {
      itemId: "song-a", title: "Shared song", type: "music", source: "test", playbackUrl: "https://media.example/song.webm",
    } });
    const binding = { tenantId: admin.tenantId, clientId: "1279582181768957963" };
    const state = readHearMeOutActivityState(runtime, binding);
    assert.equal(state.sessionId, HEARMEOUT_MUSIC_WATCH_SESSION_ID);
    assert.deepEqual(state.current, queued.current);
    assert.deepEqual(state.playback, queued.playback);
    const paused = runtime.control(admin, { roomId: HEARMEOUT_ACTIVITY_ROOM_ID, lane: "music", action: "pause", position: 42, operationId: "pause-song" });
    assert.deepEqual(readHearMeOutActivityState(runtime, binding, "music").playback, paused.playback);
    assert.throws(() => readHearMeOutActivityState(runtime, undefined), /not connected/);
    assert.throws(() => readHearMeOutActivityState(runtime, { ...binding, tenantId: "other-tenant" }), /not been initialized/);
    assert.throws(() => readHearMeOutActivityState(runtime, binding, "watch-room-private-music"), /only opens/);
    const response = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    assert.equal(handleHearMeOutActivityRequest({ method: "GET", headers: {} }, response, new URL("https://hmo.test/api/watch/sessions/music/state?tenantId=other-tenant"), runtime, binding), true);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).current.requestId, queued.current.requestId);
  } finally { runtime.close(); }
});

test("Activity entry renders without a cookie or configured binding and makes no room", () => {
  const runtime = new SqliteHearMeOutRoomMediaRuntime(":memory:");
  try {
    for (const path of ["/activity", "/activity-lite", "/?frame_id=test&platform=desktop"]) {
      const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
      assert.equal(handleHearMeOutActivityRequest({ method: "GET", headers: {} }, response, new URL("https://hmo.test" + path), runtime), true);
      assert.equal(response.status, 200);
      assert.equal(response.headers.location, undefined);
      assert.match(response.body, /role="alert"/);
      assert.equal(runtime.getRoom(admin.tenantId, HEARMEOUT_ACTIVITY_ROOM_ID), undefined);
    }
    const html = renderHearMeOutActivity("1279582181768957963");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    new vm.Script(script);
    const messages = [], listeners = {};
    const element = { addEventListener() {} };
    const context = vm.createContext({ URL, URLSearchParams, AbortSignal,
      location: new URL("https://1279582181768957963.discordsays.com/?frame_id=test-frame"),
      document: { referrer: "https://discord.com/channels/1/2", getElementById() { return element; }, querySelectorAll() { return []; } },
      window: { parent: { postMessage(...args) { messages.push(args); } }, addEventListener(name, callback) { listeners[name] = callback; } },
      fetch() { return new Promise(() => {}); }, setInterval() { return 1; }, clearInterval() {},
    });
    vm.runInContext(script, context);
    assert.equal(messages[0][0][0], 0);
    assert.equal(messages[0][0][1].frame_id, "test-frame");
    assert.equal(messages[0][1], "https://discord.com");
  } finally { runtime.close(); }
});
