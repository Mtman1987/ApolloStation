import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { STELLAR_CHAT_CAPABILITY_ID, STELLAR_CHAT_METADATA_KIND, StellarDataPrivacyService, stellarCoreCatalogRegistration } from "../apps/stellar-core/dist/index.js";
import { assertBillingManifestV1 } from "../packages/contracts/dist/index.js";
import { ExecutionJobError, ExecutionJobService, MemoryExecutionJobStore } from "../packages/execution-core/dist/index.js";
import { MemoryUsageLedgerStore, MonetizationService } from "../packages/monetization/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

const billingManifest = () => assertBillingManifestV1(JSON.parse(readFileSync(new URL("../config/billing-plans.v1.json", import.meta.url), "utf8")));
const metrics = { completedJobs: 0, failedJobs: 0, inputUnits: 0, outputUnits: 0 };

test("worker readiness expires closed and never survives a missed heartbeat", () => {
  let now = "2026-08-28T12:00:00.000Z";
  const usage = new MonetizationService(billingManifest(), new MemoryUsageLedgerStore(), () => now);
  const jobs = new ExecutionJobService({ store: new MemoryExecutionJobStore(), usage, resolvePlan: () => "free", now: () => now });
  jobs.reportWorker({ executionOwner: "stellar-core", workerId: "hosted-1", executionTarget: "sprite", state: "ready", capabilityIds: [STELLAR_CHAT_CAPABILITY_ID], providerHealthy: true, startedAt: now, leaseMs: 5_000, metrics });
  assert.equal(jobs.hasReadyWorker({ executionOwner: "stellar-core", executionTarget: "sprite", capabilityId: STELLAR_CHAT_CAPABILITY_ID }), true);
  now = "2026-08-28T12:00:05.000Z";
  assert.equal(jobs.hasReadyWorker({ executionOwner: "stellar-core", executionTarget: "sprite", capabilityId: STELLAR_CHAT_CAPABILITY_ID }), false);
  assert.equal(jobs.listWorkers({ executionOwner: "stellar-core" }).length, 0);
});

test("a new supervised cohort rotates the durable Stellar worker credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-stellar-rotation-"));
  const databasePath = join(directory, "stellar.sqlite");
  const firstCredential = "stellar-worker-first-credential-123456789";
  const nextCredential = "stellar-worker-next-credential-1234567890";
  let service = createSpmtService({ databasePath, webhookKey: Buffer.alloc(32, 8), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.test", stellarChatEnabled: true, stellarWorkerCredential: firstCredential });
  try {
    await service.listen();
    assert.ok(service.auth.issueServiceAccess("stellar-core", firstCredential).accessToken);
    await service.close();
    service = createSpmtService({ databasePath, webhookKey: Buffer.alloc(32, 8), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.test", stellarChatEnabled: true, stellarWorkerCredential: nextCredential });
    await service.listen();
    assert.ok(service.auth.issueServiceAccess("stellar-core", nextCredential).accessToken);
    assert.throws(() => service.auth.issueServiceAccess("stellar-core", firstCredential), /Invalid service credential/);
  } finally {
    await service.close().catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Stellar privacy minimizes raw content, exports only the caller, and deletes only the caller", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-stellar-privacy-"));
  const service = createSpmtService({ databasePath: join(directory, "stellar.sqlite"), webhookKey: Buffer.alloc(32, 6), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.test" });
  try {
    service.control.registerApp(stellarCoreCatalogRegistration("https://spmt.test"));
    for (const [userId, username] of [["user-one", "privacy-one"], ["user-two", "privacy-two"]]) { service.authority.ensureUser(userId); service.data.registerUser({ userId, username, displayName: username, password: "privacy-password-123", tenantIds: ["tenant-privacy"] }); }
    service.control.registerTenant({ tenantId: "tenant-privacy", ownerUserId: "user-one", displayName: "Privacy Tenant" });
    service.authority.getOrCreateWorkspace("tenant-privacy");
    service.control.installApp("tenant-privacy", "stellar-core");
    service.data.upsertStellarContext({ tenantId: "tenant-privacy", userId: "user-one", sourceAppId: "stellar-core", kind: "preference", text: "private context one", tags: [] });
    service.data.upsertStellarContext({ tenantId: "tenant-privacy", userId: "user-two", sourceAppId: "stellar-core", kind: "preference", text: "private context two", tags: [] });
    const remembered = terminalJob(service, "user-one", "remembered", true, "2026-08-20T12:00:00.000Z");
    const ephemeral = terminalJob(service, "user-one", "ephemeral", false, "2026-08-28T10:00:00.000Z");
    const expired = terminalJob(service, "user-one", "expired", true, "2026-07-20T12:00:00.000Z");
    const other = terminalJob(service, "user-two", "other", true, "2026-08-28T11:00:00.000Z");
    const privacy = new StellarDataPrivacyService(service.executionJobs, service.data, { now: () => "2026-08-28T12:00:00.000Z" });
    assert.deepEqual(privacy.sweep(["tenant-privacy"]), { schemaVersion: 1, minimized: 2, deleted: 1, sweptAt: "2026-08-28T12:00:00.000Z" });
    for (const jobId of [remembered, ephemeral]) { const job = service.executionJobs.get("tenant-privacy", jobId); assert.equal(job.input.kind, STELLAR_CHAT_METADATA_KIND); assert.equal(job.input.contentMinimized, true); assert.doesNotMatch(JSON.stringify(job), /secret prompt|secret answer/); }
    assert.throws(() => service.executionJobs.get("tenant-privacy", expired), (error) => error instanceof ExecutionJobError && error.code === "not_found");
    await service.listen();
    const tokenOne = service.auth.issueHumanSession({ userId: "user-one", scopes: ["stellar:data:read", "stellar:data:write"], tenantIds: ["tenant-privacy"] }).accessToken;
    const exported = service.operations.execute({ name: "stellar.data.export-me", input: { tenantId: "tenant-privacy", userId: "user-two" } }, { accessToken: tokenOne }).result;
    assert.equal(exported.userId, "user-one");
    assert.equal(exported.jobs.every((job) => job.billedUserId === "user-one"), true);
    assert.equal(exported.context.every((item) => item.userId === "user-one"), true);
    service.operations.execute({ name: "stellar.data.delete-me", input: { tenantId: "tenant-privacy", userId: "user-two" } }, { accessToken: tokenOne });
    assert.equal(service.executionJobs.list("tenant-privacy", { billedUserId: "user-one" }).length, 0);
    assert.equal(service.data.listPersonalStellarContext("tenant-privacy", "user-one").length, 0);
    assert.equal(service.executionJobs.get("tenant-privacy", other).billedUserId, "user-two");
    assert.equal(service.data.listPersonalStellarContext("tenant-privacy", "user-two")[0].text, "private context two");
  } finally { await service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("the real Stella route reaches Free-plan warning and hard-stop boundaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-stellar-cap-")), credential = "stellar-worker-quota-credential-123456789";
  const service = createSpmtService({ databasePath: join(directory, "stellar.sqlite"), webhookKey: Buffer.alloc(32, 7), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.test", stellarChatEnabled: true, stellarWorkerCredential: credential });
  try {
    service.control.registerApp(stellarCoreCatalogRegistration("https://spmt.test"));
    await service.listen();
    const address = service.server.address(); assert.ok(address && typeof address !== "string"); const baseUrl = `http://127.0.0.1:${address.port}`;
    const registration = await fetch(`${baseUrl}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "quota-user", displayName: "Quota User", password: "quota-password-123" }) }).then((response) => response.json());
    service.control.installApp(registration.tenantId, "stellar-core");
    const session = await fetch(`${baseUrl}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "quota-user", password: "quota-password-123" }) }).then((response) => response.json());
    const user = new SpmtClient({ baseUrl, appId: "spacemountain", getAccessToken: () => session.tokens.accessToken });
    const worker = new SpmtClient({ baseUrl, appId: "stellar-core", getAccessToken: () => service.auth.issueServiceAccess("stellar-core", credential).accessToken });
    await worker.reportExecutionWorker({ executionOwner: "stellar-core", workerId: "quota-worker", executionTarget: "sprite", state: "ready", capabilityIds: [STELLAR_CHAT_CAPABILITY_ID], providerHealthy: true, startedAt: new Date().toISOString(), metrics });
    for (let index = 1; index <= 25; index += 1) { const accepted = await user.invokeCommunityAssistant(registration.tenantId, { message: `Quota prompt ${index}`, surface: "app", remember: false }, `quota-${index}`); assert.equal(accepted.status, "accepted"); }
    const resource = (await user.getPersonalUsage(registration.tenantId)).resources.find((item) => item.resource === "ai-chat-requests");
    assert.equal(resource.hosted, 25); assert.equal(resource.percent, 100); assert.equal(resource.warning, 100);
    await assert.rejects(user.invokeCommunityAssistant(registration.tenantId, { message: "Quota prompt 26", surface: "app", remember: false }, "quota-26"), (error) => error?.status === 409 && /allowance reached/.test(error.responseBody));
  } finally { await service.close(); rmSync(directory, { recursive: true, force: true }); }
});

function terminalJob(service, userId, key, remember, completedAt) {
  const created = service.executionJobs.create({ tenantId: "tenant-privacy", ownerAppId: "stellar-core", capabilityId: STELLAR_CHAT_CAPABILITY_ID, executionOwner: "stellar-core", requestedByType: "user", requestedById: userId, billedUserId: userId, meteredResource: "ai-chat-requests", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", idempotencyKey: key, input: { kind: "stellar-chat-request.v1", message: `secret prompt ${key}`, userId, surface: "app", routingPreference: "automatic", remember } }).job;
  const claimed = service.executionJobs.claim({ tenantId: "tenant-privacy", executionOwner: "stellar-core", workerId: "privacy-worker", executionTarget: "sprite" });
  const finished = service.executionJobs.succeed({ tenantId: "tenant-privacy", jobId: claimed.id, workerId: "privacy-worker", leaseId: claimed.leaseId, fencingEpoch: claimed.fencingEpoch, result: { kind: "stellar-chat-result.v1", text: `secret answer ${key}`, usage: { inputUnits: 2, outputUnits: 3 } } });
  service.platformStore.putExecutionJob({ ...finished, completedAt, updatedAt: completedAt });
  return created.id;
}
