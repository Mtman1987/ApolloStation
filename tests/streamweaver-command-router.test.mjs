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

function fixture({ now = 1_000_000 } = {}) {
  const calls = [];
  const economy = {
    points: async (userId) => { calls.push(["points", userId]); return { userId, spendableXp: 1200, lifetimeXp: 2000, rank: 3, level: 5 }; },
    leaderboard: async (limit) => { calls.push(["leaderboard", limit]); return [{ rank: 1, userId: "captain", spendableXp: 5000 }, { rank: 2, userId: "friend", spendableXp: 2500 }]; },
    givePoints: async (input) => { calls.push(["give", input]); return { success: true, message: `gave ${input.amount} to ${input.toDisplayName}` }; },
    stealPoints: async (input) => { calls.push(["steal", input]); return { success: true, message: `stole ${input.amount} from ${input.toDisplayName}` }; },
    gamble: async (input) => { calls.push(["gamble", input]); return { success: true, message: `gambled ${input.bet ?? "default"}` }; },
    roll: async (input) => { calls.push(["roll", input]); return { success: true, die: 6, outcome: "Big win!", change: input.bet, newTotal: 2400 }; },
  };
  const admin = {
    addPoints: async (userId, amount, operationId, metadata) => { calls.push(["addPoints", userId, amount, operationId, metadata]); return { spendableXp: 1500 }; },
    setPoints: async (userId, amount, operationId, metadata) => { calls.push(["setPoints", userId, amount, operationId, metadata]); return { spendableXp: Math.max(0, amount) }; },
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

test("!points reads the canonical wallet on Twitch, Discord, and Kick without a mod lookup", async () => {
  for (const provider of ["twitch", "discord", "kick"]) {
    const f = fixture();
    const result = await f.consumer.route(delivery("!points", { provider, deliveryId: `${provider}-points` }));
    assert.equal(result.text, "@Captain has 1.2K points!");
    assert.deepEqual(f.calls[0], ["points", "user-1"]);
  }
});

test("unlinked provider actors can be resolved into the canonical SPMT identity before wallet use", async () => {
  const f = fixture();
  const result = await f.consumer.route(delivery("!points", { unlinked: true, providerUserId: "unlinked-provider", provider: "discord" }));
  assert.equal(result.text, "@Captain has 1.2K points!");
  assert.equal(f.calls[0][0], "resolve");
  assert.deepEqual(f.calls[1], ["points", "resolved-user"]);
});

test("givepoints and stealpoints resolve mentioned provider users and preserve production usage", async () => {
  const mention = { token: "@friend", providerUserId: "target-provider", username: "friend" };
  const f = fixture();
  const give = await f.consumer.route(delivery("!givepoints @friend 125", { mentions: [mention], deliveryId: "give-1" }));
  assert.equal(give.text, "gave 125 to friend");
  const giveCall = f.calls.find((entry) => entry[0] === "give")[1];
  assert.equal(giveCall.fromUserId, "user-1");
  assert.equal(giveCall.toUserId, "target-user");
  assert.equal(giveCall.amount, 125);
  assert.equal(giveCall.operationId, "give-1");

  const steal = await f.consumer.route(delivery("!stealpoints @friend 200", { mentions: [mention], deliveryId: "steal-1" }));
  assert.equal(steal.text, "stole 200 from friend");
  assert.equal(f.calls.find((entry) => entry[0] === "steal")[1].amount, 200);
  const usage = await f.consumer.route(delivery("!stealpoints friend bananas", { mentions: [], deliveryId: "steal-bad" }));
  assert.match(usage.text, /usage: !stealpoints @user amount/);
});

test("gamble alias shares the donor ten-second user cooldown", async () => {
  const f = fixture({ now: 10_000 });
  const first = await f.consumer.route(delivery("!gambel 100", { deliveryId: "gamble-1" }));
  assert.equal(first.text, "gambled 100");
  const second = await f.consumer.route(delivery("!gamble 100", { deliveryId: "gamble-2" }));
  assert.match(second.text, /wait 10s/);
  f.setNow(20_000);
  const third = await f.consumer.route(delivery("!gamble 100", { deliveryId: "gamble-3" }));
  assert.equal(third.text, "gambled 100");
  assert.equal(f.calls.filter((entry) => entry[0] === "gamble").length, 2);
});

test("roll preserves aliases for ALL/HALF/QUARTER/THIRD through the canonical wallet", async () => {
  const aliases = [["ALL", 1200], ["HALF", 600], ["QUARTER", 300], ["THIRD", 400]];
  for (const [token, expected] of aliases) {
    const f = fixture({ now: 100_000 });
    const result = await f.consumer.route(delivery(`!roll ${token}`, { deliveryId: `roll-${token}` }));
    assert.match(result.text, /rolled 6/);
    const roll = f.calls.find((entry) => entry[0] === "roll")[1];
    assert.equal(roll.bet, expected);
  }
});

test("pleader keeps its fifteen-second tenant-global cooldown", async () => {
  const f = fixture({ now: 50_000 });
  const first = await f.consumer.route(delivery("!pleader", { actorUserId: "user-a", deliveryId: "leader-1" }));
  assert.match(first.text, /1\. captain — 5K/);
  const second = await f.consumer.route(delivery("!pleader", { actorUserId: "user-b", username: "other", displayName: "Other", deliveryId: "leader-2" }));
  assert.match(second.text, /wait 15s/);
});

test("moderator point commands preserve production permission gates and wording", async () => {
  const mention = { token: "@friend", providerUserId: "target-provider", canonicalUserId: "target-user", username: "friend" };
  const denied = fixture();
  assert.match((await denied.consumer.route(delivery("!addpoints @friend 50", { mentions: [mention], deliveryId: "denied" }))).text, /only mods/);
  assert.equal(denied.calls.some((entry) => entry[0] === "addPoints"), false);

  const f = fixture();
  const mod = { roles: ["moderator"], mentions: [mention] };
  assert.equal((await f.consumer.route(delivery("!addpoints @friend 50", { ...mod, deliveryId: "add-1" }))).text, "@friend now has 1.5K pts (+50)");
  assert.equal((await f.consumer.route(delivery("!setpoints @friend 7", { ...mod, deliveryId: "set-1" }))).text, "@friend points set to 7");
  assert.equal((await f.consumer.route(delivery("!addtoall 10", { roles: ["broadcaster"], deliveryId: "all-add" }))).text, "+10 pts to 4 users!");
  assert.equal((await f.consumer.route(delivery("!settoall 99", { roles: ["moderator"], deliveryId: "all-set" }))).text, "Set 4 users to 99 pts");
  assert.equal((await f.consumer.route(delivery("!resetallpoints", { roles: ["moderator"], deliveryId: "all-reset" }))).text, "Reset points for 4 users to 0");
});

test("delivery replay reuses the persisted command response and the same egress idempotency key", async () => {
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
