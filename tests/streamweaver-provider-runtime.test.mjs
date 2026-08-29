import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatGatewayRuntime, SqliteChatGatewayStore } from "../apps/chat-gateway/dist/index.js";
import { SupervisedChatGatewayService, validateChatGatewayWorkerEnvironment } from "../apps/chat-gateway/dist/service.js";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { StreamWeaverPersonaSettingsStore, StreamWeaverProviderRuntime } from "../apps/streamweaver/dist/index.js";

const iso = (seconds = 0) => new Date(Date.parse("2026-08-29T08:00:00.000Z") + seconds * 1_000).toISOString();

function configurePersona(path, tenantId, displayName, ownerCanonicalUserId) {
  const settings = new StreamWeaverPersonaSettingsStore(path, () => iso());
  try {
    settings.patch(tenantId, { schemaVersion: 1, expectedRevision: 0, values: { personaId: `persona-${tenantId}`, displayName, aliases: displayName.toLowerCase(), ownerCanonicalUserId, homeChannelIds: "home", summonWindowMinutes: 10, instructions: `Present as ${displayName}.`, memoryPolicy: "conversation" } });
  } finally { settings.close(); }
}

function envelope({ tenantId = "tenant-a", messageId, text, isBot = false, roles = ["member"] }) {
  return { schemaVersion: 1, tenantId, provider: "discord", connectionId: "discord-main", channelId: "home", messageId, text, occurredAt: iso(), providerUserId: "discord-owner", canonicalUserId: "owner-a", username: "owner", displayName: "Owner", isBot, roles, mentions: [] };
}

test("supervised Chat Gateway validates and authenticates the separate StreamWeaver runtime", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-streamweaver-provider-service-"));
  const base = { SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", SPMT_ORIGIN: "http://127.0.0.1:3000", CHAT_GATEWAY_DATABASE_PATH: join(dir, "chat-gateway-sandbox.sqlite"), CHAT_GATEWAY_WORKER_CREDENTIAL: "chat-gateway-service-credential-123456789", CHAT_GATEWAY_CONNECTIONS: "[]", STREAMWEAVER_PROVIDER_RUNTIME_ENABLED: "1", STREAMWEAVER_WORKER_CREDENTIAL: "streamweaver-service-credential-123456789", STREAMWEAVER_DATABASE_PATH: join(dir, "streamweaver-sandbox.sqlite") };
  assert.throws(() => validateChatGatewayWorkerEnvironment({ ...base, STREAMWEAVER_WORKER_CREDENTIAL: "short" }), /32\+ character STREAMWEAVER/);
  assert.throws(() => validateChatGatewayWorkerEnvironment({ ...base, STREAMWEAVER_DATABASE_PATH: join(dir, "streamweaver.sqlite") }), /sandbox-named/);
  const environment = validateChatGatewayWorkerEnvironment(base);
  const authenticated = [];
  const service = new SupervisedChatGatewayService(environment, async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")); authenticated.push(body.serviceId);
    return new Response(JSON.stringify({ accessToken: `${body.serviceId}-access-token-${"x".repeat(32)}`, accessExpiresAt: "2099-01-01T00:00:00.000Z" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const ready = await service.ready();
    assert.deepEqual(authenticated.sort(), ["chat-gateway", "streamweaver"]);
    assert.deepEqual(ready.consumers, ["commlink-live-chat", "streamweaver.donor-commands", "streamweaver.economy", "streamweaver.persona"]);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("SPMT grants the supervised StreamWeaver identity only its required runtime scopes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-streamweaver-service-identity-"));
  const credential = "streamweaver-service-credential-123456789";
  const service = createSpmtService({ databasePath: join(dir, "authority.sqlite"), webhookKey: Buffer.alloc(32, 7), port: 0, runtimeMode: "sandbox", streamweaverProviderRuntimeEnabled: true, streamweaverWorkerCredential: credential });
  await service.listen();
  try {
    const token = service.auth.issueServiceAccess("streamweaver", credential).accessToken;
    for (const scope of ["identity:read", "identity:write", "assistants:invoke", "jobs:read", "xp:write", "runtime:write"]) assert.equal(service.auth.authorize(token, scope, "tenant-a").actorId, "streamweaver");
    assert.throws(() => service.auth.authorize(token, "providers:grant", "tenant-a"), /scope/i);
    assert.throws(() => service.auth.issueServiceAccess("streamweaver", "wrong-credential-with-enough-characters-123"), /credential/i);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("StreamWeaver commands and persona results traverse one restart-safe provider route", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-streamweaver-provider-runtime-"));
  const streamweaverPath = join(dir, "streamweaver.sqlite"), gatewayPath = join(dir, "gateway.sqlite");
  configurePersona(streamweaverPath, "tenant-a", "Athena", "owner-a");
  const jobStates = new Map();
  const invocations = [];
  const client = {
    async invokeCommunityAssistant(tenantId, input, idempotencyKey) { const jobId = `job-${idempotencyKey}`; invocations.push({ tenantId, input, idempotencyKey, jobId }); jobStates.set(jobId, "running"); return { status: "accepted", jobId }; },
    async getExecutionJob(tenantId, jobId) { const state = jobStates.get(jobId) ?? "running"; return { schemaVersion: 1, id: jobId, tenantId, ownerAppId: "stellar-core", capabilityId: "stellar-core.ai-chat.v1", requestedByType: "service", requestedById: "streamweaver", billedUserId: "owner-a", input: { callerAppId: "streamweaver" }, executionOwner: "stellar-core", executionTarget: "sprite", meteringTarget: "hosted", meteredResource: "ai-chat-requests", meteredQuantity: 1, state, attempt: 1, maxAttempts: 3, fencingEpoch: 1, createdAt: iso(), updatedAt: iso(), ...(state === "succeeded" ? { result: { kind: "stellar-chat-result.v1", text: "A durable answer." } } : {}) }; },
    async request() { throw new Error("canonical provider lookup was not expected for linked fixtures"); },
    async awardXp() { throw new Error("SPMT exchange was not expected"); },
  };
  const sent = [];
  let clockMs = Date.parse(iso());
  let gateway;
  const openRuntime = () => new StreamWeaverProviderRuntime({ databasePath: streamweaverPath, client, egress: { send: (message) => gateway.send(message) }, now: () => new Date(clockMs).toISOString(), nowMs: () => clockMs, retryDelayMs: 100 });
  let runtime = openRuntime();
  let gatewayStore = new SqliteChatGatewayStore(gatewayPath);
  gateway = new ChatGatewayRuntime(gatewayStore, runtime.consumers, [{ provider: "discord", async send(message) { sent.push(structuredClone(message)); return { providerMessageId: `discord-out-${sent.length}` }; } }]);
  try {
    const accepted = await gateway.ingest(envelope({ messageId: "persona-1", text: "Athena, are you there?" }));
    assert.equal(accepted.delivery.delivered, 1);
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].input.presentation.displayName, "Athena");
    assert.equal((await runtime.reconcile()).waiting, 1);
    runtime.close();

    runtime = openRuntime();
    gateway = new ChatGatewayRuntime(gatewayStore, runtime.consumers, [{ provider: "discord", async send(message) { sent.push(structuredClone(message)); return { providerMessageId: `discord-out-${sent.length}` }; } }]);
    jobStates.set(invocations[0].jobId, "succeeded");
    clockMs += 1_000;
    assert.equal((await runtime.reconcile()).sent, 1);
    assert.equal((await runtime.reconcile()).sent, 0);
    assert.equal(sent[0].text, "A durable answer.");
    assert.equal(sent[0].replyToMessageId, "persona-1");
    assert.equal(sent[0].idempotencyKey, "streamweaver-persona-result:tenant-a:discord:discord-main:persona-1:streamweaver.persona");

    await gateway.ingest(envelope({ messageId: "command-1", text: "!coinflip" }));
    assert.match(sent[1].text, /^@Owner flipped (heads|tails)\.$/);
    const duplicate = await gateway.ingest(envelope({ messageId: "command-1", text: "!coinflip" }));
    assert.equal(duplicate.duplicate, true);
    assert.equal(sent.length, 2);

    await gateway.ingest(envelope({ messageId: "currency-1", text: "!currencyname Star Bits", roles: ["broadcaster", "member"] }));
    await gateway.ingest(envelope({ messageId: "currency-2", text: "!points" }));
    assert.match(sent.at(-2).text, /currency is now Star Bits/);
    assert.match(sent.at(-1).text, /0 Star Bits/);
    const bot = await gateway.ingest(envelope({ messageId: "bot-1", text: "Athena hello", isBot: true }));
    assert.equal(bot.delivery.attempted, 0);
  } finally { runtime.close(); gatewayStore.close(); rmSync(dir, { recursive: true, force: true }); }
});
