import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NebulaArcadeProviderRuntime,
  SqliteNebulaNetwork,
  SqliteNebulaGameActionStore,
  SqliteNebulaGameRuntimeStore,
  SqliteNebulaTagStore,
  validateNebulaArcadeProviderConfig,
  validateNebulaArcadeProviderEnvironment,
  SqliteNebulaMosaicStore, claimNextMosaicRequest, installMosaicQueueTemplate, MOSAIC_CELL_COUNT,
} from "../apps/nebula-arcade/dist/index.js";
import { SupervisedChatGatewayService, validateChatGatewayWorkerEnvironment, createNebulaArcadeChatReplyEgress } from "../apps/chat-gateway/dist/service.js";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";

const at = (minute) => new Date(Date.UTC(2026, 7, 29, 12, minute)).toISOString();
test("read-only live ingress sends only Nebula chat replies through the active provider adapter", async () => {
  const sent = [], shadowed = [];
  const egress = createNebulaArcadeChatReplyEgress({
    operationMode: "read-only",
    liveIngressEnabled: true,
    senders: [{ provider: "twitch", send: async (message) => { sent.push(message); return { providerMessageId: "twitch-reply" }; } }],
    shadowSend: async (message) => { shadowed.push(message); return { providerMessageId: "shadow-reply" }; },
  });
  const message = { schemaVersion: 1, tenantId: "tenant-a", provider: "twitch", connectionId: "tw-main", channelId: "channel-a", text: "Nebula reply", idempotencyKey: "nebula-reply-test" };
  const result = await egress.send(message);
  assert.equal(result.providerMessageId, "twitch-reply");
  assert.deepEqual(sent, [message]);
  assert.equal(shadowed.length, 0);
});

test("active production Nebula replies use the connected Twitch provider", async () => {
  const sent = [], shadowed = [];
  const egress = createNebulaArcadeChatReplyEgress({
    operationMode: "active",
    liveIngressEnabled: false,
    senders: [{ provider: "twitch", send: async (message) => { sent.push(message); return { providerMessageId: "twitch-production-reply" }; } }],
    shadowSend: async (message) => { shadowed.push(message); return { providerMessageId: "shadow-reply" }; },
  });
  const message = { schemaVersion: 1, tenantId: "tenant-a", provider: "twitch", connectionId: "apollo-shared-spacemountain-bot", channelId: "mtman1987", text: "Nebula reply", idempotencyKey: "nebula-production-reply-test" };
  const result = await egress.send(message);
  assert.equal(result.providerMessageId, "twitch-production-reply");
  assert.deepEqual(sent, [message]);
  assert.equal(shadowed.length, 0);
});

test("Nebula reply egress stays shadowed outside read-only live ingress", async () => {
  const sent = [], shadowed = [];
  const egress = createNebulaArcadeChatReplyEgress({
    operationMode: "read-only",
    liveIngressEnabled: false,
    senders: [{ provider: "twitch", send: async (message) => { sent.push(message); return { providerMessageId: "twitch-reply" }; } }],
    shadowSend: async (message) => { shadowed.push(message); return { providerMessageId: "shadow-reply" }; },
  });
  const message = { schemaVersion: 1, tenantId: "tenant-a", provider: "twitch", connectionId: "tw-main", channelId: "channel-a", text: "Nebula reply", idempotencyKey: "nebula-reply-test" };
  const result = await egress.send(message);
  assert.equal(result.providerMessageId, "shadow-reply");
  assert.equal(sent.length, 0);
  assert.deepEqual(shadowed, [message]);
});

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
function withRuntime(work, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "nebula-provider-"));
  const databasePath = join(directory, "nebula.sqlite");
  const sent = [];
  const simulationEvents = [];
  const client = { publishEvent: async () => ({}), awardXp: async () => ({}), publishSimulationRoomEvent: async (tenantId, input, idempotencyKey) => { simulationEvents.push({ tenantId, input, idempotencyKey }); return {}; } };
  const runtime = new NebulaArcadeProviderRuntime({ databasePath, config: validateNebulaArcadeProviderConfig(options.config ?? config), client, simulation: options.simulation === true, egress: { send: async (item) => { sent.push(item); return { providerMessageId: `out-${sent.length}` }; } } });
  return Promise.resolve(work({ runtime, databasePath, sent, simulationEvents })).finally(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
}

test("Nebula provider config is strict, provider-neutral, and contains no credentials", () => {
  assert.deepEqual(validateNebulaArcadeProviderConfig(config), config);
  assert.throws(() => validateNebulaArcadeProviderConfig({ ...config, accessToken: "secret" }), /invalid fields/);
  assert.throws(() => validateNebulaArcadeProviderConfig({ ...config, tenants: [...config.tenants, config.tenants[0]] }), /duplicate tenant/);
});

test("Nebula Tag keeps recovered Twitch provider IDs even when chat identity is canonically linked", async () => {
  const ownerlessConfig = structuredClone(config);
  delete ownerlessConfig.tenants[0].pinUserId;
  const normalized = validateNebulaArcadeProviderConfig(ownerlessConfig);
  assert.equal(normalized.tenants[0].pinUserId, undefined);
  await withRuntime(async ({ runtime, databasePath, sent }) => {
    const first = message("chatter-one", "spmt join", { actor: { ...message("seed", "x").actor, providerUserId: "123456", canonicalUserId: "spmt-101", username: "first", displayName: "First" } });
    const second = message("chatter-two", "spmt join", { actor: { ...message("seed", "x").actor, providerUserId: "789012", canonicalUserId: "spmt-202", username: "second", displayName: "Second" } });
    await runtime.consumers[0].deliver({ ...delivery("chatter-one", "spmt join"), message: first });
    await runtime.consumers[0].deliver({ ...delivery("chatter-two", "spmt join"), message: second });
    await runtime.consumers[0].deliver({ ...delivery("chatter-one-activity", "ordinary chat"), message: { ...first, messageId: "chatter-one-activity", text: "ordinary chat", occurredAt: at(1) } });
    assert.equal(sent.length, 2);
    runtime.close();
    const tag = new SqliteNebulaTagStore(databasePath);
    const players = tag.getState("tenant-a").state.players;
    assert.ok(players["provider:twitch:123456"]);
    assert.ok(players["provider:twitch:789012"]);
    assert.equal(players["provider:twitch:123456"].lastActiveAt, at(1));
    assert.equal(players["spmt-101"], undefined);
    tag.close();
  }, { config: ownerlessConfig });
});

test("Nebula registers OAuth-discovered provider connections after empty-registry startup", async () => {
  const emptyConfig = { schemaVersion: 1, revision: "empty", tenants: [] };
  await withRuntime(async ({ runtime, sent }) => {
    const consumer = runtime.consumers[0];
    assert.equal(consumer.accepts(message("before-oauth", "spmt join")), false);
    runtime.registerProviderConnection({ tenantId: "tenant-a", provider: "twitch", connectionId: "tw-main", channelId: "provider-channel", desired: true });
    assert.equal(consumer.accepts(message("after-oauth", "spmt join")), true);
    await consumer.deliver(delivery("after-oauth", "spmt join"));
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /joined/i);
    runtime.registerProviderConnection({ tenantId: "tenant-a", provider: "twitch", connectionId: "tw-main", channelId: "provider-channel", desired: false });
    assert.equal(consumer.accepts(message("after-disconnect", "spmt join")), false);
  }, { config: emptyConfig });
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
  assert.ok(tag.getState("tenant-a").state.players["provider:twitch:provider-1"]);
  tag.close();
}));

test("generic game commands are durable, replay-safe, and use app-private Games Points state", async () => withRuntime(async ({ runtime, databasePath, sent }) => {
  const consumer = runtime.consumers[0];
  const first = delivery("card", "spmt card");
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
  assert.equal(state.processedCommandIds.filter(id => id.startsWith("provider:")).length, 1);
  assert.equal(state.processedCommandIds.filter(id => id.startsWith("activity:")).length, 1);
  assert.equal(actions.list("tenant-a").length, 1);
  games.close(); actions.close();
}));

test("Nebula game command results publish to the selected provider room without replacing chat egress", async () => withRuntime(async ({ runtime, sent, simulationEvents }) => {
  await runtime.consumers[0].deliver(delivery("card-preview", "spmt card"));
  assert.equal(sent.length, 1);
  assert.equal(simulationEvents.length, 1);
  assert.equal(simulationEvents[0].tenantId, "tenant-a");
  assert.equal(simulationEvents[0].input.roomId, "twitch:tw-main:provider-channel");
  assert.equal(simulationEvents[0].input.lane, "game");
  assert.match(simulationEvents[0].input.body, /Bingo accepted join/);
}, { simulation: true }));

test("ambiguous commands ask the user instead of mutating two games while safe team colors broadcast", async () => withRuntime(async ({ runtime, databasePath, sent }) => {
  const consumer = runtime.consumers[0];
  await consumer.deliver(delivery("status", "spmt status"));
  assert.match(sent.at(-1).text, /More than one active game/);
  const actionsBefore = (() => { const store = new SqliteNebulaGameActionStore(databasePath); const count = store.list("tenant-a").length; store.close(); return count; })();
  assert.equal(actionsBefore, 0);
  await consumer.deliver(delivery("red", "spmt red"));
  const actions = new SqliteNebulaGameActionStore(databasePath);
  assert.deepEqual(actions.list("tenant-a").map((item) => item.gameId).sort(), ["chatwars", "colorwars"]);
  actions.close();
}));

test("spmt pack opens Quackverse on configured Twitch channels even when legacy config omitted the game flag", async () => {
  const legacyConfig = structuredClone(config);
  legacyConfig.tenants[0].channels[0].enabledGameIds = legacyConfig.tenants[0].channels[0].enabledGameIds.filter((id) => id !== "quackverse");
  const normalized = validateNebulaArcadeProviderConfig(legacyConfig);
  assert.ok(normalized.tenants[0].channels[0].enabledGameIds.includes("quackverse"));
  await withRuntime(async ({ runtime, sent }) => {
    await runtime.consumers[0].deliver(delivery("spmt-pack", "spmt pack"));
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /pack|duck|Quackverse/i);
  }, { config: legacyConfig });
});

test("Quackverse deck commands read the real collection and moderator controls remain enforced", async () => withRuntime(async ({ runtime, databasePath, sent }) => {
  const consumer = runtime.consumers[0];
  await consumer.deliver(delivery("deck", "spmt deck"));
  assert.match(sent.at(-1).text, /Deck \(0\/20\): empty/);
  await consumer.deliver(delivery("start", "spmt quackverse start"));
  assert.match(sent.at(-1).text, /Only the broadcaster or a moderator/);
  const actions = new SqliteNebulaGameActionStore(databasePath);
  assert.equal(actions.list("tenant-a").length, 0);
  actions.close();
}));

test("reconcile reports Tag rotation as fail-closed until canonical presence is fresh", async () => withRuntime(async ({ runtime }) => {
  const report = await runtime.reconcile();
  assert.deepEqual(report.rotation, { status: "presence-required", reason: "Automatic Tag rotation is fenced until a fresh canonical presence snapshot is available." });
}));

test("disabled Nebula ignores the shared SPMT public origin and does not crash Chat Gateway", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-disabled-"));
  try {
    const environment = validateChatGatewayWorkerEnvironment({
      SPMT_RUNTIME_MODE: "production",
      SPMT_ORIGIN: "https://spmt.example.test",
      SPMT_PUBLIC_ORIGIN: "https://apollo.example.test",
      CHAT_GATEWAY_DATABASE_PATH: join(directory, "chat-gateway.sqlite"),
      CHAT_GATEWAY_WORKER_CREDENTIAL: "chat-gateway-service-credential-123456",
      CHAT_GATEWAY_CONNECTIONS: "[]",
      STREAMWEAVER_PROVIDER_RUNTIME_ENABLED: "1",
      STREAMWEAVER_DATABASE_PATH: join(directory, "streamweaver.sqlite"),
      STREAMWEAVER_WORKER_CREDENTIAL: "streamweaver-service-credential-123456"
    });
    assert.equal(environment.nebulaArcade, undefined);
    assert.ok(environment.streamweaver);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

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

test("SPMT gives Nebula app events, XP, runtime and job scopes without provider grants", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-identity-"));
  const credential = "nebula-arcade-service-credential-123456";
  const service = createSpmtService({ databasePath: join(directory, "authority.sqlite"), webhookKey: Buffer.alloc(32, 12), port: 0, runtimeMode: "sandbox", nebulaArcadeProviderRuntimeEnabled: true, nebulaArcadeWorkerCredential: credential });
  await service.listen();
  try {
    const token = service.auth.issueServiceAccess("nebula-arcade", credential).accessToken;
    for (const scope of ["events:write", "xp:write", "runtime:write", "jobs:read", "jobs:write"]) assert.equal(service.auth.authorize(token, scope, "tenant-a").actorId, "nebula-arcade");
    assert.throws(() => service.auth.authorize(token, "providers:grant", "tenant-a"), /scope/i);
    assert.throws(() => service.auth.authorize(token, "commlink:live:write", "tenant-a"), /scope/i);
  } finally { await service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("Nebula provider routes PixelBattle Mosaic chat commands into durable channel state", async () => {
  const activeConfig = structuredClone(config);
  activeConfig.tenants[0].channels[0].enabledGameIds.push("pixelbattle");
  await withRuntime(async ({ runtime, databasePath, sent }) => {
    await runtime.consumers[0].deliver(delivery("mosaic-request", "!mosaic green garden"));
    assert.match(sent[0].text, /queued at position 1/);
    assert.match(sent[0].text, /runner is not configured/);

    const store = new SqliteNebulaMosaicStore(databasePath);
    store.update("tenant-a", "apollo", (state) => {
      const request = claimNextMosaicRequest(state, Date.parse(at(1)));
      assert.ok(request);
      installMosaicQueueTemplate(state, request.id, Array(MOSAIC_CELL_COUNT).fill("G"), { provider: "test" }, Date.parse(at(2)));
    }, Date.parse(at(2)));
    store.close();

    await runtime.consumers[0].deliver(delivery("mosaic-paint", "!mosaic paint A1 green"));
    assert.match(sent.at(-1).text, /1 cell\(s\) painted/);
    const recovered = new SqliteNebulaMosaicStore(databasePath);
    assert.equal(recovered.get("tenant-a", "apollo").current?.painted[0], "G");
    recovered.close();
  }, { config: activeConfig });
});


test("explicit Twitch leave blacklists the player and a later spmt join clears that blacklist", async () => {
  await withRuntime(async ({ runtime, databasePath, sent }) => {
    const actor = { ...message("seed", "x").actor, providerUserId: "123456", username: "first", displayName: "First" };
    const join = message("join-1", "spmt join", { actor });
    await runtime.consumers[0].deliver({ ...delivery("join-1", "spmt join"), message: join });
    const leave = { ...join, messageId: "leave-1", text: "spmt leave", occurredAt: at(1) };
    await runtime.consumers[0].deliver({ ...delivery("leave-1", "spmt leave"), message: leave });

    runtime.close();
    const network = new SqliteNebulaNetwork(databasePath);
    assert.equal(network.blocked("tenant-a", "provider:twitch:123456", "first"), true);
    network.close();

    const reopened = new NebulaArcadeProviderRuntime({
      databasePath,
      config: validateNebulaArcadeProviderConfig(config),
      client: { publishEvent: async () => ({}), awardXp: async () => ({}), publishSimulationRoomEvent: async () => ({}) },
      simulation: false,
      egress: { send: async (item) => { sent.push(item); return { providerMessageId: "rejoin-reply" }; } },
    });
    const rejoin = { ...join, messageId: "join-2", text: "spmt join", occurredAt: at(2) };
    await reopened.consumers[0].deliver({ ...delivery("join-2", "spmt join"), message: rejoin });
    await reopened.close();
    const after = new SqliteNebulaNetwork(databasePath);
    assert.equal(after.blocked("tenant-a", "provider:twitch:123456", "first"), false);
    after.close();
  });
});
