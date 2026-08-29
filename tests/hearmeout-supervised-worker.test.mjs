import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HearMeOutExecutionWorker, HearMeOutWorkerMediaCache, HearMeOutWorkerMusicCatalog, validateHearMeOutWorkerEnvironment } from "../apps/hearmeout/dist/index.js";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";

function job(id, capabilityId, input) { return { schemaVersion: 1, id, tenantId: "tenant-a", ownerAppId: "hearmeout", capabilityId, executionOwner: "hearmeout", requestedByType: "user", requestedById: "user-a", billedUserId: "user-a", meteredResource: "hosted-worker-minutes", usageQuantity: 1, executionTarget: "fly", meteringTarget: "hosted", idempotencyKey: `idem-${id}`, input, state: "running", attempt: 1, maxAttempts: 3, fencingEpoch: 4, leaseId: `lease-${id}`, leaseOwner: "hmo-worker", leaseExpiresAt: "2026-08-29T01:00:00.000Z", createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" }; }

test("HearMeOut supervised worker validates a zero-tenant sandbox and rejects production egress", () => {
  const dir = mkdtempSync(join(tmpdir(), "hearmeout-supervised-sandbox-"));
  const configPath = join(dir, "hearmeout-config-sandbox.json");
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, revision: "test", pollMs: 1000, capabilities: ["hearmeout.music.search"], tenants: [] }));
  const base = { SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", SPMT_ORIGIN: "http://127.0.0.1:3000", HEARMEOUT_DATABASE_PATH: join(dir, "hearmeout-sandbox.sqlite"), HEARMEOUT_CACHE_DIR: join(dir, "cache-sandbox"), HEARMEOUT_RUNTIME_CONFIG_PATH: configPath, HEARMEOUT_WORKER_CREDENTIAL: "hearmeout-service-credential-123456789" };
  assert.equal(validateHearMeOutWorkerEnvironment(base).config.tenants.length, 0);
  assert.throws(() => validateHearMeOutWorkerEnvironment({ ...base, SPMT_OUTBOUND_MODE: "enabled" }), /disabled/);
  assert.throws(() => validateHearMeOutWorkerEnvironment({ ...base, HEARMEOUT_YT_DLP_BINARY: "/usr/bin/yt-dlp" }), /rejects external media/);
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, revision: "test", pollMs: 1000, capabilities: ["hearmeout.music.search"], tenants: [{ tenantId: "live-a" }] }));
  assert.throws(() => validateHearMeOutWorkerEnvironment(base), /rejects live tenants/);
  rmSync(dir, { recursive: true, force: true });
});

test("HearMeOut job worker executes durable catalog search and remember operations with fenced completion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hearmeout-worker-jobs-")); mkdirSync(join(dir, "cache"));
  const queue = [job("remember", "hearmeout.music.remember", { userId: "user-a", videoId: "abcdefghijk", url: "https://youtube.com/watch?v=abcdefghijk", title: "Donor Song", artist: "Apollo" }), job("search", "hearmeout.music.search", { query: "donor", limit: 5 })];
  const completed = [], failed = [], heartbeats = [];
  const client = { async claimAnyExecutionJob() { return queue.shift() ?? null; }, async heartbeatExecutionJob(...args) { heartbeats.push(args); }, async succeedExecutionJob(...args) { completed.push(args); }, async failExecutionJob(...args) { failed.push(args); }, async reportExecutionWorker() {} };
  const worker = new HearMeOutExecutionWorker(client, { workerId: "hmo-worker", executionTarget: "fly", capabilities: ["hearmeout.music.search", "hearmeout.music.remember"], catalog: new HearMeOutWorkerMusicCatalog({ catalogFile: join(dir, "catalog.json") }), cache: new HearMeOutWorkerMediaCache({ cacheDir: join(dir, "cache") }) });
  assert.equal(await worker.runOnce(), "remember");
  assert.equal(await worker.runOnce(), "search");
  assert.equal(completed.length, 2); assert.equal(failed.length, 0); assert.equal(heartbeats.length, 2);
  assert.equal(completed[1][5].items[0].title, "Donor Song");
  assert.deepEqual(completed.map((entry) => entry.slice(0, 5)), [["tenant-a", "remember", "hmo-worker", "lease-remember", 4], ["tenant-a", "search", "hmo-worker", "lease-search", 4]]);
  rmSync(dir, { recursive: true, force: true });
});

test("SPMT gives HearMeOut its own minimal worker identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hearmeout-service-identity-"));
  const credential = "hearmeout-service-credential-123456789";
  const service = createSpmtService({ databasePath: join(dir, "authority.sqlite"), webhookKey: Buffer.alloc(32, 17), port: 0, runtimeMode: "sandbox", hearMeOutRuntimeEnabled: true, hearMeOutWorkerCredential: credential });
  await service.listen();
  try {
    const token = service.auth.issueServiceAccess("hearmeout", credential).accessToken;
    for (const scope of ["providers:grant", "jobs:read", "jobs:work", "runtime:write"]) assert.equal(service.auth.authorize(token, scope, "tenant-a").actorId, "hearmeout");
    assert.throws(() => service.auth.authorize(token, "xp:write", "tenant-a"), /scope/i);
    assert.throws(() => service.auth.authorize(token, "identity:write", "tenant-a"), /scope/i);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});
