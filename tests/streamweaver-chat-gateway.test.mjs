import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteStreamWeaverSummonStore, StreamWeaverChatGatewayConsumer, planStreamWeaverPersonaRoute } from "../apps/streamweaver/dist/index.js";

const at = (minute) => new Date(Date.UTC(2026, 7, 23, 16, minute)).toISOString();
const config = { schemaVersion: 1, tenantId: "tenant-a", personaId: "persona-athena", displayName: "Athena", aliases: ["athena", "annie", "athenabot87"], ownerCanonicalUserId: "owner-mt", homeChannelIds: ["home-channel"], summonWindowMs: 10 * 60 * 1000 };
function delivery(id, minute, text, extra = {}) {
  return { schemaVersion: 1, deliveryId: id, consumerId: "streamweaver.persona", attempts: 0, message: { schemaVersion: 1, tenantId: "tenant-a", provider: "twitch", connectionId: "twitch-main", channelId: "guest-channel", messageId: id, text, occurredAt: at(minute), actor: { providerUserId: "provider-user", canonicalUserId: "viewer-1", username: "viewer", isBot: false, roles: ["member"] }, mentions: [], ...extra } };
}

test("owner summons a configured persona into an external channel for exactly ten minutes", () => {
  const owner = delivery("owner-summon", 0, "Hey Athena, help this chat", { actor: { providerUserId: "94371378", canonicalUserId: "owner-mt", username: "mtman1987", isBot: false, roles: ["broadcaster"] } });
  const summon = planStreamWeaverPersonaRoute(owner, config);
  assert.equal(summon.kind, "invoke");
  assert.equal(summon.invocation.personaId, "persona-athena");
  assert.equal(summon.invocation.message, "help this chat");
  assert.equal(summon.openSummonUntil, at(10));
  const allowed = planStreamWeaverPersonaRoute(delivery("viewer-allowed", 5, "@athenabot87 explain this"), config, summon.openSummonUntil);
  assert.equal(allowed.kind, "invoke");
  const casual = planStreamWeaverPersonaRoute(delivery("viewer-casual", 5, "athena explain this"), config, summon.openSummonUntil);
  assert.deepEqual(casual, { kind: "ignored", reason: "not-addressed" });
  const expired = planStreamWeaverPersonaRoute(delivery("viewer-expired", 10, "@athena are you there"), config, summon.openSummonUntil);
  assert.deepEqual(expired, { kind: "ignored", reason: "outside-summon-window" });
});

test("home-channel mentions work without a summon while bot messages never dispatch", () => {
  const home = delivery("home-1", 0, "@annie hello", { channelId: "home-channel" });
  assert.equal(planStreamWeaverPersonaRoute(home, config).kind, "invoke");
  const bot = delivery("bot-1", 0, "@athena loop", { channelId: "home-channel", actor: { providerUserId: "bot", username: "anotherbot", isBot: true, roles: ["member"] } });
  assert.deepEqual(planStreamWeaverPersonaRoute(bot, config), { kind: "ignored", reason: "bot" });
});

test("gateway consumer persists summon scope and invokes the configured persona with stable job identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-streamweaver-chat-"));
  const store = new SqliteStreamWeaverSummonStore(join(dir, "summons.db"));
  const invoked = [];
  const sent = [];
  const consumer = new StreamWeaverChatGatewayConsumer(store, { get: () => config }, { invoke: async (input) => { invoked.push(input); return { status: "accepted", jobId: "job-1" }; } }, { send: async (message) => { sent.push(message); return { providerMessageId: "out-1" }; } });
  try {
    await consumer.deliver(delivery("owner-1", 0, "!athena visit", { actor: { providerUserId: "94371378", canonicalUserId: "owner-mt", username: "mtman1987", isBot: false, roles: ["broadcaster"] } }));
    await consumer.deliver(delivery("viewer-1", 5, "@athena hello"));
    assert.equal(invoked.length, 2);
    assert.equal(invoked[1].idempotencyKey, "streamweaver-persona:viewer-1");
    assert.equal(invoked[1].conversationId, "chat:twitch:guest-channel");
    assert.equal(sent.length, 0);
    store.close();
    const reopened = new SqliteStreamWeaverSummonStore(join(dir, "summons.db"));
    const active = reopened.get("tenant-a", "twitch", "guest-channel", "persona-athena");
    assert.equal(active.expiresAt, at(10));
    reopened.close();
  } finally { try { store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
});

test("unavailable persona execution is truthful and replies only through gateway egress", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-streamweaver-unavailable-"));
  const store = new SqliteStreamWeaverSummonStore(join(dir, "summons.db"));
  const sent = [];
  const consumer = new StreamWeaverChatGatewayConsumer(store, { get: () => config }, { invoke: async () => ({ status: "unavailable", reason: "no eligible Stellar Core route" }) }, { send: async (message) => { sent.push(message); return { providerMessageId: "out-1" }; } });
  try {
    await consumer.deliver(delivery("home-unavailable", 0, "@athena hello", { channelId: "home-channel" }));
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /unavailable: no eligible Stellar Core route/);
    assert.equal(sent[0].replyToMessageId, "home-unavailable");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
