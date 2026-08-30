import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatGatewayRuntime, SqliteChatGatewayStore, chatGatewayCatalogRegistration } from "../apps/chat-gateway/dist/index.js";
import { createChatGatewayWorkerTokenProvider, parseChatGatewayConnections, validateChatGatewayWorkerEnvironment } from "../apps/chat-gateway/dist/service.js";
import { createSpmtCommlinkLiveChatConsumer } from "../packages/commlink-core/dist/index.js";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { SpmtApiError, SpmtClient } from "../packages/sdk/dist/index.js";

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    tenantId: "tenant-a",
    provider: "twitch",
    connectionId: "twitch-main",
    channelId: "spacechannel",
    messageId: "message-transport-1",
    text: "transport is live",
    occurredAt: "2026-08-29T12:00:00.000Z",
    providerUserId: "provider-user-1",
    canonicalUserId: "user-a",
    username: "viewer",
    displayName: "Viewer",
    isBot: false,
    roles: ["member"],
    mentions: [],
    ...overrides,
  };
}

test("Chat Gateway delivers durable normalized history through the authenticated Commlink API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-chat-transport-"));
  const authorityPath = join(directory, "authority.sqlite"), gatewayPath = join(directory, "gateway.sqlite"), credential = "chat-gateway-transport-credential-123456789";
  let service = createSpmtService({ databasePath: authorityPath, webhookKey: Buffer.alloc(32, 9), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.test", chatGatewayEnabled: true, chatGatewayCredential: credential });
  try {
    service.authority.ensureUser("user-a"); service.authority.ensureUser("user-b");
    service.control.registerTenant({ tenantId: "tenant-a", ownerUserId: "user-a", displayName: "Tenant A" });
    service.control.registerTenant({ tenantId: "tenant-b", ownerUserId: "user-b", displayName: "Tenant B" });
    service.control.registerApp(chatGatewayCatalogRegistration("https://commlink.spacemountain.live/?source=chat-gateway"));
    service.control.installApp("tenant-a", "chat-gateway");
    await service.listen();
    const address = service.server.address(); assert.ok(address && typeof address !== "string"); const baseUrl = `http://127.0.0.1:${address.port}`;
    const gatewayClient = new SpmtClient({ baseUrl, appId: "chat-gateway", getAccessToken: () => service.auth.issueServiceAccess("chat-gateway", credential).accessToken });
    const gatewayStore = new SqliteChatGatewayStore(gatewayPath);
    const gateway = new ChatGatewayRuntime(gatewayStore, [createSpmtCommlinkLiveChatConsumer(gatewayClient)]);
    const first = await gateway.ingest(envelope());
    const replay = await gateway.ingest(envelope({ text: "a replay cannot rewrite history" }));
    assert.deepEqual(first.delivery, { attempted: 1, delivered: 1, failed: 0 });
    assert.equal(replay.duplicate, true);
    const humanToken = service.auth.issueHumanSession({ userId: "user-a", scopes: ["commlink:read", "commlink:live:write"], tenantIds: ["tenant-a"] }).accessToken;
    const human = new SpmtClient({ baseUrl, appId: "spacemountain", getAccessToken: () => humanToken });
    const history = await human.listCommlinkLiveChat("tenant-a", { provider: "twitch", search: "transport" });
    assert.equal(history.length, 1); assert.equal(history[0].text, "transport is live"); assert.equal(history[0].canonicalUserId, "user-a");
    await assert.rejects(() => human.ingestCommlinkLiveChat("tenant-a", { ...first.message, messageId: "human-write" }), (error) => error instanceof SpmtApiError && error.status === 403);
    await assert.rejects(() => gatewayClient.ingestCommlinkLiveChat("tenant-b", { ...first.message, tenantId: "tenant-b", messageId: "uninstalled" }), (error) => error instanceof SpmtApiError && error.status === 403);
    await service.close();
    service = createSpmtService({ databasePath: authorityPath, webhookKey: Buffer.alloc(32, 9), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.test", chatGatewayEnabled: true, chatGatewayCredential: credential });
    assert.equal(service.commlinkLiveChat.list({ tenantId: "tenant-a" })[0].messageId, "message-transport-1");
    assert.equal(service.commlinkLiveChat.count("tenant-b"), 0);
    gatewayStore.close();
  } finally { await service.close().catch(() => undefined); rmSync(directory, { recursive: true, force: true }); }
});

test("Chat Gateway worker configuration is explicit, bounded, and sandbox fail-closed", async () => {
  const path = "/tmp/chat-gateway-sandbox.sqlite";
  const checked = validateChatGatewayWorkerEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", SPMT_ORIGIN: "http://127.0.0.1:3000", CHAT_GATEWAY_DATABASE_PATH: path, CHAT_GATEWAY_WORKER_CREDENTIAL: "x".repeat(32), CHAT_GATEWAY_CONNECTIONS: "[]" });
  assert.equal(checked.connections.length, 0); assert.equal(checked.runtimeMode, "sandbox");
  const live = JSON.stringify([{ schemaVersion: 1, tenantId: "tenant-a", provider: "twitch", connectionId: "main", channelId: "channel", providerAccountId: "account", desired: true }]);
  assert.equal(parseChatGatewayConnections(live)[0].provider, "twitch");
  assert.throws(() => validateChatGatewayWorkerEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", SPMT_ORIGIN: "http://127.0.0.1:3000", CHAT_GATEWAY_DATABASE_PATH: path, CHAT_GATEWAY_WORKER_CREDENTIAL: "x".repeat(32), CHAT_GATEWAY_CONNECTIONS: live }), /rejects live provider connections/);
  assert.throws(() => validateChatGatewayWorkerEnvironment({ SPMT_ORIGIN: "https://spmt.example", CHAT_GATEWAY_DATABASE_PATH: "/tmp/chat.sqlite", CHAT_GATEWAY_WORKER_CREDENTIAL: "x".repeat(32) }), /loopback/);
  let calls = 0;
  const token = createChatGatewayWorkerTokenProvider({ spmtOrigin: "http://127.0.0.1:3000", credential: "x".repeat(32), fetchImpl: async (_url, init) => { calls += 1; assert.doesNotMatch(String(init.body), /twitch|discord|kick/); return new Response(JSON.stringify({ accessToken: "internal-access", accessExpiresAt: new Date(Date.now() + 300_000).toISOString() }), { status: 200, headers: { "content-type": "application/json" } }); } });
  assert.equal(await token(), "internal-access"); assert.equal(await token(), "internal-access"); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(chatGatewayCatalogRegistration("https://commlink.spacemountain.live/?source=chat-gateway")), /chat-tag/i);
});
