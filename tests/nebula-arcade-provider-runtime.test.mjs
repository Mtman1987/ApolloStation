import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NebulaArcadeProviderRuntime,
  SqliteNebulaGameActionStore,
  SqliteNebulaGameRuntimeStore,
  SqliteNebulaTagStore,
  validateNebulaArcadeProviderConfig,
  validateNebulaArcadeProviderEnvironment,
} from "../apps/nebula-arcade/dist/index.js";
import { SupervisedChatGatewayService, validateChatGatewayWorkerEnvironment } from "../apps/chat-gateway/dist/service.js";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";

const at = (minute) => new Date(Date.UTC(2026, 7, 29, 12, minute)).toISOString();
const config = {
  schemaVersion: 1,
  revision: "test-1",
  tenants: [{ tenantId: "tenant-a", pinUserId: "user-pin", channels: [{ provider: "twitch", connectionId: "tw-main", channelId: "provider-channel", stateChannelId: "apollo", enabledGameIds: ["tag", "quackverse", "bingo", "chatwars", "chickenroyale", "colorwars"] }] }],
};
const message = (id, text, extra = {}) => ({
  schemaVersion: 1,
  tenantId: "tenant-a",
  provider: "twitch",
  connectionId: "tw-main",
  channelId: "provider-channel",
  messageId: id,
  text,
  occurredAt: at(0),
  actor: { providerUserId: "provider-1", canonicalUserId: "user-1", username: "alpha", displayName: "Alpha", roles: ["member"], isBot: false },
  mentions: [],
  ...extra,
});

function delivery(id, text, extra) { return { schemaVersion: 1, deliveryId: `delivery-${id}`, consumerId: "nebula.arcade.provider-ingress", message: message(id, text, extra), attempt: 1 }; }
function withRuntime(work) {
  const directory = mkdtempSync(join(tmpdir(), "nebula-provider-"));
  const databasePath = join(directory, "nebula.sqlite");
  const sent = [];
  const client = { publishEvent: async () => ({}), awardXp: async () => ({}) };
  const runtime = new NebulaArcadeProviderRuntime({ databasePath, config: validateNebulaArcadeProviderConfig(config), client, egress: { send: async (item) => { sent.push(item); return { providerMessageId: `out-${sent.length}` }; } } });
  return Promise.resolve(work({ runtime, databasePath, sent })).finally(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
}

test("Nebula provider config is strict, provider-neutral, and contains no credentials", () => {
  assert.deepEqual(validateNebulaArcadeProviderConfig(config), config);
  assert.throws(() => validateNebulaArcadeProviderConfig({ ...config, accessToken: "secret" }), /invalid fields/);
  assert.throws(() => validateNebulaArcadeProviderConfig({ ...config, tenants: [...config.tenants, config.tenants[0]] }), /duplicate tenant/);
});

test("sandbox Nebula runtime rejects live tenants and requires sandbox-named storage", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-sandbox-"));
  const configPath = join(directory, "nebula-runtime-sandbox.json");
  writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => validateNebulaArcadeProviderEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", NEBULA_ARCADE_DATABASE_PATH: join(directory, "nebula-sandbox.sqlite"), NEBULA_ARCADE_RUNTIME_CONFIG_PATH: configPath, NEBULA_ARCADE_WORKER_CREDENTIAL: "x".repeat(32) }), /rejects live provider tenants/);
  rmSync(directory, { recursive: true, force: true });
});

test("Nebula consumes only configured channels and restores Tag commands without a direct provider socket", async () => withRuntime(async ({ runtime, databasePath, sent }) => {
  const consumer = runtime.consumers[0];
  assert.equal(consumer.accepts(message("join", "spmt join")), true);
  assert.equal(consumer.accepts(message("wrong", "spmt join", { connectionId: "other" })), false);
  await consumer.deliver(delivery("join", "spmt join"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /joined/i);
  assert.match(sent[0].idempotencyKey, /^nebula-arcade-reply:/);
  runtime.close();
  const tag = new SqliteNebulaTagStore(databasePath);
  assert.ok(tag.getState("tenant-a").state.players["user-1"]);
  tag.close();
}));

test("generic game commands are durable, replay-safe, and use app-private Games Points state", async () => withRuntime(async ({ runtime, databasePath, sent }) => {
  const consumer = runtime.consumers[0];
  const first = delivery("card", "!card");
  await consumer.deliver(first);
  await consumer.deliver({ ...first, attempt: 2 });
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /Bingo accepted join/);
  assert.match(sent[1].text, /already accepted/);
  runtime.close();
  const games = new SqliteNebulaGameRuntimeStore(databasePath);
  const actions = new SqliteNebulaGameActionStore(databasePath);
  const state = games.get("tenant-a");
  assert.equal(state.players["spmt:user-1"].joinedGames.bingo.plays, 1);
  assert.equal(state.processedCommandIds.length, 1);
  assert.equal(actions.list("tenant-a").length, 1);
  games.close(); actions.close();
}));

test("ambiguous commands ask the user instead of mutating two games while safe team colors broadcast", async () => withRuntime(async ({ runtime, databasePath, sent }) => {
  const consumer = runtime.consumers[0];
  await consumer.deliver(delivery("status", "!status"));
  assert.match(sent.at(-1).text, /More than one active game/);
  const actionsBefore = (() => { const store = new SqliteNebulaGameActionStore(databasePath); const count = store.list("tenant-a").length; store.close(); return count; })();
  assert.equal(actionsBefore, 0);
  await consumer.deliver(delivery("red", "!red"));
  const actions = new SqliteNebulaGameActionStore(databasePath);
  assert.deepEqual(actions.list("tenant-a").map((item) => item.gameId).sort(), ["chatwars", "colorwars"]);
  actions.close();
}));

test("unported specialized actions and moderator controls return truthful chat states", async () => withRuntime(async ({ runtime, databasePath, sent }) => {
  const consumer = runtime.consumers[0];
  await consumer.deliver(delivery("deck", "!deck"));
  assert.match(sent.at(-1).text, /not connected yet/);
  await consumer.deliver(delivery("start", "!start"));
  assert.match(sent.at(-1).text, /Only the broadcaster or a moderator/);
  const actions = new SqliteNebulaGameActionStore(databasePath);
  assert.equal(actions.list("tenant-a").length, 0);
  actions.close();
}));

test("reconcile reports Tag rotation as fail-closed until canonical presence is fresh", async () => withRuntime(async ({ runtime }) => {
  const report = await runtime.reconcile();
  assert.deepEqual(report.rotation, { status: "presence-required", reason: "Automatic Tag rotation is fenced until a fresh canonical presence snapshot is available." });
}));

test("supervised Chat Gateway authenticates Nebula separately and starts zero-tenant sandbox composition", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-supervised-"));
  const configPath = join(directory, "nebula-runtime-sandbox.json");
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, revision: "sandbox", tenants: [] }));
  const environment = validateChatGatewayWorkerEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", SPMT_ORIGIN: "http://127.0.0.1:3000", CHAT_GATEWAY_DATABASE_PATH: join(directory, "chat-gateway-sandbox.sqlite"), CHAT_GATEWAY_WORKER_CREDENTIAL: "chat-gateway-service-credential-123456", CHAT_GATEWAY_CONNECTIONS: "[]", NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED: "1", NEBULA_ARCADE_WORKER_CREDENTIAL: "nebula-arcade-service-credential-123456", NEBULA_ARCADE_DATABASE_PATH: join(directory, "nebula-provider-sandbox.sqlite"), NEBULA_ARCADE_RUNTIME_CONFIG_PATH: configPath });
  const authenticated = [];
  const service = new SupervisedChatGatewayService(environment, async (_url, init) => { const body = JSON.parse(String(init?.body)); authenticated.push(body.serviceId); return Response.json({ accessToken: `${body.serviceId}-${"x".repeat(32)}`, accessExpiresAt: "2099-01-01T00:00:00.000Z" }); });
  try {
    const ready = await service.ready();
    assert.deepEqual(authenticated.sort(), ["chat-gateway", "nebula-arcade"]);
    assert.ok(ready.consumers.includes("nebula.arcade.provider-ingress"));
    const report = await service.reconcile();
    assert.equal(report.nebulaArcade.configuredTenants, 0);
    assert.equal(report.nebulaArcade.rotation.status, "presence-required");
  } finally { await service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("SPMT gives Nebula only events, XP, and runtime scopes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-identity-"));
  const credential = "nebula-arcade-service-credential-123456";
  const service = createSpmtService({ databasePath: join(directory, "authority.sqlite"), webhookKey: Buffer.alloc(32, 12), port: 0, runtimeMode: "sandbox", nebulaArcadeProviderRuntimeEnabled: true, nebulaArcadeWorkerCredential: credential });
  await service.listen();
  try {
    const token = service.auth.issueServiceAccess("nebula-arcade", credential).accessToken;
    for (const scope of ["events:write", "xp:write", "runtime:write"]) assert.equal(service.auth.authorize(token, scope, "tenant-a").actorId, "nebula-arcade");
    assert.throws(() => service.auth.authorize(token, "providers:grant", "tenant-a"), /scope/i);
    assert.throws(() => service.auth.authorize(token, "commlink:live:write", "tenant-a"), /scope/i);
  } finally { await service.close(); rmSync(directory, { recursive: true, force: true }); }
});
