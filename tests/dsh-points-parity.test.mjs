import test from "node:test";
import assert from "node:assert/strict";
import { buildXpIdempotencyKey, mappedXpAwardV1 } from "../packages/sdk/dist/index.js";
import { DshPointsService, DEFAULT_DSH_LEADERBOARD_SETTINGS, calculateDshPoints, manifest } from "../apps/discord-stream-hub/dist/index.js";

test("DSH donor point calculations retain event settings and bits-per-100 behavior", () => {
  const settings = DEFAULT_DSH_LEADERBOARD_SETTINGS;
  assert.equal(calculateDshPoints("raid", 1, settings), 10);
  assert.equal(calculateDshPoints("follow", 1, settings), 5);
  assert.equal(calculateDshPoints("subscription", 1, settings), 50);
  assert.equal(calculateDshPoints("gifted_subscription", 3, settings), 75);
  assert.equal(calculateDshPoints("chat_activity", 2, settings), 2);
  assert.equal(calculateDshPoints("first_message", 1, settings), 5);
  assert.equal(calculateDshPoints("message_reaction", 4, settings), 4);
  assert.equal(calculateDshPoints("admin_calendar_event", 1, settings), 10);
  assert.equal(calculateDshPoints("admin_captains_log", 1, settings), 5);
  assert.equal(calculateDshPoints("admin_message", 3, settings), 3);
  assert.equal(calculateDshPoints("bits", 99, settings), 0);
  assert.equal(calculateDshPoints("bits", 100, settings), 1);
  assert.equal(calculateDshPoints("bits", 250, settings), 2);
});

test("production XP idempotency helper and DSH mapped awards remain stable", () => {
  assert.equal(buildXpIdempotencyKey({ sourceApp: "Discord Stream Hub", eventType: "DSH Twitch Follow", upstreamEventId: "Event / 42", userId: "User 99" }), "discord-stream-hub:dsh-twitch-follow:event-42:user-99");
  const mapped = mappedXpAwardV1({ userId: "user-1", mappedEventType: "dsh.twitch.raid", upstreamEventId: "raid:abc" });
  assert.equal(mapped.sourceApp, "discord-stream-hub");
  assert.equal(mapped.eventType, "dsh-twitch-raid");
  assert.equal(mapped.delta, 50);
  assert.equal(mapped.idempotencyKey, "discord-stream-hub:dsh-twitch-raid:raid:abc:user-1");
  assert.equal(mapped.metadata.upstreamEventId, "raid:abc");
});

test("DSH routes earned points into canonical SPMT wallet with donor event identity", async () => {
  const calls = [];
  const wallet = { tenantId: "tenant-1", userId: "user-1", spendableXp: 10, currentXp: 10, lifetimeXp: 10, totalXp: 10, rank: 1, level: 1 };
  const client = {
    awardXp: async (...args) => { calls.push(["awardXp", ...args]); return { duplicate: false }; },
    getXpWallet: async () => wallet,
  };
  const service = new DshPointsService(client, "tenant-1");
  const result = await service.awardPoints({ userId: "user-1", eventType: "raid", upstreamEventId: "raid-55", source: "twitch", metadata: { channelId: "chan-1" } });
  assert.equal(result.pointsAwarded, 10, "DSH configured raid points remain the donor-local 10 even though the generic SDK mapping default is 50");
  assert.equal(calls.length, 1);
  const [kind, tenantId, userId, delta, reason, key, options] = calls[0];
  assert.equal(kind, "awardXp");
  assert.equal(tenantId, "tenant-1");
  assert.equal(userId, "user-1");
  assert.equal(delta, 10);
  assert.equal(reason, "dsh-twitch-raid");
  assert.equal(key, "discord-stream-hub:dsh-twitch-raid:raid-55:user-1");
  assert.equal(options.eventType, "dsh-twitch-raid");
  assert.equal(options.metadata.source, "twitch");
  assert.equal(options.metadata.channelId, "chan-1");
});

test("DSH Twitch chat and bits keep their production custom event types", async () => {
  const calls = [];
  const client = {
    awardXp: async (...args) => { calls.push(args); return { duplicate: false }; },
    getXpWallet: async (_tenantId, userId) => ({ tenantId: "tenant-1", userId, spendableXp: 1, currentXp: 1, lifetimeXp: 1, totalXp: 1, rank: 1, level: 1 }),
  };
  const service = new DshPointsService(client, "tenant-1");
  await service.awardPoints({ userId: "u1", eventType: "chat_activity", upstreamEventId: "msg-1", source: "twitch" });
  await service.awardPoints({ userId: "u1", eventType: "bits", upstreamEventId: "bits-1", source: "twitch", quantity: 250 });
  assert.equal(calls[0][3], "dsh-twitch-message");
  assert.equal(calls[0][4], "discord-stream-hub:dsh-twitch-message:msg-1:u1");
  assert.equal(calls[1][2], 2);
  assert.equal(calls[1][3], "dsh-twitch-bits");
  assert.equal(calls[1][4], "discord-stream-hub:dsh-twitch-bits:bits-1:u1");
});

test("manual DSH add/set routes mutate spendable wallet without inflating lifetime", async () => {
  let spendableXp = 20;
  const calls = [];
  const client = {
    getXpWallet: async (_tenantId, userId) => ({ tenantId: "tenant-1", userId, spendableXp, currentXp: spendableXp, lifetimeXp: 100, totalXp: 100, rank: 1, level: 2 }),
    awardXp: async (...args) => { calls.push(["award", ...args]); spendableXp += args[2]; return { duplicate: false }; },
    spendXp: async (...args) => { calls.push(["spend", ...args]); spendableXp -= args[2]; return {}; },
  };
  const service = new DshPointsService(client, "tenant-1");
  await service.addPoints("user-1", 5, "manual-1", { actor: "mod" });
  assert.equal(spendableXp, 25);
  assert.equal(calls[0][6].metadata.lifetimeEligible, false);
  await service.setPoints("user-1", 7, "set-1");
  assert.equal(spendableXp, 7);
  assert.equal(calls[1][0], "spend");
});

test("DSH transfer and gamble call the canonical wallet operations with stable keys", async () => {
  const calls = [];
  const client = {
    transferXp: async (...args) => { calls.push(["transfer", ...args]); return { transferred: true }; },
    settleXpGamble: async (...args) => { calls.push(["gamble", ...args]); return { settled: true }; },
  };
  const service = new DshPointsService(client, "tenant-1");
  await service.transfer("from", "to", 12, "gift-1", { reason: "community" });
  await service.settleGamble("from", 5, 20, "dice-1", { game: "dice" });
  assert.deepEqual(calls[0].slice(1, 6), ["tenant-1", "from", "to", 12, "dsh-points-transfer"]);
  assert.equal(calls[0][6], "discord-stream-hub:dsh-points-transfer:gift-1:from:to");
  assert.deepEqual(calls[1].slice(1, 6), ["tenant-1", "from", 5, 20, "dsh-gamble-settle"]);
  assert.equal(calls[1][6], "discord-stream-hub:dsh-gamble-settle:dice-1:from");
});

test("DSH manifest declares canonical points read/write instead of a private balance authority", () => {
  for (const capability of ["points", "leaderboard", "wallet-settlement"]) assert.ok(manifest.capabilities.includes(capability));
  assert.ok(manifest.requiredScopes.includes("xp:read"));
  assert.ok(manifest.requiredScopes.includes("xp:write"));
});
