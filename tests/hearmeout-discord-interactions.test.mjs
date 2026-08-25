import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  HEARMEOUT_ACTIVITY_ROOM_ID,
  HEARMEOUT_DISCORD_INTERACTION_RESPONSE,
  HearMeOutDiscordInteractionRouter,
  SqliteHearMeOutRoomMediaRuntime,
  discordMemberCanManageHearMeOutWatch,
  verifyHearMeOutDiscordInteraction,
} from "../apps/hearmeout/dist/index.js";

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const der = Buffer.from(publicKey.export({ format: "der", type: "spki" }));
  const publicKeyHex = der.subarray(-32).toString("hex");
  const timestamp = "1770000000";
  const signed = (body) => {
    const rawBody = JSON.stringify(body);
    const signature = sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
    return { rawBody, signature, timestamp };
  };
  return { publicKeyHex, signed };
}

function routerFixture() {
  const crypto = signingFixture();
  const rooms = new SqliteHearMeOutRoomMediaRuntime(":memory:");
  const tenantCalls = [];
  const principalCalls = [];
  const router = new HearMeOutDiscordInteractionRouter({
    publicKeyHex: crypto.publicKeyHex,
    rooms,
    tenants: { resolve(input) { tenantCalls.push(input); return input.guildId === "123456789012345678" ? "tenant-a" : undefined; } },
    principals: { resolve(input) { principalCalls.push(input); return input.discordUserId === "223456789012345678" ? { userId: "spmt-user-1", displayName: "Captain" } : undefined; } },
  });
  return { ...crypto, rooms, router, tenantCalls, principalCalls };
}

test("Discord interaction verifier uses the donor Ed25519 timestamp+body contract", () => {
  const fx = signingFixture();
  const input = fx.signed({ type: 1 });
  assert.equal(verifyHearMeOutDiscordInteraction(input.rawBody, input.signature, input.timestamp, fx.publicKeyHex), true);
  assert.equal(verifyHearMeOutDiscordInteraction(input.rawBody + " ", input.signature, input.timestamp, fx.publicKeyHex), false);
  assert.equal(verifyHearMeOutDiscordInteraction(input.rawBody, "00".repeat(64), input.timestamp, fx.publicKeyHex), false);
});

test("Discord PING returns PONG without requiring a tenant or user mapping", async () => {
  const fx = routerFixture();
  try {
    const result = await fx.router.handle(fx.signed({ type: 1 }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.PONG });
    assert.equal(fx.tenantCalls.length, 0);
    assert.equal(fx.principalCalls.length, 0);
  } finally { fx.rooms.close(); }
});

test("signed watch controls resolve Discord space and immutable user before touching HearMeOut", async () => {
  const fx = routerFixture();
  try {
    const body = {
      id: "323456789012345678",
      type: 3,
      application_id: "423456789012345678",
      guild_id: "123456789012345678",
      channel_id: "523456789012345678",
      member: { permissions: "8", user: { id: "223456789012345678", username: "captain", global_name: "Captain" } },
      data: { custom_id: "hmo_watch_control:play-pause:discord-watch-room" },
    };
    const result = await fx.router.handle(fx.signed(body));
    assert.equal(result.status, 200);
    assert.equal(result.body.type, HEARMEOUT_DISCORD_INTERACTION_RESPONSE.UPDATE_MESSAGE);
    assert.equal(fx.tenantCalls.length, 1);
    assert.equal(fx.principalCalls[0].discordUserId, "223456789012345678");
    assert.equal(fx.rooms.getRoom("tenant-a", HEARMEOUT_ACTIVITY_ROOM_ID)?.systemRoom, true);
    assert.equal(fx.rooms.listMembers("tenant-a", HEARMEOUT_ACTIVITY_ROOM_ID).some((entry) => entry.userId === "spmt-user-1"), true);
  } finally { fx.rooms.close(); }
});

test("a linked member without Discord management permission cannot seize shared playback authority", async () => {
  const fx = routerFixture();
  try {
    const result = await fx.router.handle(fx.signed({
      id: "323456789012345679",
      type: 3,
      guild_id: "123456789012345678",
      channel_id: "523456789012345678",
      member: { permissions: "0", user: { id: "223456789012345678", username: "captain" } },
      data: { custom_id: "hmo_watch_control:pause:discord-watch-room" },
    }));
    assert.equal(result.status, 200);
    assert.equal(result.body.type, HEARMEOUT_DISCORD_INTERACTION_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE);
    assert.match(result.body.data.content, /room host or an admin/);
  } finally { fx.rooms.close(); }
});

test("unlinked Discord users fail closed and are never merged by username", async () => {
  const fx = routerFixture();
  try {
    const result = await fx.router.handle(fx.signed({
      id: "323456789012345680",
      type: 3,
      guild_id: "123456789012345678",
      member: { permissions: "8", user: { id: "999999999999999999", username: "captain" } },
      data: { custom_id: "hmo_watch_controls:discord-watch-room" },
    }));
    assert.equal(result.status, 403);
    assert.match(result.body.data.content, /Link your Discord account to SPMT/);
    assert.equal(fx.rooms.getRoom("tenant-a", HEARMEOUT_ACTIVITY_ROOM_ID), undefined);
  } finally { fx.rooms.close(); }
});

test("volume modal preserves donor custom ids and applies only bounded shared volume", async () => {
  const fx = routerFixture();
  try {
    const base = {
      guild_id: "123456789012345678",
      channel_id: "523456789012345678",
      member: { permissions: "8192", user: { id: "223456789012345678", username: "captain" } },
    };
    const modal = await fx.router.handle(fx.signed({ ...base, id: "323456789012345681", type: 3, data: { custom_id: "hmo_watch_volume_modal:discord-music-room" } }));
    assert.equal(modal.body.type, HEARMEOUT_DISCORD_INTERACTION_RESPONSE.MODAL);
    assert.equal(modal.body.data.custom_id, "hmo_watch_volume_submit:discord-music-room");

    const submitted = await fx.router.handle(fx.signed({
      ...base,
      id: "323456789012345682",
      type: 5,
      data: { custom_id: "hmo_watch_volume_submit:discord-music-room", components: [{ components: [{ custom_id: "volume_value", value: "42" }] }] },
    }));
    assert.equal(submitted.body.type, HEARMEOUT_DISCORD_INTERACTION_RESPONSE.UPDATE_MESSAGE);
    assert.equal(fx.rooms.getSession("tenant-a", HEARMEOUT_ACTIVITY_ROOM_ID, "music").playback.volume, 42);

    const invalid = await fx.router.handle(fx.signed({
      ...base,
      id: "323456789012345683",
      type: 5,
      data: { custom_id: "hmo_watch_volume_submit:discord-music-room", components: [{ components: [{ custom_id: "volume_value", value: "999" }] }] },
    }));
    assert.match(invalid.body.data.content, /0 to 100/);
  } finally { fx.rooms.close(); }
});

test("Discord permission mapping preserves donor administrator/manage-message/manage-guild gates", () => {
  assert.equal(discordMemberCanManageHearMeOutWatch("8"), true);
  assert.equal(discordMemberCanManageHearMeOutWatch(String(0x2000)), true);
  assert.equal(discordMemberCanManageHearMeOutWatch(String(0x20)), true);
  assert.equal(discordMemberCanManageHearMeOutWatch("0"), false);
  assert.equal(discordMemberCanManageHearMeOutWatch("bad"), false);
});
