import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS,
  MemoryStreamWeaverEconomyStore,
  STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS,
  STREAMWEAVER_STEAL_COOLDOWN_MS,
  StreamWeaverEconomy,
  calculateStreamWeaverExchangeRate,
  determineRollOutcome,
  formatCompactPointAmount,
  parseStreamWeaverPointAmount,
  validateStreamWeaverCurrencyName,
} from "../apps/streamweaver/dist/index.js";

function sequence(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function fakeSpmtClient({ failAwards = false } = {}) {
  const calls = [];
  return {
    calls,
    awardXp: async (...args) => {
      calls.push(args);
      if (failAwards) throw new Error("SPMT temporarily unavailable");
      return { awarded: true, duplicate: false };
    },
  };
}

function configuredEconomy({ tenantId = "tenant-1", store = new MemoryStreamWeaverEconomyStore(), client, nowMs, random, exchange = false } = {}) {
  const economy = new StreamWeaverEconomy({ client, tenantId, store, nowMs, random });
  economy.configureCurrency({ currencyName: "Starbits", spmtExchangeEnabled: exchange, baseLocalPerSpmt: 1000, referenceSupply: 1_000_000, maxSpmtPerExchange: 100 });
  return { economy, store };
}

function seed(store, tenantId, values) {
  for (const [userId, balance] of Object.entries(values)) store.adjustBalance(tenantId, userId, balance, true);
}

test("StreamWeaver requires an owner-chosen currency name and rejects SPMT/XP identity terms", () => {
  const store = new MemoryStreamWeaverEconomyStore();
  const economy = new StreamWeaverEconomy({ tenantId: "tenant-1", store });
  assert.equal(DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS.currencyConfigured, false);
  assert.throws(() => economy.points("user-1"), /owner must choose a custom currency name/);
  for (const name of ["XP", "SPMT", "SPMTs", "SpaceMountain XP"]) assert.throws(() => validateStreamWeaverCurrencyName(name), /cannot use SPMT or XP/);
  assert.equal(economy.configureCurrency({ currencyName: "Starbits" }).currencyName, "Starbits");
  assert.equal(economy.points("user-1").balance, 0);
});

test("give, steal, gamble and roll mutate only the StreamWeaver local wallet", async () => {
  const client = fakeSpmtClient();
  const store = new MemoryStreamWeaverEconomyStore();
  seed(store, "tenant-1", { thief: 1000, target: 1000, gambler: 10000 });
  const { economy } = configuredEconomy({ store, client, nowMs: () => 5_000_000, random: sequence([0.10, 0.0, 0.90, 0.999]) });

  const give = await economy.givePoints({ fromUserId: "thief", toUserId: "target", amount: 100, operationId: "give-1" });
  assert.equal(give.success, true);
  assert.equal(store.getWallet("tenant-1", "thief").balance, 900);
  assert.equal(store.getWallet("tenant-1", "target").balance, 1100);

  const steal = await economy.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 200, operationId: "steal-1" });
  assert.equal(steal.outcome, "success");
  assert.equal(store.getWallet("tenant-1", "thief").balance, 1100);
  assert.equal(store.getWallet("tenant-1", "target").balance, 900);

  const gamble = await economy.gamble({ userId: "gambler", bet: 400, operationId: "gamble-1" });
  assert.equal(gamble.outcome, "loss");
  assert.equal(store.getWallet("tenant-1", "gambler").balance, 9600);

  const roll = await economy.roll({ userId: "gambler", bet: 100, operationId: "roll-1" });
  assert.equal(roll.die, 6);
  assert.equal(store.getWallet("tenant-1", "gambler").balance, 9700);
  assert.equal(client.calls.length, 0, "normal StreamWeaver economy never calls SPMT XP");
});

test("give replay does not move local currency twice", async () => {
  const store = new MemoryStreamWeaverEconomyStore();
  seed(store, "tenant-1", { a: 1000, b: 0 });
  const { economy } = configuredEconomy({ store });
  await economy.givePoints({ fromUserId: "a", toUserId: "b", amount: 250, operationId: "same" });
  const replay = await economy.givePoints({ fromUserId: "a", toUserId: "b", amount: 250, operationId: "same" });
  assert.equal(replay.duplicate, true);
  assert.equal(store.getWallet("tenant-1", "a").balance, 750);
  assert.equal(store.getWallet("tenant-1", "b").balance, 250);
});

test("steal preserves two-hour cooldown and donor success bands with local currency", async () => {
  let now = 1_000_000;
  const store = new MemoryStreamWeaverEconomyStore();
  seed(store, "tenant-1", { thief: 1000, target: 1000 });
  const firstEconomy = configuredEconomy({ store, nowMs: () => now, random: sequence([0.30, 0.4]) }).economy;
  const partial = await firstEconomy.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 201, operationId: "partial" });
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.pointsChanged, 100);
  const cooling = await firstEconomy.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 100, operationId: "cool" });
  assert.match(cooling.message, /cooldown/);
  now += STREAMWEAVER_STEAL_COOLDOWN_MS;
  const secondEconomy = configuredEconomy({ store, nowMs: () => now, random: sequence([0.70, 0.0]) }).economy;
  const failed = await secondEconomy.stealPoints({ fromUserId: "thief", toUserId: "target", amount: 100, operationId: "failed" });
  assert.equal(failed.outcome, "fail");
});

test("jackpot remains globally gated without touching SPMT", async () => {
  let now = 20_000_000;
  const store = new MemoryStreamWeaverEconomyStore();
  seed(store, "tenant-1", { gambler: 10000 });
  const first = configuredEconomy({ store, nowMs: () => now, random: sequence([0.0, 0.5]) }).economy;
  const jackpot = await first.gamble({ userId: "gambler", bet: 1000, operationId: "jp-1" });
  assert.equal(jackpot.outcome, "jackpot");
  const blocked = configuredEconomy({ tenantId: "tenant-2", store, nowMs: () => now + 1000, random: sequence([0.0, 0.0]) }).economy;
  seed(store, "tenant-2", { gambler: 10000 });
  const normalWin = await blocked.gamble({ userId: "gambler", bet: 1000, operationId: "jp-2" });
  assert.equal(normalWin.outcome, "win");
  now += STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS;
  const reopened = configuredEconomy({ tenantId: "tenant-3", store, nowMs: () => now, random: sequence([0.0, 0.0]) }).economy;
  seed(store, "tenant-3", { gambler: 10000 });
  assert.equal((await reopened.gamble({ userId: "gambler", bet: 1000, operationId: "jp-3" })).outcome, "jackpot");
});

test("local-to-SPMT exchange linearly dilutes as local supply increases", () => {
  const settings = { ...DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS, currencyName: "Starbits", currencyConfigured: true, spmtExchangeEnabled: true, baseLocalPerSpmt: 1000, referenceSupply: 1_000_000, maxSpmtPerExchange: 100 };
  assert.equal(calculateStreamWeaverExchangeRate(500_000, settings).localPerSpmt, 1000);
  assert.equal(calculateStreamWeaverExchangeRate(1_000_000, settings).localPerSpmt, 1000);
  assert.equal(calculateStreamWeaverExchangeRate(2_000_000, settings).localPerSpmt, 2000);
  assert.equal(calculateStreamWeaverExchangeRate(10_000_000, settings).localPerSpmt, 10000);
});

test("SPMT exchange is explicit, capped and replay-safe while normal gambling stays local", async () => {
  const store = new MemoryStreamWeaverEconomyStore();
  const client = fakeSpmtClient();
  seed(store, "tenant-1", { user: 1_100_000 });
  const { economy } = configuredEconomy({ store, client, exchange: true, nowMs: () => 1234567 });
  const quote = economy.quoteLocalToSpmt(10_000);
  assert.equal(quote.localPerSpmt, 1100);
  assert.equal(quote.spmtAmount, 9);
  assert.equal(quote.localSpent, 9900);
  const before = store.getWallet("tenant-1", "user").balance;
  const first = await economy.exchangeLocalForSpmt({ userId: "user", localAmount: 10_000, operationId: "exchange-1" });
  assert.equal(first.success, true);
  assert.equal(first.exchange.spmtAwarded, 9);
  assert.equal(store.getWallet("tenant-1", "user").balance, before - 9900);
  assert.equal(client.calls.length, 1);
  const replay = await economy.exchangeLocalForSpmt({ userId: "user", localAmount: 10_000, operationId: "exchange-1" });
  assert.equal(replay.duplicate, true);
  assert.equal(store.getWallet("tenant-1", "user").balance, before - 9900);
  assert.equal(client.calls.length, 1);
});

test("failed SPMT award leaves a reserved exchange for idempotent retry without double local deduction", async () => {
  const store = new MemoryStreamWeaverEconomyStore();
  seed(store, "tenant-1", { user: 20_000 });
  const failing = fakeSpmtClient({ failAwards: true });
  const economy = configuredEconomy({ store, client: failing, exchange: true }).economy;
  const before = store.getWallet("tenant-1", "user").balance;
  const first = await economy.exchangeLocalForSpmt({ userId: "user", localAmount: 10_000, operationId: "pending-1" });
  assert.equal(first.pending, true);
  const afterFirst = store.getWallet("tenant-1", "user").balance;
  assert.ok(afterFirst < before);
  const second = await economy.exchangeLocalForSpmt({ userId: "user", localAmount: 10_000, operationId: "pending-1" });
  assert.equal(second.pending, true);
  assert.equal(store.getWallet("tenant-1", "user").balance, afterFirst);
});

test("amount aliases and roll math remain compatible", () => {
  assert.equal(parseStreamWeaverPointAmount("1k"), 1000);
  assert.equal(parseStreamWeaverPointAmount("1.5k"), 1500);
  assert.equal(parseStreamWeaverPointAmount("1m"), 1_000_000);
  assert.equal(parseStreamWeaverPointAmount("10^3"), 1000);
  assert.equal(formatCompactPointAmount(1250), "1.25K");
  assert.deepEqual(determineRollOutcome(1, 100), { label: "Total loss!", change: -100 });
  assert.deepEqual(determineRollOutcome(6, 100), { label: "Big win!", change: 100 });
});
