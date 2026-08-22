import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { PlatformOperations } from "../packages/platform-ops/dist/index.js";
import { PlatformApiAdapter } from "../packages/api-adapter/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";
import { runSpmtCli } from "../packages/cli/dist/index.js";
import { SpmtMcpServer, SPMT_MCP_PROTOCOL_VERSION } from "../packages/mcp/dist/index.js";

function setup(communityAssistant) {
  const dir = mkdtempSync(join(tmpdir(), "spmt-dev-platform-"));
  const store = new SqliteAuthorityStore(join(dir, "authority.db"));
  const authority = new AuthorityService({ store, now: () => "2026-08-22T02:40:00.000Z" });
  authority.ensureUser("viewer-1");
  authority.getOrCreateWorkspace("tenant-a");
  const auth = new AuthService({ store, now: () => "2026-08-22T02:40:00.000Z" });
  auth.registerServiceIdentity({ serviceId: "reference-app", credential: "reference-app-green-secret-12345", scopes: ["workspace:read", "workspace:write", "xp:read", "xp:write", "events:read", "events:write", "assistants:read", "assistants:invoke"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  const accessToken = auth.issueServiceAccess("reference-app", "reference-app-green-secret-12345").accessToken;
  const operations = new PlatformOperations(auth, authority, undefined, undefined, communityAssistant);
  const api = new PlatformApiAdapter(operations);
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    let body;
    if (typeof init.body === "string" && init.body) body = JSON.parse(init.body);
    const response = api.handle({ method: init.method ?? "GET", path: `${parsed.pathname}${parsed.search}`, headers, ...(body === undefined ? {} : { body }) });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
  };
  const client = new SpmtClient({ baseUrl: "https://green.spmt.invalid", appId: "reference-app", getAccessToken: () => accessToken, fetchImpl });
  return { dir, store, authority, auth, operations, api, client, accessToken };
}

function cleanup(env) { env.store.close(); rmSync(env.dir, { recursive: true, force: true }); }

test("SDK and CLI use the same API operation path and preserve idempotent XP semantics", async () => {
  const env = setup();
  try {
    const sdkAward = await env.client.awardXp("tenant-a", "viewer-1", 10, "support", "shared-award-1");
    assert.equal(sdkAward.duplicate, false);
    const cliAward = await runSpmtCli(["xp", "award", "tenant-a", "viewer-1", "10", "support", "shared-award-1"], env.client);
    assert.equal(cliAward.duplicate, true);
    assert.equal((await env.client.getXpBalance("tenant-a", "viewer-1")).balance, 10);
  } finally { cleanup(env); }
});

test("API and modern stateless MCP converge on one workspace authority", async () => {
  const env = setup();
  try {
    const apiResult = env.api.handle({ method: "PATCH", path: "/v1/workspace/profile", headers: { authorization: `Bearer ${env.accessToken}`, "x-spmt-tenant": "tenant-a" }, body: { expectedRevision: 1, patch: { appearance: { theme: "dark" } } } });
    assert.equal(apiResult.status, 200);
    const mcp = new SpmtMcpServer(env.operations);
    const list = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.ok(list.result.tools.some((item) => item.name === "spmt.workspace.get"));
    assert.ok(list.result.tools.some((item) => item.name === "spmt.athena.context.list" && /Deprecated/.test(item.description)));
    const read = mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "spmt.workspace.get", arguments: { tenantId: "tenant-a" } } }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.equal(read.result.structuredContent.revision, 2);
    assert.equal(read.result.structuredContent.appearance.theme, "dark");
    const oldInitialize = mcp.handle({ jsonrpc: "2.0", id: 3, method: "initialize" }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.equal(oldInitialize.error.code, -32601);
  } finally { cleanup(env); }
});

test("deprecated Athena CLI names remain transition aliases for Stellar Core", async () => {
  const seen = [];
  const client = {
    listAthenaContext: (...args) => { seen.push(["context-list", ...args]); return args; },
    upsertAthenaContext: (...args) => { seen.push(["context-upsert", ...args]); return args; },
    listAthenaCommands: (...args) => { seen.push(["commands", ...args]); return args; },
    upsertAthenaCommand: (...args) => { seen.push(["command-upsert", ...args]); return args; },
  };
  await runSpmtCli(["athena", "context-list", "tenant-a", "user-a"], client);
  await runSpmtCli(["athena", "context-upsert", "tenant-a", '{"text":"legacy"}'], client);
  await runSpmtCli(["athena", "commands"], client);
  await runSpmtCli(["athena", "command-upsert", '{"id":"legacy.command"}'], client);
  assert.deepEqual(seen.map(([name]) => name), ["context-list", "context-upsert", "commands", "command-upsert"]);
});

test("Stella is app-neutral across SDK, API, CLI and MCP and stays truthful without a worker", async () => {
  const env = setup();
  try {
    const descriptor = await env.client.getCommunityAssistant("tenant-a");
    assert.equal(descriptor.id, "spmt.community-assistant");
    assert.equal(descriptor.displayName, "Stella");
    assert.equal(descriptor.executionOwner, "stellar-core");
    assert.equal(descriptor.availability, "unavailable");

    const sdk = await env.client.invokeCommunityAssistant("tenant-a", { userId: "viewer-1", message: "Summarize Commlink", surface: "commlink" }, "stella-unavailable-1");
    assert.equal(sdk.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(sdk), /response|reply|messageText/);

    const cli = await runSpmtCli(["stella", "show", "tenant-a"], env.client);
    assert.equal(cli.id, "spmt.community-assistant");

    const api = env.api.handle({ method: "POST", path: "/v1/assistants/community/invocations", headers: { authorization: `Bearer ${env.accessToken}`, "x-spmt-tenant": "tenant-a", "x-spmt-app": "spoofed-app", "idempotency-key": "stella-unavailable-2" }, body: { userId: "viewer-1", message: "Help", surface: "app" } });
    assert.equal(api.status, 200);
    assert.equal(api.body.status, "unavailable");
    const denied = env.api.handle({ method: "POST", path: "/v1/assistants/community/invocations", headers: { authorization: `Bearer ${env.accessToken}`, "x-spmt-tenant": "tenant-b", "idempotency-key": "stella-wrong-tenant" }, body: { userId: "viewer-1", message: "Help", surface: "app" } });
    assert.equal(denied.status, 403);

    const mcp = new SpmtMcpServer(env.operations);
    const tools = mcp.handle({ jsonrpc: "2.0", id: 10, method: "tools/list" }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    const stellaTool = tools.result.tools.find((item) => item.name === "spmt.assistants.community.invoke");
    assert.ok(stellaTool && /Stella/.test(stellaTool.description));
    assert.deepEqual(stellaTool.inputSchema.required, ["tenantId", "message", "surface", "idempotencyKey"]);
    const invoked = mcp.handle({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "spmt.assistants.community.invoke", arguments: { tenantId: "tenant-a", userId: "viewer-1", message: "Help", surface: "developer", idempotencyKey: "stella-unavailable-3" } } }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.equal(invoked.result.structuredContent.status, "unavailable");
    assert.equal(env.store.listAudit("tenant-a").filter((item) => item.action === "assistants.community.invoke").length, 3);
  } finally { cleanup(env); }
});

test("connected Stella invocation accepts a durable job without trusting a caller-app header", async () => {
  const accepted = [];
  const env = setup({
    status: () => ({ availability: "available" }),
    accept: (input) => { accepted.push(input); return { jobId: `job-${accepted.length}` }; },
  });
  try {
    const result = await env.client.invokeCommunityAssistant("tenant-a", { userId: "viewer-1", message: "Hello Stella", surface: "standalone", conversationId: "conversation-1" }, "stella-job-1");
    assert.equal(result.status, "accepted");
    assert.equal(result.jobId, "job-1");
    assert.equal(accepted[0].tenantId, "tenant-a");
    assert.equal(accepted[0].userId, "viewer-1");
    assert.equal(accepted[0].callerAppId, "reference-app");
    assert.equal(accepted[0].idempotencyKey, "stella-job-1");
    assert.equal(accepted[0].conversationId, "conversation-1");

    const api = env.api.handle({ method: "POST", path: "/v1/assistants/community/invocations", headers: { authorization: `Bearer ${env.accessToken}`, "x-spmt-tenant": "tenant-a", "x-spmt-app": "spoofed-app", "idempotency-key": "stella-job-2" }, body: { userId: "viewer-1", message: "Hello again", surface: "app" } });
    assert.equal(api.status, 202);
    assert.equal(api.body.status, "accepted");
    assert.equal(accepted[1].callerAppId, "reference-app");
  } finally { cleanup(env); }
});

test("SDK, CLI, API and MCP expose one scoped App Events projection", async () => {
  const env = setup();
  try {
    await env.client.publishEvent("tenant-a", "workspace.changed", { revision: 2 }, "event-read-1");
    await env.client.publishEvent("tenant-a", "app.ready", { appId: "reference-app" }, "event-read-2");
    const sdk = await env.client.listEvents("tenant-a", { limit: 1 });
    assert.equal(sdk.length, 1);
    assert.equal(sdk[0].type, "app.ready");
    const cli = await runSpmtCli(["event", "list", "tenant-a", "10", "workspace.changed"], env.client);
    assert.equal(cli.length, 1);
    assert.equal(cli[0].idempotencyKey, "event-read-1");
    const api = env.api.handle({ method: "GET", path: "/v1/events?sourceAppId=reference-app&limit=10", headers: { authorization: `Bearer ${env.accessToken}`, "x-spmt-tenant": "tenant-a" } });
    assert.equal(api.status, 200);
    assert.equal(api.body.length, 2);
    const mcp = new SpmtMcpServer(env.operations);
    const read = mcp.handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "spmt.events.list", arguments: { tenantId: "tenant-a", type: "app.ready" } } }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.equal(read.result.structuredContent.length, 1);
    assert.equal(read.result.structuredContent[0].type, "app.ready");
  } finally { cleanup(env); }
});

test("all developer adapters enforce the same tenant and scope policy", async () => {
  const env = setup();
  try {
    const denied = env.api.handle({ method: "GET", path: "/v1/workspace/profile", headers: { authorization: `Bearer ${env.accessToken}`, "x-spmt-tenant": "tenant-b" } });
    assert.equal(denied.status, 403);
    const mcp = new SpmtMcpServer(env.operations);
    const result = mcp.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "spmt.xp.balance", arguments: { tenantId: "tenant-b", userId: "viewer-1" } } }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.ok(result.error);
  } finally { cleanup(env); }
});
