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

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-dev-platform-"));
  const store = new SqliteAuthorityStore(join(dir, "authority.db"));
  const authority = new AuthorityService({ store, now: () => "2026-08-22T02:40:00.000Z" });
  authority.ensureUser("viewer-1");
  authority.getOrCreateWorkspace("tenant-a");
  const auth = new AuthService({ store, now: () => "2026-08-22T02:40:00.000Z" });
  auth.registerServiceIdentity({ serviceId: "reference-app", credential: "reference-app-green-secret-12345", scopes: ["workspace:read", "workspace:write", "xp:read", "xp:write", "events:write"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  const accessToken = auth.issueServiceAccess("reference-app", "reference-app-green-secret-12345").accessToken;
  const operations = new PlatformOperations(auth, authority);
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
    const read = mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "spmt.workspace.get", arguments: { tenantId: "tenant-a" } } }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.equal(read.result.structuredContent.revision, 2);
    assert.equal(read.result.structuredContent.appearance.theme, "dark");
    const oldInitialize = mcp.handle({ jsonrpc: "2.0", id: 3, method: "initialize" }, { accessToken: env.accessToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.equal(oldInitialize.error.code, -32601);
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
