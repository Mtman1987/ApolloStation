import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { ControlService } from "../packages/control-core/dist/index.js";
import { PlatformDataService } from "../packages/platform-data-core/dist/index.js";
import { SqlitePlatformDataStore } from "../packages/platform-data-sqlite/dist/index.js";
import { PlatformOperations } from "../packages/platform-ops/dist/index.js";
import { PlatformApiAdapter } from "../packages/api-adapter/dist/index.js";
import { SpmtClient, SpmtApiError } from "../packages/sdk/dist/index.js";
import { runSpmtCli } from "../packages/cli/dist/index.js";
import { SpmtMcpServer, SPMT_MCP_PROTOCOL_VERSION } from "../packages/mcp/dist/index.js";

function setup(coderRuntime) {
  const dir = mkdtempSync(join(tmpdir(), "spmt-operations-console-"));
  const databasePath = join(dir, "operations.sqlite");
  const store = new SqliteAuthorityStore(databasePath);
  const platformStore = new SqlitePlatformDataStore(databasePath);
  const now = () => "2026-08-22T17:00:00.000Z";
  const authority = new AuthorityService({ store, now });
  const auth = new AuthService({ store, now });
  const control = new ControlService({ store, now });
  const data = new PlatformDataService({ store: platformStore, auth, webhookKey: Buffer.alloc(32, 4), now });

  authority.ensureUser("owner-a");
  authority.ensureUser("owner-b");
  control.registerTenant({ tenantId: "tenant-a", ownerUserId: "owner-a", displayName: "Tenant A" });
  control.registerTenant({ tenantId: "tenant-b", ownerUserId: "owner-b", displayName: "Tenant B" });
  authority.getOrCreateWorkspace("tenant-a");
  authority.getOrCreateWorkspace("tenant-b");
  for (const appId of ["app-a", "app-b"]) control.registerApp({ appId, name: appId.toUpperCase(), description: "Operations fixture", version: "1.0.0", launchUrl: `https://${appId}.example.test/`, allowedScopes: [], surfaces: ["standalone"], status: "active" });

  registerService(auth, "app-a", ["operations:logs:write", "operations:logs:read", "operations:coder:read", "operations:coder:invoke"]);
  registerService(auth, "app-b", ["operations:logs:write", "operations:logs:read", "operations:coder:read", "operations:coder:invoke"]);
  registerService(auth, "rotator", ["operations:logs:write", "operations:logs:read", "operations:logs:any", "operations:coder:read", "operations:coder:invoke", "operations:coder:any"]);

  const operations = new PlatformOperations(auth, authority, control, data, undefined, coderRuntime);
  const api = new PlatformApiAdapter(operations);
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    let body;
    if (typeof init.body === "string" && init.body) body = JSON.parse(init.body);
    const response = api.handle({ method: init.method ?? "GET", path: `${parsed.pathname}${parsed.search}`, headers, ...(body === undefined ? {} : { body }) });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
  };
  const appA = clientFor("app-a", token(auth, "app-a"), fetchImpl);
  const appB = clientFor("app-b", token(auth, "app-b"), fetchImpl);
  const rotator = clientFor("rotator", token(auth, "rotator"), fetchImpl);
  const ownerToken = auth.issueHumanSession({ userId: "owner-a", scopes: ["operations:logs:read", "operations:coder:read", "operations:coder:invoke"], tenantIds: ["tenant-a"] }).accessToken;
  const owner = clientFor("spacemountain", ownerToken, fetchImpl);
  const invokeOnlyToken = auth.issueHumanSession({ userId: "owner-a", scopes: ["operations:coder:invoke"], tenantIds: ["tenant-a"] }).accessToken;
  const invokeOnly = clientFor("spacemountain", invokeOnlyToken, fetchImpl);
  const otherOwnerToken = auth.issueHumanSession({ userId: "owner-b", scopes: ["operations:logs:read", "operations:coder:read", "operations:coder:invoke"], tenantIds: ["tenant-b"] }).accessToken;
  const otherOwner = clientFor("spacemountain", otherOwnerToken, fetchImpl);
  return { dir, store, platformStore, authority, auth, data, operations, api, appA, appB, rotator, owner, invokeOnly, otherOwner, ownerToken };
}

function registerService(auth, serviceId, scopes) {
  auth.registerServiceIdentity({ serviceId, credential: `${serviceId}-operations-secret-123456`, scopes, tenantMode: "allow-list", tenantIds: ["tenant-a"] });
}
function token(auth, serviceId) { return auth.issueServiceAccess(serviceId, `${serviceId}-operations-secret-123456`).accessToken; }
function clientFor(appId, accessToken, fetchImpl) { return new SpmtClient({ baseUrl: "https://green.spmt.invalid", appId, getAccessToken: () => accessToken, fetchImpl }); }
function cleanup(env) { env.platformStore.close(); env.store.close(); rmSync(env.dir, { recursive: true, force: true }); }

test("operations records are persistent, idempotent, redacted, and consolidated for the tenant owner", async () => {
  const env = setup();
  try {
    const first = await env.appA.publishOperationsLog("tenant-a", {
      level: "error",
      kind: "worker.crash",
      summary: "Worker failed with authorization=super-secret-value",
      detail: "Request used Bearer abcdefghijklmnopqrstuvwxyz123456 and client_secret=another-secret-value",
      labels: ["worker", "runtime"],
      occurredAt: "2026-08-22T16:59:00.000Z",
    }, "app-a-crash-1", "corr-app-a-1");
    assert.equal(first.duplicate, false);
    assert.doesNotMatch(JSON.stringify(first), /super-secret-value|abcdefghijklmnopqrstuvwxyz123456|another-secret-value/);
    assert.match(first.log.summary, /\[REDACTED\]/);
    assert.equal(first.log.sourceAppId, "app-a");
    assert.equal(first.log.reporterId, "app-a");
    assert.equal(first.log.correlationId, "corr-app-a-1");

    const duplicate = await runSpmtCli(["ops", "log-publish", "tenant-a", JSON.stringify({ level: "error", kind: "worker.crash", summary: "Worker failed with authorization=super-secret-value", detail: "Request used Bearer abcdefghijklmnopqrstuvwxyz123456 and client_secret=another-secret-value", labels: ["worker", "runtime"], occurredAt: "2026-08-22T16:59:00.000Z" }), "app-a-crash-1"], env.appA);
    assert.equal(duplicate.duplicate, true);

    await env.rotator.publishOperationsLog("tenant-a", { sourceAppId: "app-b", level: "warn", kind: "capacity.cold", summary: "No warm worker is running", labels: ["capacity"] }, "rotator-app-b-1");
    await assert.rejects(() => env.rotator.publishOperationsLog("tenant-a", { sourceAppId: "not-enrolled", level: "warn", kind: "capacity.unknown", summary: "Unknown workload" }, "rotator-unknown-1"), (error) => error instanceof SpmtApiError && error.status === 404);
    const consolidated = await env.owner.listOperationsLogs("tenant-a", { limit: 20 });
    assert.deepEqual(consolidated.map((item) => item.sourceAppId).sort(), ["app-a", "app-b"]);
    assert.equal((await env.appA.listOperationsLogs("tenant-a")).every((item) => item.sourceAppId === "app-a"), true);

    await assert.rejects(() => env.appB.listOperationsLogs("tenant-a", { sourceAppId: "app-a" }), (error) => error instanceof SpmtApiError && error.status === 403);
    await assert.rejects(() => env.otherOwner.listOperationsLogs("tenant-a"), (error) => error instanceof SpmtApiError && error.status === 403);
  } finally { cleanup(env); }
});

test("coder evidence becomes a truthful persistent draft when no Rotator worker is connected", async () => {
  const env = setup();
  try {
    const published = await env.appA.publishOperationsLog("tenant-a", { level: "critical", kind: "consumer.duplicate", summary: "Two consumers claimed the same lease" }, "duplicate-consumer-1");
    const descriptor = await env.owner.getCoderDescriptor("tenant-a");
    assert.equal(descriptor.executionOwner, "mtman-machine-rotator");
    assert.equal(descriptor.availability, "unavailable");

    const created = await env.owner.createCoderJob("tenant-a", "app-a", "Find the duplicate-consumer cause and propose tests. password=do-not-store-this", [published.log.id], "coder-draft-1");
    assert.equal(created.duplicate, false);
    assert.equal(created.job.state, "draft");
    assert.match(created.job.unavailableReason, /not connected/);
    assert.doesNotMatch(created.job.prompt, /do-not-store-this/);
    assert.equal(created.job.evidence[0].logId, published.log.id);
    assert.doesNotMatch(JSON.stringify(created.job), /diff|patch|analysisResult|deployed/);

    const duplicate = await env.owner.createCoderJob("tenant-a", "app-a", "Find the duplicate-consumer cause and propose tests. password=do-not-store-this", [published.log.id], "coder-draft-1");
    assert.equal(duplicate.duplicate, true);
    assert.equal((await env.owner.listCoderJobs("tenant-a")).length, 1);
    await assert.rejects(() => env.appB.createCoderJob("tenant-a", "app-a", "Inspect another app", [published.log.id], "cross-app-coder-1"), (error) => error instanceof SpmtApiError && error.status === 403);
    await assert.rejects(() => env.appB.createCoderJob("tenant-a", "app-b", "Smuggle another app's evidence", [published.log.id], "cross-app-evidence-1"), (error) => error instanceof SpmtApiError && error.status === 400);
    await assert.rejects(() => env.invokeOnly.createCoderJob("tenant-a", "app-a", "Read evidence without permission", [published.log.id], "invoke-without-read-1"), (error) => error instanceof SpmtApiError && error.status === 403);
  } finally { cleanup(env); }
});

test("a temporarily unavailable connected coder preserves one retryable idempotent draft", async () => {
  const attemptedJobIds = [];
  let attempts = 0;
  const env = setup({
    status: () => ({ availability: "available" }),
    accept: (job) => {
      attemptedJobIds.push(job.id);
      attempts += 1;
      if (attempts === 1) throw new Error("temporary worker failure");
      return { jobId: "rotator-retry-1" };
    },
  });
  try {
    const published = await env.appA.publishOperationsLog("tenant-a", { level: "error", kind: "worker.retry", summary: "Worker needs a retry" }, "worker-retry-1");
    const create = () => env.owner.createCoderJob("tenant-a", "app-a", "Diagnose the retry", [published.log.id], "retryable-coder-1");
    await assert.rejects(create, (error) => error instanceof SpmtApiError && error.status === 503 && /persisted draft/.test(error.responseBody));
    const drafts = await env.owner.listCoderJobs("tenant-a", { state: "draft" });
    assert.equal(drafts.length, 1);
    const retried = await create();
    assert.equal(retried.duplicate, true);
    assert.equal(retried.job.state, "queued");
    assert.equal(retried.job.runtimeJobId, "rotator-retry-1");
    assert.deepEqual(attemptedJobIds, [drafts[0].id, drafts[0].id]);
  } finally { cleanup(env); }
});

test("connected coder queues the exact bounded evidence through API, CLI, and MCP-visible contracts", async () => {
  const accepted = [];
  const env = setup({ status: () => ({ availability: "available" }), accept: (job) => { accepted.push(job); return { jobId: "rotator-job-1" }; } });
  try {
    const published = await env.appA.publishOperationsLog("tenant-a", { level: "error", kind: "http.failure", summary: "Health route returned 503" }, "health-503-1");
    const api = env.api.handle({ method: "POST", path: "/v1/operations/coder/jobs", headers: { authorization: `Bearer ${env.ownerToken}`, "x-spmt-tenant": "tenant-a", "idempotency-key": "queued-coder-1" }, body: { targetAppId: "app-a", prompt: "Diagnose the health failure", evidenceLogIds: [published.log.id] } });
    assert.equal(api.status, 202);
    assert.equal(api.body.job.state, "queued");
    assert.equal(api.body.job.runtimeJobId, "rotator-job-1");
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].evidence.length, 1);

    const cli = await runSpmtCli(["ops", "coder-jobs", "tenant-a", "10", "app-a", "queued"], env.owner);
    assert.equal(cli[0].id, api.body.job.id);

    const mcp = new SpmtMcpServer(env.operations);
    const listed = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { accessToken: env.ownerToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.ok(listed.result.tools.some((tool) => tool.name === "spmt.operations.logs.list"));
    const coderTool = listed.result.tools.find((tool) => tool.name === "spmt.operations.coder.jobs.create");
    assert.deepEqual(coderTool.inputSchema.required, ["tenantId", "targetAppId", "prompt", "evidenceLogIds", "idempotencyKey"]);
    const read = mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "spmt.operations.coder.jobs.list", arguments: { tenantId: "tenant-a", state: "queued" } } }, { accessToken: env.ownerToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.equal(read.result.structuredContent[0].runtimeJobId, "rotator-job-1");
  } finally { cleanup(env); }
});
