import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dshMillisecondsUntilNextPeriod, SupervisedDshLiveService, validateDshLiveWorkerEnvironment } from "../apps/discord-stream-hub/dist/index.js";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";

const observedAt = "2026-08-29T12:00:00.000Z";
const credential = "discord-stream-hub-service-credential-123456789";

function liveConfig() {
  return {
    schemaVersion: 1,
    pollIntervalSeconds: 600,
    tenants: [{
      tenantId: "tenant-a",
      twitchProviderUserId: "twitch-monitor",
      discordProviderUserId: "discord-bot",
      branding: { communityMemberName: "Crew", spotlightChannelId: "33333", onboardingCustomId: "spmt:onboard" },
      members: [{ canonicalUserId: "user-a", discordUserId: "11111", twitchLogin: "captain", group: "Crew", shoutoutChannelId: "22222" }],
    }],
  };
}

function writeConfig(dir, name, value) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

test("DSH worker config separates public routing from secrets and fails closed in sandbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "apollo-dsh-worker-env-"));
  try {
    const emptyPath = writeConfig(dir, "dsh-runtime-sandbox.json", { schemaVersion: 1, pollIntervalSeconds: 600, tenants: [] });
    const base = { SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", SPMT_ORIGIN: "http://127.0.0.1:3000", DSH_DATABASE_PATH: join(dir, "dsh-sandbox.sqlite"), DSH_RUNTIME_CONFIG_PATH: emptyPath, DSH_WORKER_CREDENTIAL: credential };
    const checked = validateDshLiveWorkerEnvironment(base);
    assert.equal(checked.config.tenants.length, 0);
    assert.equal(checked.config.pollIntervalSeconds, 600);
    assert.equal(dshMillisecondsUntilNextPeriod("2026-08-29T12:09:00.000Z", 600), 60_000);
    assert.equal(dshMillisecondsUntilNextPeriod("2026-08-29T12:10:00.000Z", 600), 600_000);
    const livePath = writeConfig(dir, "dsh-live-sandbox.json", liveConfig());
    assert.throws(() => validateDshLiveWorkerEnvironment({ ...base, DSH_RUNTIME_CONFIG_PATH: livePath }), /rejects live provider tenants/);
    const secretPath = writeConfig(dir, "dsh-secret-sandbox.json", { schemaVersion: 1, pollIntervalSeconds: 600, tenants: [], discordBotToken: "must-not-live-here" });
    assert.throws(() => validateDshLiveWorkerEnvironment({ ...base, DSH_RUNTIME_CONFIG_PATH: secretPath }), /unsupported fields/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SPMT grants the DSH worker only provider-grant and runtime-report authority", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apollo-dsh-worker-auth-"));
  const service = createSpmtService({ databasePath: join(dir, "authority.sqlite"), webhookKey: Buffer.alloc(32, 8), port: 0, runtimeMode: "sandbox", dshLiveRuntimeEnabled: true, dshWorkerCredential: credential });
  await service.listen();
  try {
    const token = service.auth.issueServiceAccess("discord-stream-hub", credential).accessToken;
    for (const scope of ["providers:grant", "runtime:write"]) assert.equal(service.auth.authorize(token, scope, "tenant-a").actorId, "discord-stream-hub");
    for (const scope of ["identity:write", "xp:write", "commlink:live:write"]) assert.throws(() => service.auth.authorize(token, scope, "tenant-a"), /scope/i);
    assert.throws(() => service.auth.issueServiceAccess("discord-stream-hub", "wrong-credential-with-enough-characters-123"), /credential/i);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("the supervised DSH cycle authenticates, polls Twitch, publishes Discord, and replays safely after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apollo-dsh-worker-live-"));
  const configPath = writeConfig(dir, "dsh-runtime.json", liveConfig());
  const databasePath = join(dir, "dsh.sqlite");
  const calls = [];
  let discordId = 90000;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input), method = init.method ?? "GET";
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/v1/auth/service-token")) return Response.json({ accessToken: `dsh-access-${"x".repeat(32)}`, accessExpiresAt: "2099-01-01T00:00:00.000Z" });
    if (url.endsWith("/v1/provider-grants")) {
      const request = JSON.parse(String(init.body));
      const twitch = request.provider === "twitch";
      return Response.json({ schemaVersion: 1, grantId: `grant-${request.provider}-${calls.length}`, tenantId: "tenant-a", requesterAppId: "discord-stream-hub", provider: request.provider, providerUserId: request.providerUserId, capabilityId: request.capabilityId, grantedScopes: request.requiredScopes, credential: { accessToken: twitch ? "ephemeral-twitch-token" : "ephemeral-discord-token", metadata: twitch ? { clientId: "public-twitch-client" } : { authorizationScheme: "Bot" } }, issuedAt: observedAt, expiresAt: "2099-01-01T00:00:00.000Z" }, { status: 201 });
    }
    if (url.startsWith("https://api.twitch.tv/helix/streams")) return Response.json({ data: [{ id: "stream-a", user_login: "captain", user_name: "Captain", title: "Space Night", game_name: "Space Game", viewer_count: 42, thumbnail_url: "https://example.com/{width}x{height}.jpg", started_at: observedAt }] });
    if (url.startsWith("https://discord.com/api/v10/")) return method === "POST" ? Response.json({ id: String(discordId++) }) : new Response(undefined, { status: 204 });
    if (url.endsWith("/v1/runtime/state")) return Response.json({ schemaVersion: 1, appId: "discord-stream-hub", state: "ready" });
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  const environment = validateDshLiveWorkerEnvironment({ SPMT_RUNTIME_MODE: "production", SPMT_ORIGIN: "http://127.0.0.1:3000", DSH_DATABASE_PATH: databasePath, DSH_RUNTIME_CONFIG_PATH: configPath, DSH_WORKER_CREDENTIAL: credential, DSH_WORKER_ID: "dsh-test" });
  let service = new SupervisedDshLiveService(environment, fetchImpl, () => observedAt);
  try {
    assert.deepEqual(await service.ready(), { schemaVersion: 1, workerId: "dsh-test", configuredTenants: 1, pollIntervalSeconds: 600 });
    const first = await service.runOnce();
    assert.equal(first.results[0].status, "completed");
    assert.equal(first.results[0].liveCount, 1);
    assert.equal(first.results[0].delivered, 2);
    const grants = calls.filter((call) => call.url.endsWith("/v1/provider-grants"));
    assert.deepEqual(grants.map((call) => call.body.capabilityId), ["dsh-live-monitor", "dsh-discord-live", "dsh-discord-live", "dsh-discord-live"]);
    assert.equal(grants.every((call) => call.headers.get("x-spmt-app") === "discord-stream-hub" && call.headers.get("authorization")?.startsWith("Bearer dsh-access-")), true);
    const twitch = calls.find((call) => call.url.startsWith("https://api.twitch.tv/helix/streams"));
    assert.equal(twitch.headers.get("client-id"), "public-twitch-client");
    assert.equal(twitch.headers.get("authorization"), "Bearer ephemeral-twitch-token");
    const discord = calls.filter((call) => call.url.startsWith("https://discord.com/api/v10/"));
    assert.equal(discord.length, 3);
    assert.equal(discord.every((call) => call.headers.get("authorization") === "Bot ephemeral-discord-token"), true);
    await service.close();

    const providerMutations = calls.filter((call) => call.url.startsWith("https://discord.com/api/v10/")).length;
    service = new SupervisedDshLiveService(environment, fetchImpl, () => observedAt);
    await service.ready();
    const replay = await service.runOnce();
    assert.equal(replay.results[0].status, "completed");
    assert.equal(replay.results[0].delivered, 0);
    assert.equal(calls.filter((call) => call.url.startsWith("https://discord.com/api/v10/")).length, providerMutations);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("graceful shutdown waits for the active Discord mutation before closing durable state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apollo-dsh-worker-shutdown-"));
  const configPath = writeConfig(dir, "dsh-runtime.json", liveConfig());
  let releaseDiscord;
  let announceDiscord;
  const discordStarted = new Promise((resolve) => { announceDiscord = resolve; });
  const discordReleased = new Promise((resolve) => { releaseDiscord = resolve; });
  const fetchImpl = async (input, init = {}) => {
    const url = String(input), method = init.method ?? "GET";
    if (url.endsWith("/v1/auth/service-token")) return Response.json({ accessToken: `dsh-access-${"x".repeat(32)}`, accessExpiresAt: "2099-01-01T00:00:00.000Z" });
    if (url.endsWith("/v1/provider-grants")) {
      const request = JSON.parse(String(init.body)), twitch = request.provider === "twitch";
      return Response.json({ schemaVersion: 1, grantId: `grant-${request.provider}`, tenantId: "tenant-a", requesterAppId: "discord-stream-hub", provider: request.provider, providerUserId: request.providerUserId, capabilityId: request.capabilityId, grantedScopes: request.requiredScopes, credential: { accessToken: twitch ? "ephemeral-twitch-token" : "ephemeral-discord-token", metadata: twitch ? { clientId: "public-twitch-client" } : { authorizationScheme: "Bot" } }, issuedAt: observedAt, expiresAt: "2099-01-01T00:00:00.000Z" }, { status: 201 });
    }
    if (url.startsWith("https://api.twitch.tv/helix/streams")) return Response.json({ data: [{ id: "stream-a", user_login: "captain", user_name: "Captain", title: "Space Night", game_name: "Space Game", viewer_count: 42, thumbnail_url: "https://example.com/{width}x{height}.jpg", started_at: observedAt }] });
    if (url.startsWith("https://discord.com/api/v10/") && method === "POST") { announceDiscord(); await discordReleased; return Response.json({ id: "90001" }); }
    if (url.startsWith("https://discord.com/api/v10/")) return new Response(undefined, { status: 204 });
    if (url.endsWith("/v1/runtime/state")) return Response.json({ schemaVersion: 1, appId: "discord-stream-hub", state: "ready" });
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  const environment = validateDshLiveWorkerEnvironment({ SPMT_RUNTIME_MODE: "production", SPMT_ORIGIN: "http://127.0.0.1:3000", DSH_DATABASE_PATH: join(dir, "dsh.sqlite"), DSH_RUNTIME_CONFIG_PATH: configPath, DSH_WORKER_CREDENTIAL: credential });
  const service = new SupervisedDshLiveService(environment, fetchImpl, () => observedAt);
  try {
    await service.ready();
    const cycle = service.runOnce();
    await discordStarted;
    let closed = false;
    const closing = service.close().then(() => { closed = true; });
    await assert.rejects(() => service.runOnce(), /worker is closed/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, false);
    releaseDiscord();
    assert.equal((await cycle).results[0].status, "completed");
    await closing;
    assert.equal(closed, true);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("shutdown closes both SQLite stores even when the captured active cycle rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apollo-dsh-worker-close-failure-"));
  const configPath = writeConfig(dir, "dsh-runtime.json", { schemaVersion: 1, pollIntervalSeconds: 600, tenants: [] });
  const environment = validateDshLiveWorkerEnvironment({ SPMT_RUNTIME_MODE: "production", SPMT_ORIGIN: "http://127.0.0.1:3000", DSH_DATABASE_PATH: join(dir, "dsh.sqlite"), DSH_RUNTIME_CONFIG_PATH: configPath, DSH_WORKER_CREDENTIAL: credential });
  const service = new SupervisedDshLiveService(environment, async () => Response.json({ accessToken: `dsh-access-${"x".repeat(32)}`, accessExpiresAt: "2099-01-01T00:00:00.000Z" }), () => observedAt);
  try {
    const rejected = Promise.reject(new Error("forced active cycle failure"));
    rejected.catch(() => undefined);
    service.activeCycle = rejected;
    await assert.rejects(service.close(), /forced active cycle failure/);
    assert.throws(() => service.monitor.getLiveMembers("tenant-a"), /closed|database/i);
    assert.throws(() => service.messages.get("tenant-a", "spotlight", "current"), /closed|database/i);
    await assert.rejects(() => service.runOnce(), /worker is closed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
