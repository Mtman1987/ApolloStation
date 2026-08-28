import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { ControlService } from "../packages/control-core/dist/index.js";
import { assertBillingManifestV1 } from "../packages/contracts/dist/index.js";
import { ExecutionJobService } from "../packages/execution-core/dist/index.js";
import { MonetizationService } from "../packages/monetization/dist/index.js";
import { PlatformDataService } from "../packages/platform-data-core/dist/index.js";
import { SqlitePlatformDataStore } from "../packages/platform-data-sqlite/dist/index.js";
import { PlatformOperations } from "../packages/platform-ops/dist/index.js";
import { PlatformApiAdapter } from "../packages/api-adapter/dist/index.js";
import { SpmtApiError, SpmtClient } from "../packages/sdk/dist/index.js";
import { runSpmtCli } from "../packages/cli/dist/index.js";
import { SPMT_MCP_PROTOCOL_VERSION, SpmtMcpServer } from "../packages/mcp/dist/index.js";

const at = "2026-08-28T12:00:00.000Z";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-functional-api-")), databasePath = join(dir, "foundation.sqlite");
  const store = new SqliteAuthorityStore(databasePath), platformStore = new SqlitePlatformDataStore(databasePath);
  const authority = new AuthorityService({ store, now: () => at }), auth = new AuthService({ store, now: () => at }), control = new ControlService({ store, now: () => at });
  const data = new PlatformDataService({ store: platformStore, auth, webhookKey: Buffer.alloc(32, 9), now: () => at });
  for (const userId of ["user-a", "user-b"]) authority.ensureUser(userId);
  control.registerTenant({ tenantId: "tenant-a", ownerUserId: "user-a", displayName: "Tenant A" });
  for (const appId of ["stellar-core", "chat-gateway", "streamweaver"]) { control.registerApp({ appId, name: appId, description: "Functional foundation fixture", version: "1.0.0", launchUrl: `https://${appId}.example.test/`, allowedScopes: ["jobs:read", "jobs:write", "jobs:work"], surfaces: ["standalone"], status: "active" }); control.installApp("tenant-a", appId); }
  control.registerApp({ appId: "mission-control", name: "mission-control", description: "Uninstalled functional foundation fixture", version: "1.0.0", launchUrl: "https://mission-control.example.test/", allowedScopes: ["jobs:read", "jobs:write"], surfaces: ["standalone"], status: "active" });
  auth.registerServiceIdentity({ serviceId: "stellar-core", credential: "stellar-worker-secret-123456", scopes: ["jobs:read", "jobs:work"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  auth.registerServiceIdentity({ serviceId: "chat-gateway", credential: "chat-worker-secret-123456", scopes: ["jobs:read", "jobs:work"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  auth.registerServiceIdentity({ serviceId: "streamweaver", credential: "streamweaver-worker-secret-123456", scopes: ["jobs:read"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  const usage = new MonetizationService(assertBillingManifestV1(JSON.parse(readFileSync(new URL("../config/billing-plans.v1.json", import.meta.url), "utf8"))), store, () => at);
  const jobs = new ExecutionJobService({ store: platformStore, usage, resolvePlan: () => "creator", now: () => at, idFactory: () => "job_api_1", onTransition: (job) => data.createOperationsLog({ tenantId: job.tenantId, sourceAppId: job.ownerAppId, reporterId: "spmt-execution", level: job.state === "failed" ? "error" : "info", kind: `execution.${job.state}`, summary: `${job.capabilityId} is ${job.state}`, labels: ["execution-job"], idempotencyKey: `${job.id}:${job.state}:${job.fencingEpoch}:${job.updatedAt}` }) });
  const operations = new PlatformOperations(auth, authority, control, data, undefined, undefined, jobs), api = new PlatformApiAdapter(operations);
  const fetchImpl = async (url, init = {}) => { const parsed = new URL(String(url)), headers = Object.fromEntries(new Headers(init.headers).entries()); let body; if (typeof init.body === "string" && init.body) body = JSON.parse(init.body); const response = api.handle({ method: init.method ?? "GET", path: `${parsed.pathname}${parsed.search}`, headers, ...(body === undefined ? {} : { body }) }); return new Response(JSON.stringify(response.body ?? null), { status: response.status, headers: { "content-type": "application/json" } }); };
  const userA = auth.issueHumanSession({ userId: "user-a", scopes: ["jobs:read", "jobs:write"], tenantIds: ["tenant-a"] }).accessToken;
  const userB = auth.issueHumanSession({ userId: "user-b", scopes: ["jobs:read", "jobs:write"], tenantIds: ["tenant-a"] }).accessToken;
  const stellarToken = auth.issueServiceAccess("stellar-core", "stellar-worker-secret-123456").accessToken, otherWorkerToken = auth.issueServiceAccess("chat-gateway", "chat-worker-secret-123456").accessToken, streamweaverToken = auth.issueServiceAccess("streamweaver", "streamweaver-worker-secret-123456").accessToken;
  const client = (appId, token) => new SpmtClient({ baseUrl: "https://green.spmt.invalid", appId, getAccessToken: () => token, fetchImpl });
  return { dir, databasePath, store, platformStore, usage, data, jobs, api, operations, userAToken: userA, userA: client("spacemountain", userA), userB: client("spacemountain", userB), worker: client("stellar-core", stellarToken), otherWorker: client("chat-gateway", otherWorkerToken), streamweaver: client("streamweaver", streamweaverToken) };
}

test("public API and SDK carry one metered job through create, lease, progress, completion, isolation, and restart", async () => {
  const env = setup();
  try {
    await assert.rejects(() => env.userA.createExecutionJob("tenant-a", { ownerAppId: "mission-control", capabilityId: "mission-control.uninstalled", executionOwner: "mission-control", billedUserId: "user-a", meteredResource: "hosted-worker-minutes", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", input: { operation: "blocked" } }, "uninstalled-job"), (error) => error instanceof SpmtApiError && error.status === 403);
    const created = await env.userA.createExecutionJob("tenant-a", { ownerAppId: "stellar-core", capabilityId: "stellar.chat", executionOwner: "stellar-core", billedUserId: "user-a", meteredResource: "ai-chat-requests", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", input: { message: "Hello Stella" } }, "api-job-1", "corr-api-1");
    assert.equal(created.job.state, "queued");
    assert.equal((await env.userB.listExecutionJobs("tenant-a")).length, 0);
    const duplicate = await env.userA.createExecutionJob("tenant-a", { ownerAppId: "stellar-core", capabilityId: "stellar.chat", executionOwner: "stellar-core", billedUserId: "user-a", meteredResource: "ai-chat-requests", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", input: { message: "Hello Stella" } }, "api-job-1", "corr-api-1");
    assert.equal(duplicate.duplicate, true);
    assert.equal((await runSpmtCli(["jobs", "list", "tenant-a"], env.userA)).length, 1);
    const mcp = new SpmtMcpServer(env.operations), listedTools = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { accessToken: env.userAToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.ok(listedTools.result.tools.some((tool) => tool.name === "spmt.jobs.create" && tool.inputSchema.required.includes("meteringTarget")));
    const mcpJobs = mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "spmt.jobs.list", arguments: { tenantId: "tenant-a" } } }, { accessToken: env.userAToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.equal(mcpJobs.result.structuredContent.length, 1);
    const claimed = await env.worker.claimAnyExecutionJob("stellar-instance-1", "sprite", { capabilityIds: ["stellar.chat"] });
    assert.equal(claimed.state, "leased");
    await assert.rejects(() => env.otherWorker.heartbeatExecutionJob("tenant-a", claimed.id, "stellar-instance-1", claimed.leaseId, claimed.fencingEpoch, { percent: 5 }), (error) => error instanceof SpmtApiError && error.status === 403);
    const running = await env.worker.heartbeatExecutionJob("tenant-a", claimed.id, "stellar-instance-1", claimed.leaseId, claimed.fencingEpoch, { percent: 60, message: "Generating" });
    assert.equal(running.progress.percent, 60);
    const succeeded = await env.worker.succeedExecutionJob("tenant-a", claimed.id, "stellar-instance-1", claimed.leaseId, claimed.fencingEpoch, { messageId: "reply-1" });
    assert.equal(succeeded.state, "succeeded");
    assert.equal((await env.userA.getExecutionJob("tenant-a", claimed.id)).result.messageId, "reply-1");
    assert.equal(env.usage.summary("tenant-a", "user-a", "creator", at).resources.find((item) => item.resource === "ai-chat-requests").hosted, 1);
    assert.deepEqual(env.data.listOperationsLogs("tenant-a", { sourceAppId: "stellar-core" }).map((item) => item.kind).sort(), ["execution.leased", "execution.queued", "execution.running", "execution.succeeded"]);
    env.platformStore.close();
    const restored = new SqlitePlatformDataStore(env.databasePath);
    assert.equal(restored.getExecutionJob(claimed.id).state, "succeeded");
    assert.equal(restored.listExecutionJobs("other-tenant").length, 0);
    restored.close();
  } finally { env.store.close(); rmSync(env.dir, { recursive: true, force: true }); }
});

test("a service can read only the cross-owner execution jobs it requested", async () => {
  const env = setup();
  try {
    const created = env.jobs.create({ tenantId: "tenant-a", ownerAppId: "stellar-core", capabilityId: "stellar-core.ai-chat.v1", executionOwner: "stellar-core", requestedByType: "service", requestedById: "streamweaver", billedUserId: "user-a", meteredResource: "ai-chat-requests", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", idempotencyKey: "streamweaver-requested-job", input: { callerAppId: "streamweaver", message: "Status" } }).job;
    assert.equal((await env.streamweaver.getExecutionJob("tenant-a", created.id)).id, created.id);
    await assert.rejects(() => env.otherWorker.getExecutionJob("tenant-a", created.id), (error) => error instanceof SpmtApiError && error.status === 403);
    assert.equal((await env.streamweaver.listExecutionJobs("tenant-a")).length, 0, "a requester needs a known job id and cannot enumerate another app's jobs");
  } finally { env.platformStore.close(); env.store.close(); rmSync(env.dir, { recursive: true, force: true }); }
});
