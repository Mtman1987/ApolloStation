import test from "node:test";
import assert from "node:assert/strict";
import { buildXpIdempotencyKey, mappedXpAwardV1 } from "../packages/sdk/dist/index.js";
import { DshPointsService, DshWebControls, buildDshLeaderboardPayload, renderDshLeaderboardPng, renderDshLeaderboardSvg, dshDiscordRequestBody, DEFAULT_DSH_LEADERBOARD_SETTINGS, calculateDshPoints, manifest } from "../apps/discord-stream-hub/dist/index.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("DSH leaderboard cards use canonical lifetime XP and expose safe rank controls", () => {
  const payload = buildDshLeaderboardPayload([
    { rank: 1, userId: "user-1", displayName: "Captain", lifetimeXp: 1200, spendableXp: 200, level: 4 },
    { rank: 2, userId: "user-2", displayName: "Crew", lifetimeXp: 900, spendableXp: 50, level: 3 },
  ], "123456789012345", "2026-11-03T20:00:00.000Z");
  assert.equal(payload.embeds[0].title, "🏆 Community Leaderboard");
  assert.match(payload.embeds[0].description, /Captain.*1,200 Lifetime XP/);
  assert.match(payload.embeds[0].description, /Crew.*900 Lifetime XP/);
  assert.match(payload.embeds[0].fields[0].value, /Lifetime XP/);
  assert.deepEqual(payload.components[0].components.map(button => button.custom_id), ["check_rank_123456789012345", "points_info_123456789012345"]);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.deepEqual(buildDshLeaderboardPayload([], "simulation-guild", "2026-11-03T20:00:00.000Z", false).components, []);
  assert.throws(() => buildDshLeaderboardPayload([], "not-a-discord-id"), /Discord server ID/);
});

test("DSH leaderboard image is rendered locally and uploaded as a Discord attachment", async () => {
  const rows = [{ rank: 1, userId: "user-1", displayName: "<@everyone> Captain", lifetimeXp: 1200, spendableXp: 200, level: 4 }];
  const svg = renderDshLeaderboardSvg(rows, { communityName: "Crew & Friends", updatedAt: "2026-11-03T20:00:00.000Z" });
  assert.match(svg, /Crew &amp; Friends/);
  assert.match(svg, /&lt;@everyone&gt; Captain/);
  const png = renderDshLeaderboardPng(rows, { communityName: "Crew & Friends", updatedAt: "2026-11-03T20:00:00.000Z" });
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const payload = buildDshLeaderboardPayload(rows, "123456789012345", "2026-11-03T20:00:00.000Z", true, true);
  const request = await dshDiscordRequestBody({ ...payload, leaderboardImage: png });
  assert.ok(request.body instanceof FormData);
  const json = JSON.parse(request.body.get("payload_json"));
  assert.equal(json.embeds[0].image.url, "attachment://community-leaderboard.png");
  assert.deepEqual(json.attachments, [{ id: 0, filename: "community-leaderboard.png" }]);
  const file = request.body.get("files[0]");
  assert.equal(file.type, "image/png");
  assert.ok(file.size > 1000);
});

test("DSH signed rank controls provide canonical points guidance and fail closed without a wallet client", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dsh-leaderboard-controls-"));
  const configPath = join(directory, "dsh-runtime.json"), databasePath = join(directory, "dsh.sqlite");
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, pollIntervalSeconds: 60, tenants: [{ tenantId: "tenant-a", twitchProviderUserId: "twitch-owner", discordProviderUserId: "discord-bot", discordGuildIds: ["123456789012345"], branding: { communityMemberName: "Crew" }, members: [] }] }));
  const controls = new DshWebControls({ spmtOrigin: "http://127.0.0.1:3000", databasePath, runtimeConfigPath: configPath, operationMode: "read-only" });
  try {
    const info = await controls.interaction({ type: 3, guild_id: "123456789012345", user: { id: "223456789012345" }, data: { custom_id: "points_info_123456789012345" } });
    assert.match(info.data.content, /Lifetime XP determines your community rank/);
    const rank = await controls.interaction({ type: 3, guild_id: "123456789012345", user: { id: "223456789012345" }, data: { custom_id: "check_rank_123456789012345" } });
    assert.match(rank.data.content, /canonical SPMT wallet is temporarily unavailable/);
  } finally { controls.close(); rmSync(directory, { recursive: true, force: true }); }
});

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
