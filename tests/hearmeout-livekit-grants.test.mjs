import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HearMeOutLiveKitGrantService, SqliteHearMeOutRoomMediaRuntime } from "../apps/hearmeout/dist/index.js";

const at = "2026-08-23T12:00:00.000Z";
const owner = { tenantId: "tenant-a", userId: "owner-1", displayName: "Owner", roles: ["member"] };
const member = { tenantId: "tenant-a", userId: "member-1", displayName: "Listener", roles: ["member"] };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "apollo-hmo-livekit-"));
  const rooms = new SqliteHearMeOutRoomMediaRuntime(join(dir, "hearmeout.sqlite"));
  rooms.createRoom(owner, { roomId: "room-1", name: "Room One", privacy: "public", operationId: "create", now: at });
  rooms.joinRoom(member, "room-1", "join", at);
  const signed = [];
  const grants = new HearMeOutLiveKitGrantService(rooms, { async sign(claims) { signed.push(claims); return `signed:${claims.grantId}`; } }, "wss://livekit.example.test", 15 * 60_000);
  return { dir, rooms, grants, signed, close() { rooms.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("room members receive bounded microphone grants while listeners cannot publish", async () => {
  const f = fixture();
  try {
    const voice = await f.grants.issue({ kind: "human", ...member }, { roomId: "room-1", mode: "voice-participant", operationId: "voice-1", now: at });
    assert.equal(voice.url, "wss://livekit.example.test");
    assert.equal(voice.token, "signed:voice-1");
    assert.equal(voice.claims.canPublish, true);
    assert.deepEqual(voice.claims.allowedSources, ["microphone"]);
    assert.equal(voice.claims.liveKitRoom, "hmo_tenant-a_room-1");
    assert.equal(Date.parse(voice.claims.expiresAt) - Date.parse(at), 10 * 60_000);
    const listener = await f.grants.issue({ kind: "human", ...member }, { roomId: "room-1", mode: "voice-listener", operationId: "listen-1", now: at, ttlMs: 60_000 });
    assert.equal(listener.claims.canPublish, false);
    assert.equal(listener.claims.canPublishData, false);
    assert.deepEqual(listener.claims.allowedSources, []);
  } finally { f.close(); }
});

test("nonmembers, expired rooms, and cross-tenant principals cannot inherit room authority", async () => {
  const f = fixture();
  try {
    await assert.rejects(() => f.grants.issue({ kind: "human", tenantId: "tenant-a", userId: "stranger", displayName: "Stranger", roles: ["member"] }, { roomId: "room-1", mode: "voice-participant", operationId: "stranger", now: at }), /membership/);
    await assert.rejects(() => f.grants.issue({ kind: "human", ...member, tenantId: "tenant-b" }, { roomId: "room-1", mode: "voice-participant", operationId: "cross", now: at }), /not found/);
    await assert.rejects(() => f.grants.issue({ kind: "human", ...member }, { roomId: "room-1", mode: "voice-participant", operationId: "expired", now: "2026-08-23T18:00:00.000Z" }), /expired/);
  } finally { f.close(); }
});

test("only the room host or an admin can publish human-controlled room media", async () => {
  const f = fixture();
  try {
    await assert.rejects(() => f.grants.issue({ kind: "human", ...member }, { roomId: "room-1", mode: "media-publisher", operationId: "member-media", now: at }), /host or an admin/);
    const media = await f.grants.issue({ kind: "human", ...owner }, { roomId: "room-1", mode: "media-publisher", operationId: "owner-media", now: at });
    assert.equal(media.claims.canPublish, true);
    assert.deepEqual(media.claims.allowedSources, ["screen_share", "screen_share_audio"]);
    assert.equal(media.claims.identity, "user:owner-1:media");
  } finally { f.close(); }
});

test("Companion media publication requires an explicit service scope and stays room/tenant bound", async () => {
  const f = fixture();
  try {
    const principal = { kind: "service", tenantId: "tenant-a", appId: "companion", subjectId: "pc-1", scopes: ["rooms:media:publish"] };
    const media = await f.grants.issue(principal, { roomId: "room-1", mode: "media-publisher", operationId: "companion-media", now: at });
    assert.equal(media.claims.identity, "service:companion:pc-1");
    assert.equal(media.claims.tenantId, "tenant-a");
    await assert.rejects(() => f.grants.issue({ ...principal, scopes: [] }, { roomId: "room-1", mode: "media-publisher", operationId: "no-scope", now: at }), /authority denied/);
    await assert.rejects(() => f.grants.issue(principal, { roomId: "room-1", mode: "voice-participant", operationId: "service-voice", now: at }), /authority denied/);
    await assert.rejects(() => f.grants.issue(principal, { roomId: "room-1", mode: "media-publisher", operationId: "too-long", now: at, ttlMs: 15 * 60_000 + 1 }), /lifetime/);
  } finally { f.close(); }
});
