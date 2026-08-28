import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertBillingManifestV1, assertCapabilityWiringManifestV1 } from "../packages/contracts/dist/index.js";
import { MemoryUsageLedgerStore, MonetizationService } from "../packages/monetization/dist/index.js";
import { ExecutionJobError, ExecutionJobService, MemoryExecutionJobStore } from "../packages/execution-core/dist/index.js";
import { MemoryProviderCredentialSource, ProviderGrantBroker, ProviderGrantError } from "../packages/provider-grants-core/dist/index.js";
import { AesGcmAppSettingsSecretCodec, AppFoundationError, AppSettingsService, SqliteAppPrivateDatabase, appPrivateMigrationChecksum } from "../packages/app-foundation/dist/index.js";

const at = "2026-08-28T12:00:00.000Z";
const billingManifest = () => assertBillingManifestV1(JSON.parse(readFileSync(new URL("../config/billing-plans.v1.json", import.meta.url), "utf8")));

test("capability wiring manifest covers every first-party owner and makes cutover state explicit", () => {
  const manifest = assertCapabilityWiringManifestV1(JSON.parse(readFileSync(new URL("../config/capability-wiring.v1.json", import.meta.url), "utf8")));
  const owners = new Set(manifest.capabilities.map((item) => item.ownerAppId));
  for (const appId of ["spmt", "spacemountain", "commlink", "chat-gateway", "stellar-core", "mission-control", "nebula-arcade", "discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion", "reference-app"]) assert.equal(owners.has(appId), true, `${appId} missing from capability wiring`);
  assert.equal(manifest.capabilities.every((item) => item.routeMode && item.state && item.contract && item.evidence.length), true);
  assert.equal(manifest.capabilities.some((item) => item.routeMode === "shadow"), true);
  assert.equal(manifest.capabilities.some((item) => item.executionTargets.includes("companion")), true);
});

test("execution jobs meter once, reject embedded secrets, fence workers, and expose truthful progress", () => {
  const usage = new MonetizationService(billingManifest(), new MemoryUsageLedgerStore(), () => at);
  const transitions = [];
  const jobs = new ExecutionJobService({ store: new MemoryExecutionJobStore(), usage, resolvePlan: () => "creator", now: () => at, idFactory: () => "job_ai_1", onTransition: (job, previous) => transitions.push([previous, job.state]) });
  const input = { tenantId: "tenant-a", ownerAppId: "stellar-core", capabilityId: "stellar.chat", executionOwner: "stellar-core", requestedByType: "user", requestedById: "user-a", billedUserId: "user-a", meteredResource: "ai-chat-requests", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", idempotencyKey: "chat-1", input: { message: "Help me plan a stream" }, correlationId: "corr-1" };
  const created = jobs.create(input);
  assert.equal(created.duplicate, false);
  assert.equal(created.job.state, "queued");
  assert.equal(usage.summary("tenant-a", "user-a", "creator", at).resources.find((item) => item.resource === "ai-chat-requests").hosted, 1);
  assert.equal(jobs.create(input).duplicate, true);
  assert.equal(usage.summary("tenant-a", "user-a", "creator", at).resources.find((item) => item.resource === "ai-chat-requests").hosted, 1);
  assert.throws(() => jobs.create({ ...input, idempotencyKey: "unsafe", input: { accessToken: "never-store-me" } }), (error) => error instanceof ExecutionJobError && error.code === "invalid");
  assert.equal(jobs.claim({ tenantId: "tenant-a", executionOwner: "stellar-core", workerId: "worker-a", executionTarget: "fly" }), undefined);
  const claimed = jobs.claim({ tenantId: "tenant-a", executionOwner: "stellar-core", workerId: "worker-a", executionTarget: "sprite" });
  assert.equal(claimed.state, "leased");
  const running = jobs.heartbeat({ tenantId: "tenant-a", jobId: claimed.id, workerId: "worker-a", leaseId: claimed.leaseId, fencingEpoch: claimed.fencingEpoch, progress: { percent: 35, message: "Reading context" } });
  assert.equal(running.state, "running");
  assert.equal(running.progress.percent, 35);
  assert.throws(() => jobs.heartbeat({ tenantId: "tenant-a", jobId: claimed.id, workerId: "worker-b", leaseId: claimed.leaseId, fencingEpoch: claimed.fencingEpoch }), (error) => error instanceof ExecutionJobError && error.code === "lease_lost");
  const completed = jobs.succeed({ tenantId: "tenant-a", jobId: claimed.id, workerId: "worker-a", leaseId: claimed.leaseId, fencingEpoch: claimed.fencingEpoch, result: { answerRef: "message-1" } });
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.progress.percent, 100);
  assert.equal("leaseId" in completed, false);
  assert.deepEqual(transitions.map((entry) => entry[1]), ["queued", "leased", "running", "succeeded"]);
});

test("paid Companion-local jobs remain unmetered against hosted caps while still appearing in Account usage", () => {
  const usage = new MonetizationService(billingManifest(), new MemoryUsageLedgerStore(), () => at);
  const jobs = new ExecutionJobService({ store: new MemoryExecutionJobStore(), usage, resolvePlan: () => "pro", now: () => at, idFactory: () => "job_local_1" });
  jobs.create({ tenantId: "tenant-a", ownerAppId: "companion", capabilityId: "companion.local-render", executionOwner: "companion", requestedByType: "user", requestedById: "user-a", billedUserId: "user-a", meteredResource: "hosted-worker-minutes", usageQuantity: 10000, executionTarget: "companion", meteringTarget: "companion", idempotencyKey: "local-render-1", input: { projectRef: "project-1" } });
  const resource = usage.summary("tenant-a", "user-a", "pro", at).resources.find((item) => item.resource === "hosted-worker-minutes");
  assert.equal(resource.hosted, 0);
  assert.equal(resource.companion, 10000);
  assert.equal(resource.percent, 0);
});

test("app-private settings persist across restart, isolate subjects, encrypt secrets, and reject rewritten migrations", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-app-foundation-")), path = join(dir, "streamweaver.sqlite"), migrationSource = "CREATE TABLE tenant_personas(id TEXT PRIMARY KEY) STRICT";
  const migration = { version: 1, name: "tenant-personas", checksum: appPrivateMigrationChecksum(migrationSource), up(database) { database.exec(migrationSource); } };
  const manifest = { schemaVersion: 1, appId: "streamweaver", dataset: "tenant-config", classification: "private-authority", owner: "streamweaver", retention: "until tenant deletion", maximumBytes: 64 * 1024 * 1024, recovery: "checkpoint, backup, restore, then integrity check" };
  const definition = { schemaVersion: 1, appId: "streamweaver", settingsVersion: 2, subject: "user", fields: [
    { key: "commands.enabled", label: "Commands", description: "Enable tenant chat commands.", type: "boolean", sensitive: false, defaultValue: true },
    { key: "response.mode", label: "Response mode", description: "Select concise or detailed responses.", type: "enum", sensitive: false, defaultValue: "concise", options: [{ value: "concise", label: "Concise" }, { value: "detailed", label: "Detailed" }] },
    { key: "response.maximum", label: "Maximum length", description: "Maximum response characters.", type: "number", sensitive: false, defaultValue: 500, minimum: 100, maximum: 2000 },
    { key: "provider.key", label: "Provider key", description: "Optional app-owned provider secret.", type: "string", sensitive: true }
  ] };
  try {
    let database = new SqliteAppPrivateDatabase(path, manifest, [migration], () => at);
    const settings = new AppSettingsService(definition, database, new AesGcmAppSettingsSecretCodec(Buffer.alloc(32, 7)), () => at);
    assert.equal(settings.read("tenant-a", "user-a").values["commands.enabled"], true);
    const changed = settings.patch("tenant-a", "user-a", { schemaVersion: 1, expectedRevision: 0, values: { "response.mode": "detailed", "response.maximum": 800 }, secrets: { "provider.key": "secret-provider-value" } });
    assert.equal(changed.revision, 1);
    assert.deepEqual(changed.configuredSecretKeys, ["provider.key"]);
    assert.doesNotMatch(JSON.stringify(changed), /secret-provider-value/);
    assert.equal(settings.readSecrets("tenant-a", "user-a")["provider.key"], "secret-provider-value");
    assert.equal(settings.read("tenant-a", "user-b").revision, 0);
    assert.throws(() => settings.patch("tenant-a", "user-a", { schemaVersion: 1, expectedRevision: 0, values: { "commands.enabled": false } }), (error) => error instanceof AppFoundationError && error.code === "conflict");
    assert.equal(database.checkpoint().integrity, true);
    database.close();
    database = new SqliteAppPrivateDatabase(path, manifest, [migration], () => at);
    const restored = new AppSettingsService(definition, database, new AesGcmAppSettingsSecretCodec(Buffer.alloc(32, 7)), () => at);
    assert.equal(restored.read("tenant-a", "user-a").values["response.mode"], "detailed");
    assert.equal(restored.readSecrets("tenant-a", "user-a")["provider.key"], "secret-provider-value");
    database.close();
    assert.throws(() => new SqliteAppPrivateDatabase(path, manifest, [{ ...migration, checksum: "0".repeat(64) }], () => at), (error) => error instanceof AppFoundationError && error.code === "conflict");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("provider grants are short-lived, capability-scoped, audited without credentials, and denied across apps", async () => {
  const source = new MemoryProviderCredentialSource(), receipts = [];
  source.put("tenant-a", { provider: "twitch", providerUserId: "twitch-1", accessToken: "provider-access-token", metadata: { clientId: "client-1", broadcasterId: "twitch-1" }, scopes: ["chat:read", "chat:write"], expiresAt: "2026-08-28T13:00:00.000Z", allowedAppIds: ["chat-gateway"], allowedCapabilities: ["provider-chat"] });
  const broker = new ProviderGrantBroker(source, { record: (receipt) => receipts.push(receipt) }, { now: () => at, idFactory: () => "pgrant_1", maximumTtlSeconds: 300 });
  const grant = await broker.issue({ schemaVersion: 1, tenantId: "tenant-a", requesterAppId: "chat-gateway", provider: "twitch", providerUserId: "twitch-1", capabilityId: "provider-chat", requiredScopes: ["chat:read"], ttlSeconds: 120 });
  assert.equal(grant.credential.accessToken, "provider-access-token");
  assert.equal(grant.expiresAt, "2026-08-28T12:02:00.000Z");
  assert.equal("credential" in receipts[0], false);
  assert.doesNotMatch(JSON.stringify(receipts), /provider-access-token/);
  await assert.rejects(() => broker.issue({ schemaVersion: 1, tenantId: "tenant-a", requesterAppId: "streamweaver", provider: "twitch", providerUserId: "twitch-1", capabilityId: "provider-chat", requiredScopes: ["chat:read"] }), (error) => error instanceof ProviderGrantError && error.code === "denied");
  await assert.rejects(() => broker.issue({ schemaVersion: 1, tenantId: "tenant-a", requesterAppId: "chat-gateway", provider: "twitch", providerUserId: "twitch-1", capabilityId: "provider-chat", requiredScopes: ["moderation:write"] }), (error) => error instanceof ProviderGrantError && error.code === "denied");
});
