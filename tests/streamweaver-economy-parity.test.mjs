import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS,
  MemoryStreamWeaverEconomyStore,
  STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS,
  STREAMWEAVER_STEAL_COOLDOWN_MS,
  StreamWeaverEconomy,
  determineRollOutcome,
  formatCompactPointAmount,
  manifest,
  parseStreamWeaverPointAmount,
} from "../apps/streamweaver/dist/index.js";

function sequence(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function fakeClient(initial = { thief: 1000, target: 1000, gambler: 10000 }) {
  const balances = new Map(Object.entries(initial));
  const calls = [];
  const wallet = (tenantId, userId) => ({ tenantId, userId, spendableXp: balances.get(userId) ?? 0, currentXp: balances.get(userId) ?? 0, lifetimeXp: balances.get(userId) ?? 0, totalXp: balances.get(userId) ?? 0, rank: 1, level: 1 });
  return {
    calls,
    balances,
    getXpWallet: async (tenantId, userId) => wallet(tenantId, userId),
    getXpLeaderboard: async () => [],
    transferXp: async (tenantId, from, to, amount, eventType, key, metadata) => {
      calls.push(["transfer", tenantId, from, to, amount, eventType, key, metadata]);
      balances.set(from, (balances.get(from) ?? 0) - amount);
      balances.set(to, (balances.get(to) ?? 0) + amount);
      return { transferred: true, duplicate: false, amount, from: wallet(tenantId, from), to: wallet(tenantId, to) };
    },
    spendXp: async (tenantId, userId, amount, eventType, key, metadata) => {
      calls.push(["spend", tenantId, userId, amount, eventType, key, metadata]);
      balances.set(userId, (balances.get(userId) ?? 0) - amount);
      return { spent: true, duplicate: false, amount, wallet: wallet(tenantId, userId) };
    },
    settleXpGamble: async (tenantId, userId, wager, payout, eventType, key, metadata) => {
      calls.push(["settle", tenantId, userId, wager, payout, eventType, key, metadata]);
      balances.set(userId, (balances.get(userId) ?? 0) - wager + payout);
      return { settled: true, duplicate: false, wager, payout, refill: 0, overflow: 0, compressed: 0, matchedGrowth: 0, discardedOverflow: 0, before: wallet(tenantId, userId), wallet: wallet(tenantId, userId) };
    },
  };
}

test("StreamWeaver canonical economy keeps donor configuration and manifest scopes", () => {
  assert.equal(DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS.defaultBet, 1234);
  assert.equal(DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS.jackpotPercent, 1);
  assert.equal(DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS.winPercent, 28);
  assert.equal(DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS.jackpotMultiplier, 1);
  for (const capability of ["economy", "gamble", "points-transfer"]) assert.ok(manifest.capabilities.includes(capability));
  assert.ok(manifest.requiredScopes.includes("xp:read"));
  assert.ok(manifest.requiredScopes.includes("xp:write"));
});

test("givepoints is a canonical transfer and replay does not move points twice", async () => {
  const client = fakeClient();
  const economy = new StreamWeaverEconomy({ client, tenantId: "tenant-1", store: new MemoryStreamWeaverEconomyStore() });
  const first = await economy.givePoints({ fromUserId: "thief", toUserId: "target", fromDisplayName: "Thief", toDisplayName: "Target", amount: 100, operationId: "msg-give-1" });
  assert.equal(first.success, true);
  assert.equal(client.balances.get("thief"), 900);
  assert.equal(client.balances.get("target"), 1100);
  assert.equal(client.calls[0][5], "streamweaver-givepoints");
  assert.equal(client.calls[0][6], "streamweaver:streamweaver-givepoints:msg-give-1:thief:target");
  const replay = await economy.givePoints({ fromUserId: "thief", toUserId: "target", amount: 100, operationId: "msg-give-1" });
  assert.equal(replay.duplicate, true);
  assert.equal(client.balances.get("thief"), 900);
  assert.equal(client.calls.length, 1);
});

test("stealpoints preserves donor full-success odds, scenario wording, two-hour cooldown and replay protection", async () => {
  let now = 1_000_000;
  const client = fakeClient();
  const store = new MemoryStreamWeaverEconomyStore();
  const economy = new StreamWeaverEconomy({ client, tenantId: "tenant-1", store, nowMs: () => now, random: sequence([0.10, 0.0]) });
  const first = await economy.stealPoints({ fromUserId: "thief", toUserId: "target", fromDisplayName: "Thief", toDisplayName: "Target", amount: 200, operationId: "steal-1" });
  assert.equal(first.success, true);
  assert.equal(first.outcome, "success");
  assert.equal(first.pointsChanged, 200);
  assert.match(first.message, /slipped past the security lasers/);
  assert.equal(client.balances.get("thief"), 1200);
  assert.equal(client.balances.get("target"), 800);
  const replay = await economy.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 200, operationId: "steal-1" });
  assert.equal(replay.duplicate, true);
  assert.equal(client.calls.length, 1);

  const cooling = await economy.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 100, operationId: "steal-2" });
  assert.equal(cooling.success, false);
  assert.match(cooling.message, /cooldown/);
  now += STREAMWEAVER_STEAL_COOLDOWN_MS;
  const after = new StreamWeaverEconomy({ client, tenantId: "tenant-1", store, nowMs: () => now, random: sequence([0.70, 0.0]) });
  const failed = await after.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 100, operationId: "steal-3" });
  assert.equal(failed.outcome, "fail");
  assert.equal(client.calls.length, 1, "ordinary heist failure makes no wallet mutation");
});

test("stealpoints preserves donor partial and backfire wallet behavior", async () => {
  const partialClient = fakeClient();
  const partial = new StreamWeaverEconomy({ client: partialClient, tenantId: "tenant-1", store: new MemoryStreamWeaverEconomyStore(), nowMs: () => 5_000_000, random: sequence([0.30, 0.4]) });
  const partialResult = await partial.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 201, operationId: "partial" });
  assert.equal(partialResult.outcome, "partial");
  assert.equal(partialResult.pointsChanged, 100);
  assert.equal(partialClient.balances.get("thief"), 1100);

  const penaltyClient = fakeClient();
  const penalty = new StreamWeaverEconomy({ client: penaltyClient, tenantId: "tenant-1", store: new MemoryStreamWeaverEconomyStore(), nowMs: () => 5_000_000, random: sequence([0.90, 0.4]) });
  const penaltyResult = await penalty.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 250, operationId: "penalty" });
  assert.equal(penaltyResult.outcome, "critical-fail");
  assert.equal(penaltyClient.balances.get("thief"), 750);
  assert.equal(penaltyClient.calls[0][0], "spend");
});

test("classic gamble preserves one-percent jackpot, 12-hour global gate and canonical stake/payout settlement", async () => {
  let now = 20_000_000;
  const store = new MemoryStreamWeaverEconomyStore();
  const client = fakeClient();
  const jackpot = new StreamWeaverEconomy({ client, tenantId: "tenant-1", store, nowMs: () => now, random: sequence([0.0, 0.5]) });
  const first = await jackpot.gamble({ userId: "gambler", displayName: "Gambler", bet: 1000, operationId: "gamble-jp" });
  assert.equal(first.outcome, "jackpot");
  assert.equal(first.change, 2000, "150-249 percent jackpot profit uses donor calculation; 0.5 -> 200 percent");
  assert.equal(first.payout, 3000);
  assert.deepEqual(client.calls[0].slice(3, 5), [1000, 3000]);
  assert.equal(client.calls[0][5], "streamweaver-gamble");

  const blockedJackpot = new StreamWeaverEconomy({ client, tenantId: "tenant-2", store, nowMs: () => now + 1000, random: sequence([0.0, 0.0]) });
  const second = await blockedJackpot.gamble({ userId: "gambler", bet: 1000, operationId: "gamble-blocked" });
  assert.equal(second.outcome, "win", "blocked community jackpot roll becomes a normal win");
  assert.equal(second.change, 250);

  now += STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS;
  const reopened = new StreamWeaverEconomy({ client, tenantId: "tenant-3", store, nowMs: () => now, random: sequence([0.0, 0.0]) });
  const third = await reopened.gamble({ userId: "gambler", bet: 1000, operationId: "gamble-jp-2" });
  assert.equal(third.outcome, "jackpot");
});

test("classic gamble loss and six-sided roll preserve donor outcome math", async () => {
  const client = fakeClient();
  const loss = new StreamWeaverEconomy({ client, tenantId: "tenant-1", store: new MemoryStreamWeaverEconomyStore(), random: sequence([0.90]) });
  const gamble = await loss.gamble({ userId: "gambler", bet: 400, operationId: "loss" });
  assert.equal(gamble.outcome, "loss");
  assert.equal(gamble.change, -400);
  assert.equal(gamble.payout, 0);

  assert.deepEqual(determineRollOutcome(1, 100), { label: "Total loss!", change: -100 });
  assert.deepEqual(determineRollOutcome(2, 101), { label: "Partial loss", change: -50 });
  assert.deepEqual(determineRollOutcome(3, 100), { label: "Break even", change: 0 });
  assert.deepEqual(determineRollOutcome(4, 100), { label: "Small win!", change: 25 });
  assert.deepEqual(determineRollOutcome(5, 100), { label: "Nice win!", change: 50 });
  assert.deepEqual(determineRollOutcome(6, 100), { label: "Big win!", change: 100 });
  const roller = new StreamWeaverEconomy({ client, tenantId: "tenant-1", store: new MemoryStreamWeaverEconomyStore(), random: sequence([0.999]) });
  const result = await roller.roll({ userId: "gambler", bet: 100, operationId: "roll-6" });
  assert.equal(result.die, 6);
  assert.equal(result.change, 100);
  assert.equal(result.payout, 200);
  assert.equal(result.canDouble, true);
});

test("point parsing retains common StreamWeaver amount aliases within canonical safe range", () => {
  assert.equal(parseStreamWeaverPointAmount("1k"), 1000);
  assert.equal(parseStreamWeaverPointAmount("1.5k"), 1500);
  assert.equal(parseStreamWeaverPointAmount("1m"), 1_000_000);
  assert.equal(parseStreamWeaverPointAmount("10^3"), 1000);
  assert.equal(formatCompactPointAmount(1250), "1.25K");
  assert.equal(formatCompactPointAmount(2_000_000), "2M");
});
