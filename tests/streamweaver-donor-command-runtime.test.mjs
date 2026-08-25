import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStreamWeaverCommandState, StreamWeaverDonorCommandConsumer } from "../apps/streamweaver/dist/index.js";

function delivery(text, options = {}) {
  const provider = options.provider ?? "twitch";
  return {
    schemaVersion: 1,
    deliveryId: options.deliveryId ?? `delivery-${Math.random()}`,
    consumerId: "streamweaver.donor-commands",
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
        ...(options.unlinked ? {} : { canonicalUserId: options.actorUserId ?? "user-1" }),
        username: options.username ?? "captain",
        displayName: options.displayName ?? "Captain",
        isBot: false,
        roles: options.roles ?? ["member"],
      },
      mentions: options.mentions ?? [],
    },
  };
}

function fixture() {
  const calls = [];
  const sent = [];
  let now = Date.parse("2026-08-24T19:00:00.000Z");
  const services = { execute: async (input) => { calls.push(input); if (input.canonicalTrigger === "!clip") return "Clip created."; if (input.canonicalTrigger === "!discord") return "https://discord.example/invite"; if (input.command.family === "secret") return `secret:${input.command.donorId}`; if (input.command.family === "persona") return "persona accepted"; return undefined; } };
  const identities = { resolve: async (input) => input.providerUserId === "target-provider" ? "target-user" : "resolved-user" };
  const state = new MemoryStreamWeaverCommandState();
  const egress = { send: async (message) => { sent.push(message); return { providerMessageId: `sent-${sent.length}` }; } };
  const consumer = new StreamWeaverDonorCommandConsumer({ services, identities, state, egress, nowMs: () => now, random: () => 0.25, botNames: ["athena", "loki"] });
  return { calls, sent, state, consumer, tick(ms) { now += ms; } };
}

test("social commands produce real built-in responses and preserve mention targeting", async () => {
  const f = fixture();
  const result = await f.consumer.route(delivery("!hug @friend", { mentions: [{ token: "@friend", providerUserId: "target-provider", username: "friend" }] }));
  assert.equal(result.text, "@Captain hugs @friend!");
  assert.equal(f.calls[0].target.userId, "target-user");
});

test("provider-specific donor commands route through bounded services", async () => {
  const f = fixture();
  assert.equal((await f.consumer.route(delivery("!clip"))).text, "Clip created.");
  assert.equal((await f.consumer.route(delivery("!discord"))).text, "https://discord.example/invite");
  assert.deepEqual(f.calls.slice(0, 2).map((call) => call.canonicalTrigger), ["!clip", "!discord"]);
});

test("donor regex triggers and configured persona names survive the migration", async () => {
  const f = fixture();
  assert.equal((await f.consumer.route(delivery("the bird is the word"))).text, "secret:secret-bird");
  assert.equal((await f.consumer.route(delivery("hey Athena are you there?"))).text, "persona accepted");
  assert.equal(f.calls.filter((call) => call.command.family === "persona").length, 1);
});

test("duplicate lurk definitions preserve chat response and AI automation as distinct effects", async () => {
  const f = fixture();
  const result = await f.consumer.route(delivery("!lurk"));
  assert.equal(result.text, "@Captain is lurking. Thanks for hanging out!");
  assert.deepEqual(f.calls.filter((call) => call.canonicalTrigger === "!lurk").map((call) => call.command.family), ["social", "persona"]);
});

test("coinflip is executable without provider dependencies", async () => {
  const f = fixture();
  assert.equal((await f.consumer.route(delivery("!coinflip"))).text, "@Captain flipped heads.");
});

test("non-economy donor cooldowns are enforced per tenant actor", async () => {
  const f = fixture();
  assert.equal((await f.consumer.route(delivery("!hug"))).text, "@Captain sends chat a hug!");
  assert.match((await f.consumer.route(delivery("!hug"))).text, /wait 2s/);
  f.tick(2_000);
  assert.equal((await f.consumer.route(delivery("!hug"))).text, "@Captain sends chat a hug!");
});

test("economy triggers remain owned by the canonical economy consumer", async () => {
  const f = fixture();
  assert.equal(f.consumer.accepts(delivery("!points").message), false);
  assert.equal(await f.consumer.route(delivery("!gamble 100")), undefined);
  assert.equal(f.calls.length, 0);
});

test("delivery replay does not re-execute the donor capability", async () => {
  const f = fixture();
  const input = delivery("!clip", { deliveryId: "clip-replay", messageId: "clip-message" });
  await f.consumer.deliver(input);
  await f.consumer.deliver({ ...input, attempts: 2 });
  assert.equal(f.calls.filter((call) => call.canonicalTrigger === "!clip").length, 1);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].idempotencyKey, "streamweaver-donor-command:clip-replay");
  assert.equal(f.sent[1].idempotencyKey, "streamweaver-donor-command:clip-replay");
});
