import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatGatewayRuntime, SqliteChatGatewayStore, normalizeProviderChatEnvelope } from "../apps/chat-gateway/dist/index.js";
import { ChatTagRuntime, SqliteChatTagStore, createChatTagGatewayConsumer } from "../apps/nebula-arcade/dist/index.js";

const at = (minute) => new Date(Date.UTC(2026, 7, 23, 12, minute)).toISOString();
const envelope = (provider, messageId, tenantId = "tenant-a", extra = {}) => ({
  schemaVersion: 1,
  tenantId,
  provider,
  connectionId: provider + "-connection",
  channelId: provider + "-channel",
  messageId,
  text: "hello",
  occurredAt: at(0),
  providerUserId: provider + "-user",
  username: provider + "User",
  roles: ["member"],
  ...extra,
});

function withStores(work) {
  const dir = mkdtempSync(join(tmpdir(), "spmt-chat-gateway-"));
  const gatewayStore = new SqliteChatGatewayStore(join(dir, "gateway.db"));
  const tagStore = new SqliteChatTagStore(join(dir, "tag.db"));
  return Promise.resolve(work({ dir, gatewayStore, tagStore })).finally(() => { gatewayStore.close(); tagStore.close(); rmSync(dir, { recursive: true, force: true }); });
}

test("Twitch, Discord, and Kick normalize to one provider-neutral message contract", () => {
  for (const provider of ["twitch", "discord", "kick"]) {
    const value = normalizeProviderChatEnvelope(envelope(provider, provider + "-1", "tenant-a", { sourceChannelId: "shared-origin", canonicalUserId: "spmt-user-1", displayName: "Display", mentions: [{ token: "<@1>", providerUserId: "provider-2", canonicalUserId: "spmt-user-2", username: "Target" }] }));
    assert.equal(value.provider, provider);
    assert.equal(value.actor.canonicalUserId, "spmt-user-1");
    assert.equal(value.sourceChannelId, "shared-origin");
    assert.equal(value.mentions[0].canonicalUserId, "spmt-user-2");
  }
});

test("gateway dedupes provider messages durably and isolates tenants", async () => withStores(async ({ gatewayStore }) => {
  const seen = [];
  const consumer = { id: "test-consumer", accepts: () => true, deliver: (delivery) => { seen.push(delivery.message); } };
  const gateway = new ChatGatewayRuntime(gatewayStore, [consumer]);
  const first = await gateway.ingest(envelope("twitch", "message-1"));
  const replay = await gateway.ingest(envelope("twitch", "message-1"));
  await gateway.ingest(envelope("twitch", "message-1", "tenant-b"));
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(seen.length, 2);
  assert.equal(gatewayStore.countMessages("tenant-a"), 1);
  assert.equal(gatewayStore.countMessages("tenant-b"), 1);
}));

test("failed consumer delivery remains retryable with redacted durable evidence", async () => withStores(async ({ gatewayStore }) => {
  let fail = true;
  const consumer = { id: "retry-consumer", accepts: () => true, deliver: () => { if (fail) throw new Error("authorization=secret-value Bearer provider-token"); } };
  const gateway = new ChatGatewayRuntime(gatewayStore, [consumer]);
  const first = await gateway.ingest(envelope("discord", "retry-1"));
  assert.deepEqual(first.delivery, { attempted: 1, delivered: 0, failed: 1 });
  assert.equal(gatewayStore.listPending("tenant-a")[0].attempts, 1);
  fail = false;
  const retry = await gateway.flush("tenant-a");
  assert.deepEqual(retry, { attempted: 1, delivered: 1, failed: 0 });
  assert.equal(gatewayStore.listPending("tenant-a").length, 0);
}));

test("Chat Tag consumes the shared gateway, merges canonical identity, and replies through provider egress", async () => withStores(async ({ gatewayStore, tagStore }) => {
  const sent = [];
  const spmt = { publishEvent: async () => ({}), awardXp: async () => ({}) };
  const tag = new ChatTagRuntime(tagStore, spmt);
  let gateway;
  const tagConsumer = createChatTagGatewayConsumer(tag, { send: (message) => gateway.send(message) });
  gateway = new ChatGatewayRuntime(gatewayStore, [tagConsumer], [
    { provider: "twitch", send: async (message) => { sent.push(message); return { providerMessageId: "tw-out-1" }; } },
    { provider: "discord", send: async (message) => { sent.push(message); return { providerMessageId: "dc-out-1" }; } },
  ]);

  await gateway.ingest(envelope("twitch", "join-1", "tenant-a", { text: "spmt join", canonicalUserId: "spmt-user-1", username: "Alpha" }));
  await gateway.ingest(envelope("discord", "status-1", "tenant-a", { text: "spmt score", canonicalUserId: "spmt-user-1", username: "AlphaDiscord", occurredAt: at(1) }));
  const state = tag.getState("tenant-a").state;
  assert.deepEqual(Object.keys(state.players), ["spmt-user-1"]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].provider, "twitch");
  assert.equal(sent[0].replyToMessageId, "join-1");
  assert.match(sent[0].text, /joined/i);
  assert.equal(sent[1].provider, "discord");
  assert.equal(sent[1].replyToMessageId, "status-1");
  assert.match(sent[1].text, /0 points/);
  assert.match(sent[1].idempotencyKey, /chat-tag-reply/);
}));

test("unlinked provider users remain stable provider-scoped actors instead of merging by display name", async () => withStores(async ({ gatewayStore, tagStore }) => {
  const tag = new ChatTagRuntime(tagStore, { publishEvent: async () => ({}), awardXp: async () => ({}) });
  const consumer = createChatTagGatewayConsumer(tag, { send: async () => ({ providerMessageId: "unused" }) });
  const gateway = new ChatGatewayRuntime(gatewayStore, [consumer]);
  await gateway.ingest(envelope("twitch", "join-tw", "tenant-a", { text: "spmt join", providerUserId: "100", username: "SameName" }));
  await gateway.ingest(envelope("discord", "join-dc", "tenant-a", { text: "spmt join", providerUserId: "200", username: "SameName", occurredAt: at(1) }));
  assert.deepEqual(Object.keys(tag.getState("tenant-a").state.players).sort(), ["provider:discord:200", "provider:twitch:100"]);
}));
