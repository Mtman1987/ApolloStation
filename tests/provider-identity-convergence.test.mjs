import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccountRecoveryService, SqliteAccountSetupStore } from "../packages/account-recovery-core/dist/index.js";
import { ProviderIdentityApiAdapter } from "../packages/account-recovery-core/dist/provider-identity-api.js";
import { ProviderIdentityOperations } from "../packages/account-recovery-core/dist/provider-identity-ops.js";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { runProviderIdentityCli } from "../packages/cli/dist/provider-identity.js";
import { ControlService } from "../packages/control-core/dist/index.js";
import { ProviderIdentityMcpServer } from "../packages/mcp/dist/provider-identity.js";
import { PlatformDataService } from "../packages/platform-data-core/dist/index.js";
import { SqlitePlatformDataStore } from "../packages/platform-data-sqlite/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";
import { grandfatherProviderIdentity, resolveProviderIdentity } from "../packages/sdk/dist/provider-identity.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-provider-convergence-"));
  const path = join(dir, "spmt.db");
  const store = new SqliteAuthorityStore(path);
  const platformStore = new SqlitePlatformDataStore(path);
  const setupStore = new SqliteAccountSetupStore(path);
  const authority = new AuthorityService({ store });
  const auth = new AuthService({ store });
  const control = new ControlService({ store });
  new PlatformDataService({ store: platformStore, auth, webhookKey: Buffer.alloc(32, 9) });
  const accounts = new AccountRecoveryService({ authority, authorityStore: store, control, platformStore, setupStore });
  const operations = new ProviderIdentityOperations(auth, accounts);
  const api = new ProviderIdentityApiAdapter(operations);
  const mcp = new ProviderIdentityMcpServer(operations);

  auth.registerServiceIdentity({ serviceId: "discord-stream-hub", credential: "dsh-provider-secret-123456789", scopes: ["identity:read", "identity:write"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  const accessToken = auth.issueServiceAccess("discord-stream-hub", "dsh-provider-secret-123456789").accessToken;

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    let body = init.body;
    if (typeof body === "string" && body) body = JSON.parse(body);
    const response = api.handle({ method: init.method ?? "GET", path: `${url.pathname}${url.search}`, headers, body });
    if (!response) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(response.body === undefined ? undefined : JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
  };
  const client = new SpmtClient({ baseUrl: "https://spmt.test", appId: "discord-stream-hub", fetchImpl, getAccessToken: () => accessToken });
  return { dir, store, platformStore, setupStore, authority, auth, operations, api, mcp, accessToken, client, close() { setupStore.close(); platformStore.close(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("HTTP and SDK grandfather one immutable Discord id into one canonical SPMT user", async () => {
  const f = fixture();
  try {
    const created = await grandfatherProviderIdentity(f.client, "tenant-a", { provider: "discord", providerUserId: "discord-777", providerUsername: "same-name", displayName: "Same Name" });
    assert.equal(created.provider, "discord");
    assert.equal(created.createdUser, true);
    assert.deepEqual(created.profile.tenantIds, []);

    const resolved = await resolveProviderIdentity(f.client, "tenant-a", "discord", "discord-777");
    assert.equal(resolved.userId, created.userId);
    assert.equal(resolved.profile.username, created.profile.username);
  } finally { f.close(); }
});

test("CLI subpath uses the same HTTP/SDK identity authority", async () => {
  const f = fixture();
  try {
    const created = await runProviderIdentityCli(["grandfather", "tenant-a", "twitch", "twitch-88", "streamer88", "", "Streamer 88"].filter((value, index) => value !== "" || index < 4), f.client);
    const resolved = await runProviderIdentityCli(["resolve", "tenant-a", "twitch", "twitch-88"], f.client);
    assert.equal(resolved.userId, created.userId);
    assert.equal(f.store.getProviderLink("twitch", "twitch-88")?.userId, created.userId);
  } finally { f.close(); }
});

test("MCP resolves and grandfathers through the exact scoped provider operation", () => {
  const f = fixture();
  try {
    const create = f.mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "spmt.identity.provider.grandfather", arguments: { tenantId: "tenant-a", provider: "discord", providerUserId: "discord-mcp", providerUsername: "mcp-user" } } }, { accessToken: f.accessToken });
    assert.ok(create.result);
    const created = create.result.structuredContent;
    const resolve = f.mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "spmt.identity.provider.resolve", arguments: { tenantId: "tenant-a", provider: "discord", providerUserId: "discord-mcp" } } }, { accessToken: f.accessToken });
    assert.equal(resolve.result.structuredContent.userId, created.userId);
    const tools = f.mcp.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { accessToken: f.accessToken });
    assert.deepEqual(tools.result.tools.map((tool) => tool.name), ["spmt.identity.provider.resolve", "spmt.identity.provider.grandfather"]);
  } finally { f.close(); }
});

test("SDK/API cannot use the DSH identity token outside its authorized tenant", async () => {
  const f = fixture();
  try {
    await assert.rejects(() => grandfatherProviderIdentity(f.client, "tenant-b", { provider: "discord", providerUserId: "discord-nope" }), (error) => error?.status === 403);
    assert.equal(f.store.getProviderLink("discord", "discord-nope"), undefined);
  } finally { f.close(); }
});

test("separate provider ids with the same display name stay separate across all client surfaces", async () => {
  const f = fixture();
  try {
    const first = await grandfatherProviderIdentity(f.client, "tenant-a", { provider: "discord", providerUserId: "discord-name-1", providerUsername: "duplicate" });
    const secondResponse = f.mcp.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "spmt.identity.provider.grandfather", arguments: { tenantId: "tenant-a", provider: "twitch", providerUserId: "twitch-name-2", providerUsername: "duplicate" } } }, { accessToken: f.accessToken });
    const second = secondResponse.result.structuredContent;
    assert.notEqual(first.userId, second.userId);
    assert.notEqual(first.profile.username, second.profile.username);
  } finally { f.close(); }
});
