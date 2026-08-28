import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SpmtStreamWeaverPersonaRuntime, SqliteStreamWeaverSummonStore, StreamWeaverChatGatewayConsumer, StreamWeaverPersonaReplyReconciler, planStreamWeaverPersonaRoute } from "../apps/streamweaver/dist/index.js";

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
    assert.equal(store.getReply("owner-1").jobId, "job-1");
    assert.equal(store.getReply("viewer-1").state, "pending");
    store.close();
    const reopened = new SqliteStreamWeaverSummonStore(join(dir, "summons.db"));
    const active = reopened.get("tenant-a", "twitch", "guest-channel", "persona-athena");
    assert.equal(active.expiresAt, at(10));
    assert.equal(reopened.getReply("viewer-1").replyToMessageId, "viewer-1");
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

test("accepted Stellar work survives restart and emits one ordered provider-neutral reply", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-streamweaver-replies-"));
  const path = join(dir, "streamweaver.db");
  let now = Date.parse(at(1));
  let state = "queued";
  let failSend = true;
  const sent = [];
  const job = () => ({
    schemaVersion: 1, id: "job-result-1", tenantId: "tenant-a", ownerAppId: "stellar-core", capabilityId: "stellar-core.ai-chat.v1", executionOwner: "stellar-core",
    requestedByType: "service", requestedById: "streamweaver", billedUserId: "viewer-1", planId: "creator", meteredResource: "ai-chat-requests", usageQuantity: 1,
    executionTarget: "sprite", meteringTarget: "hosted", idempotencyKey: "streamweaver-persona:result-1", input: { callerAppId: "streamweaver" }, state, attempt: 0, fencingEpoch: 0,
    ...(state === "succeeded" ? { result: { kind: "stellar-chat-result.v1", text: "The durable stream reply is ready." } } : {}), createdAt: at(0), updatedAt: at(1),
  });
  const initial = new SqliteStreamWeaverSummonStore(path);
  initial.enqueueReply({ schemaVersion: 1, tenantId: "tenant-a", deliveryId: "result-1", jobId: "job-result-1", displayName: "Athena", provider: "twitch", connectionId: "twitch-main", channelId: "home-channel", replyToMessageId: "provider-message-1", createdAt: at(0) });
  initial.close();
  const store = new SqliteStreamWeaverSummonStore(path);
  const reconciler = new StreamWeaverPersonaReplyReconciler(store, { getExecutionJob: async () => job() }, { send: async (message) => { if (failSend) throw new Error("Authorization: private-value"); sent.push(message); return { providerMessageId: "provider-result-1" }; } }, { now: () => new Date(now).toISOString(), retryDelayMs: 100 });
  try {
    assert.deepEqual(await reconciler.runOnce("tenant-a"), { observed: 1, waiting: 1, sent: 0, deferred: 0, rejected: 0 });
    state = "succeeded";
    now += 200;
    assert.deepEqual(await reconciler.runOnce("tenant-a"), { observed: 1, waiting: 0, sent: 0, deferred: 1, rejected: 0 });
    assert.match(store.getReply("result-1").lastError, /\[REDACTED\]/);
    failSend = false;
    now += 200;
    assert.deepEqual(await reconciler.runOnce("tenant-a"), { observed: 1, waiting: 0, sent: 1, deferred: 0, rejected: 0 });
    assert.equal(sent[0].text, "The durable stream reply is ready.");
    assert.equal(sent[0].idempotencyKey, "streamweaver-persona-result:result-1");
    assert.equal(sent[0].replyToMessageId, "provider-message-1");
    assert.equal(store.getReply("result-1").state, "sent");
    assert.equal((await reconciler.runOnce("tenant-a")).observed, 0, "completed replies do not send twice");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("reply reconciliation rejects foreign jobs and turns terminal failures into safe chat states", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-streamweaver-reply-guard-"));
  const store = new SqliteStreamWeaverSummonStore(join(dir, "streamweaver.db"));
  const sent = [];
  const base = { schemaVersion: 1, tenantId: "tenant-a", displayName: "Athena", provider: "discord", connectionId: "discord-main", channelId: "home-channel", createdAt: at(0) };
  store.enqueueReply({ ...base, deliveryId: "foreign-1", jobId: "job-foreign", replyToMessageId: "discord-in-1" });
  store.enqueueReply({ ...base, deliveryId: "failed-1", jobId: "job-failed", replyToMessageId: "discord-in-2" });
  store.enqueueReply({ ...base, tenantId: "tenant-b", deliveryId: "tenant-b-1", jobId: "job-tenant-b", replyToMessageId: "discord-in-3" });
  const jobs = {
    "job-foreign": { id: "job-foreign", tenantId: "tenant-a", ownerAppId: "stellar-core", capabilityId: "stellar-core.ai-chat.v1", requestedByType: "service", requestedById: "another-app", input: { callerAppId: "another-app" }, state: "succeeded", result: { kind: "stellar-chat-result.v1", text: "must not leak" } },
    "job-failed": { id: "job-failed", tenantId: "tenant-a", ownerAppId: "stellar-core", capabilityId: "stellar-core.ai-chat.v1", requestedByType: "service", requestedById: "streamweaver", input: { callerAppId: "streamweaver" }, state: "failed", error: { code: "provider-failure", message: "secret upstream detail", retryable: false } },
  };
  const reconciler = new StreamWeaverPersonaReplyReconciler(store, { getExecutionJob: async (_tenantId, jobId) => jobs[jobId] }, { send: async (message) => { sent.push(message); return { providerMessageId: `out-${sent.length}` }; } }, { now: () => at(1) });
  try {
    const report = await reconciler.runOnce("tenant-a");
    assert.deepEqual(report, { observed: 2, waiting: 0, sent: 1, deferred: 0, rejected: 1 });
    assert.equal(store.getReply("foreign-1").state, "failed");
    assert.equal(sent[0].text, "Athena could not complete that request.");
    assert.doesNotMatch(sent[0].text, /secret|provider-failure/);
    assert.equal(store.getReply("tenant-b-1").state, "pending", "a tenant-scoped pass cannot consume another tenant's reply");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("the public SPMT adapter preserves user, conversation, metering, and stable delivery identity", async () => {
  const calls = [];
  const runtime = new SpmtStreamWeaverPersonaRuntime({ invokeCommunityAssistant: async (...args) => { calls.push(args); return { status: "accepted", jobId: "job-adapter-1" }; } });
  const input = planStreamWeaverPersonaRoute(delivery("adapter-1", 0, "@athena status", { channelId: "home-channel" }), config).invocation;
  assert.deepEqual(await runtime.invoke(input), { status: "accepted", jobId: "job-adapter-1" });
  assert.equal(calls[0][0], "tenant-a");
  assert.deepEqual(calls[0][1], { userId: "viewer-1", message: "status", surface: "stream", conversationId: "chat:twitch:home-channel", routingPreference: "automatic", remember: true });
  assert.equal(calls[0][2], "streamweaver-persona:adapter-1");
});
