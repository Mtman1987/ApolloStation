import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStreamWeaverCommandState, StreamWeaverEconomyCommandConsumer } from "../apps/streamweaver/dist/index.js";

function delivery(text, options = {}) {
  const provider = options.provider ?? "twitch";
  const actorUserId = options.actorUserId ?? "user-1";
  return {
    schemaVersion: 1,
    deliveryId: options.deliveryId ?? `delivery-${Math.random()}`,
    consumerId: "streamweaver.economy",
    attempts: options.attempts ?? 1,
    message: {
      schemaVersion: 1,
      tenantId: "tenant-1",
      provider,
      connectionId: `${provider}-connection`,
      channelId: "channel-1",
      messageId: options.messageId ?? `message-${Math.random()}`,
      text,
      occurredAt: "2026-08-24T19:00:00.000Z",
      actor: {
        providerUserId: options.providerUserId ?? "provider-user-1",
        ...(options.unlinked ? {} : { canonicalUserId: actorUserId }),
        username: options.username ?? "captain",
        displayName: options.displayName ?? "Captain",
        isBot: false,
        roles: options.roles ?? ["member"],
      },
      mentions: options.mentions ?? [],
    },
  };
}

function fixture({ now = 1_000_000, configured = true } = {}) {
  const calls = [];
  let settings = { currencyName: "Starbits", currencyConfigured: configured, spmtExchangeEnabled: false };
  const economy = {
    currencyName: () => { if (!settings.currencyConfigured) throw new Error("StreamWeaver owner must choose a custom currency name before economy commands can be used"); return settings.currencyName; },
    getCurrencySettings: () => ({ ...settings }),
    configureCurrency: ({ currencyName }) => { settings = { ...settings, currencyName, currencyConfigured: true }; calls.push(["configureCurrency", currencyName]); return { ...settings }; },
    points: (userId) => { if (!settings.currencyConfigured) throw new Error("StreamWeaver owner must choose a custom currency name before economy commands can be used"); calls.push(["points", userId]); return { userId, balance: 1200, totalEarned: 2000 }; },
    leaderboard: (limit) => { calls.push(["leaderboard", limit]); return [{ rank: 1, userId: "captain", balance: 5000 }, { rank: 2, userId: "friend", balance: 2500 }]; },
    givePoints: async (input) => { calls.push(["give", input]); return { success: true, message: `gave ${input.amount} Starbits to ${input.toDisplayName}` }; },
    stealPoints: async (input) => { calls.push(["steal", input]); return { success: true, message: `stole ${input.amount} Starbits from ${input.toDisplayName}` }; },
    gamble: async (input) => { calls.push(["gamble", input]); return { success: true, message: `gambled ${input.bet ?? "default"} Starbits` }; },
    roll: async (input) => { calls.push(["roll", input]); return { success: true, die: 6, outcome: "Big win!", change: input.bet, newTotal: 2400 }; },
    exchangeLocalForSpmt: async (input) => { calls.push(["exchange", input]); return { success: true, exchange: { localSpent: input.localAmount, currencyName: "Starbits", spmtAwarded: 5 } }; },
  };
  const admin = {
    addPoints: async (userId, amount, operationId, metadata) => { calls.push(["addPoints", userId, amount, operationId, metadata]); return { balance: 1500 }; },
    setPoints: async (userId, amount, operationId, metadata) => { calls.push(["setPoints", userId, amount, operationId, metadata]); return { balance: Math.max(0, amount) }; },
    addToAll: async (amount, operationId, metadata) => { calls.push(["addToAll", amount, operationId, metadata]); return 4; },
    setToAll: async (amount, operationId, metadata) => { calls.push(["setToAll", amount, operationId, metadata]); return 4; },
    resetAll: async (operationId, metadata) => { calls.push(["resetAll", operationId, metadata]); return 4; },
  };
  const identities = {
    resolve: async (input) => { calls.push(["resolve", input]); return input.providerUserId === "target-provider" ? "target-user" : input.providerUserId === "unlinked-provider" ? "resolved-user" : undefined; },
  };
  const sent = [];
  const egress = { send: async (message) => { sent.push(message); return { providerMessageId: `sent-${sent.length}` }; } };
  const state = new MemoryStreamWeaverCommandState();
  let clock = now;
  const consumer = new StreamWeaverEconomyCommandConsumer(economy, admin, identities, state, egress, () => clock);
  return { calls, sent, state, consumer, setNow(value) { clock = value; } };
}

test("!currency explains the owner setup gate before a local currency is configured", async () => {
  const f = fixture({ configured: false });
  const result = await f.consumer.route(delivery("!currency", { deliveryId: "currency-status" }));
  assert.match(result.text, /owner must choose a custom currency name/);
  const blocked = await f.consumer.route(delivery("!points", { deliveryId: "points-before-config" }));
  assert.match(blocked.text, /owner must choose a custom currency name/);
});

test("only broadcaster can choose the StreamWeaver currency name", async () => {
  const denied = fixture({ configured: false });
  assert.match((await denied.consumer.route(delivery("!currencyname Starbits", { roles: ["moderator"], deliveryId: "rename-denied" }))).text, /only the broadcaster/);
  assert.equal(denied.calls.some((entry) => entry[0] === "configureCurrency"), false);
  const f = fixture({ configured: false });
  const result = await f.consumer.route(delivery("!currencyname Starbits", { roles: ["broadcaster"], deliveryId: "rename-ok" }));
  assert.match(result.text, /currency is now Starbits/);
  assert.match(result.text, /separate from SPMT XP/);
  assert.deepEqual(f.calls[0], ["configureCurrency", "Starbits"]);
});

test("!points reads the StreamWeaver local wallet on Twitch, Discord, and Kick", async () => {
  for (const provider of ["twitch", "discord", "kick"]) {
    const f = fixture();
    const result = await f.consumer.route(delivery("!points", { provider, deliveryId: `${provider}-points` }));
    assert.equal(result.text, "@Captain has 1.2K Starbits!");
    assert.deepEqual(f.calls[0], ["points", "user-1"]);
  }
});

test("unlinked provider actors resolve to canonical identity before local wallet use", async () => {
  const f = fixture();
  const result = await f.consumer.route(delivery("!points", { unlinked: true, providerUserId: "unlinked-provider", provider: "discord" }));
  assert.equal(result.text, "@Captain has 1.2K Starbits!");
  assert.equal(f.calls[0][0], "resolve");
  assert.deepEqual(f.calls[1], ["points", "resolved-user"]);
});

test("givepoints and stealpoints preserve production command vocabulary but use local currency", async () => {
  const mention = { token: "@friend", providerUserId: "target-provider", username: "friend" };
  const f = fixture();
  const give = await f.consumer.route(delivery("!givepoints @friend 125", { mentions: [mention], deliveryId: "give-1" }));
  assert.equal(give.text, "gave 125 Starbits to friend");
  const giveCall = f.calls.find((entry) => entry[0] === "give")[1];
  assert.equal(giveCall.fromUserId, "user-1");
  assert.equal(giveCall.toUserId, "target-user");
  assert.equal(giveCall.amount, 125);
  const steal = await f.consumer.route(delivery("!stealpoints @friend 200", { mentions: [mention], deliveryId: "steal-1" }));
  assert.equal(steal.text, "stole 200 Starbits from friend");
  assert.equal(f.calls.find((entry) => entry[0] === "steal")[1].amount, 200);
});

test("gamble alias shares the donor ten-second local-currency cooldown", async () => {
  const f = fixture({ now: 10_000 });
  assert.equal((await f.consumer.route(delivery("!gambel 100", { deliveryId: "gamble-1" }))).text, "gambled 100 Starbits");
  assert.match((await f.consumer.route(delivery("!gamble 100", { deliveryId: "gamble-2" }))).text, /wait 10s/);
  f.setNow(20_000);
  assert.equal((await f.consumer.route(delivery("!gamble 100", { deliveryId: "gamble-3" }))).text, "gambled 100 Starbits");
});

test("roll aliases derive from local balance and name the local currency", async () => {
  const aliases = [["ALL", 1200], ["HALF", 600], ["QUARTER", 300], ["THIRD", 400]];
  for (const [token, expected] of aliases) {
    const f = fixture({ now: 100_000 });
    const result = await f.consumer.route(delivery(`!roll ${token}`, { deliveryId: `roll-${token}` }));
    assert.match(result.text, /Starbits/);
    assert.equal(f.calls.find((entry) => entry[0] === "roll")[1].bet, expected);
  }
});

test("pleader keeps its tenant-global cooldown and local currency label", async () => {
  const f = fixture({ now: 50_000 });
  const first = await f.consumer.route(delivery("!pleader", { actorUserId: "user-a", deliveryId: "leader-1" }));
  assert.match(first.text, /🏆 Starbits:/);
  assert.match(first.text, /1\. captain — 5K/);
  const second = await f.consumer.route(delivery("!pleader", { actorUserId: "user-b", username: "other", displayName: "Other", deliveryId: "leader-2" }));
  assert.match(second.text, /wait 15s/);
});

test("moderator point commands now mutate and report only the local StreamWeaver currency", async () => {
  const mention = { token: "@friend", providerUserId: "target-provider", canonicalUserId: "target-user", username: "friend" };
  const denied = fixture();
  assert.match((await denied.consumer.route(delivery("!addpoints @friend 50", { mentions: [mention], deliveryId: "denied" }))).text, /only mods/);
  const f = fixture();
  const mod = { roles: ["moderator"], mentions: [mention] };
  assert.equal((await f.consumer.route(delivery("!addpoints @friend 50", { ...mod, deliveryId: "add-1" }))).text, "@friend now has 1.5K Starbits (+50)");
  assert.equal((await f.consumer.route(delivery("!setpoints @friend 7", { ...mod, deliveryId: "set-1" }))).text, "@friend Starbits set to 7");
  assert.equal((await f.consumer.route(delivery("!addtoall 10", { roles: ["broadcaster"], deliveryId: "all-add" }))).text, "+10 Starbits to 4 users!");
  assert.equal((await f.consumer.route(delivery("!settoall 99", { roles: ["moderator"], deliveryId: "all-set" }))).text, "Set 4 users to 99 Starbits");
  assert.equal((await f.consumer.route(delivery("!resetallpoints", { roles: ["moderator"], deliveryId: "all-reset" }))).text, "Reset Starbits for 4 users to 0");
});

test("!exchange is an explicit separate path to SPMT XP", async () => {
  const f = fixture();
  const result = await f.consumer.route(delivery("!exchange 5000", { deliveryId: "exchange-1" }));
  assert.equal(result.text, "@Captain exchanged 5K Starbits for 5 SPMT XP.");
  assert.equal(f.calls.find((entry) => entry[0] === "exchange")[1].localAmount, 5000);
});

test("delivery replay reuses the persisted command response and egress idempotency key", async () => {
  const mention = { token: "@friend", providerUserId: "target-provider", canonicalUserId: "target-user", username: "friend" };
  const f = fixture();
  const input = delivery("!givepoints @friend 25", { mentions: [mention], deliveryId: "delivery-replay", messageId: "message-replay" });
  await f.consumer.deliver(input);
  await f.consumer.deliver({ ...input, attempts: 2 });
  assert.equal(f.calls.filter((entry) => entry[0] === "give").length, 1);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].idempotencyKey, "streamweaver-command:delivery-replay");
  assert.equal(f.sent[1].idempotencyKey, "streamweaver-command:delivery-replay");
  assert.equal(f.sent[0].replyToMessageId, "message-replay");
});
