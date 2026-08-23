import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { ControlService } from "../packages/control-core/dist/index.js";
import { PlatformOperations } from "../packages/platform-ops/dist/index.js";
import { OverlayOutputMountResolver, PlatformApiAdapter } from "../packages/api-adapter/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";
import { runSpmtCli } from "../packages/cli/dist/index.js";
import { SpmtMcpServer, SPMT_MCP_PROTOCOL_VERSION } from "../packages/mcp/dist/index.js";
import { ChatTagOverlayHttpAdapter, SqliteChatTagStore } from "../apps/nebula-arcade/dist/index.js";

function environment() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-overlay-output-"));
  const path = join(dir, "authority.db");
  const store = new SqliteAuthorityStore(path);
  let time = Date.parse("2026-08-23T12:00:00.000Z");
  const now = () => new Date(time).toISOString();
  let outputSequence = 0;
  const control = new ControlService({
    store,
    now,
    outputBaseUrl: "https://outputs.spmt.invalid",
    tokenFactory: (kind) => kind === "grant-id" ? `out_grant_${++outputSequence}` : `opaque_${++outputSequence}_${"z".repeat(32)}`,
  });
  const authority = new AuthorityService({ store, now });
  authority.ensureUser("owner-1");
  authority.ensureUser("member-2");
  control.registerTenant({ tenantId: "tenant-a", ownerUserId: "owner-1", displayName: "Tenant A" });
  control.registerApp({ appId: "nebula-arcade", name: "Nebula Arcade", description: "Community games", version: "1.0.0", launchUrl: "https://nebula.spmt.invalid", allowedScopes: ["workspace:read"], surfaces: ["shell", "overlay"], status: "active" });
  control.installApp("tenant-a", "nebula-arcade");
  control.registerOverlayWidget({ tenantId: "tenant-a", manifest: { schemaVersion: 1, appId: "nebula-arcade", widgetId: "chat-tag", title: "Chat Tag", kind: "native", rendererUrl: "https://nebula.spmt.invalid/v1/nebula/chat-tag/overlay", requiredScopes: ["workspace:read"], supportsAudio: true, supportsInteraction: false } });
  let authSequence = 0;
  const auth = new AuthService({ store, now, tokenFactory: (kind) => `${kind}_${++authSequence}_${"x".repeat(32)}` });
  const ownerToken = auth.issueHumanSession({ userId: "owner-1", scopes: ["overlay:outputs:read", "overlay:outputs:write"], tenantIds: ["tenant-a"] }).accessToken;
  const memberToken = auth.issueHumanSession({ userId: "member-2", scopes: ["overlay:outputs:read", "overlay:outputs:write"], tenantIds: ["tenant-a"] }).accessToken;
  auth.registerServiceIdentity({ serviceId: "nebula-arcade", credential: "nebula-output-secret-123456789", scopes: ["overlay:outputs:read", "overlay:outputs:write"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  const serviceToken = auth.issueServiceAccess("nebula-arcade", "nebula-output-secret-123456789").accessToken;
  const operations = new PlatformOperations(auth, authority, control);
  const api = new PlatformApiAdapter(operations);
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    const response = api.handle({ method: init.method ?? "GET", path: `${parsed.pathname}${parsed.search}`, headers, ...(body === undefined ? {} : { body }) });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
  };
  const client = new SpmtClient({ baseUrl: "https://green.spmt.invalid", appId: "spmt-account", getAccessToken: () => ownerToken, fetchImpl });
  return { dir, path, store, control, auth, ownerToken, memberToken, serviceToken, operations, api, client, now, advance: (seconds) => { time += seconds * 1000; } };
}

function rawAuthorityFiles(path) {
  return [path, `${path}-wal`].filter(existsSync).map((file) => readFileSync(file).toString("latin1")).join("");
}

test("opaque overlay outputs work across SDK, CLI, API and MCP without persisting bearer URLs", async () => {
  const e = environment();
  const chatStore = new SqliteChatTagStore(join(e.dir, "chat-tag.db"));
  try {
    const issued = await e.client.issueOverlayOutput("tenant-a", "nebula-arcade", "chat-tag", "viewer-7", 600_000);
    const outputUrl = new URL(issued.browserSourceUrl);
    const token = decodeURIComponent(outputUrl.pathname.slice(3));
    assert.equal(outputUrl.origin, "https://outputs.spmt.invalid");
    assert.equal(outputUrl.search, "");
    assert.equal(outputUrl.hash, "");
    assert.ok(!issued.browserSourceUrl.includes("tenant-a"));
    assert.ok(!issued.browserSourceUrl.includes("nebula-arcade"));

    const resolver = new OverlayOutputMountResolver(e.control);
    const mounted = resolver.resolve(outputUrl.pathname);
    assert.deepEqual(mounted?.principal, { schemaVersion: 1, grantId: issued.grant.grantId, tenantId: "tenant-a", appId: "nebula-arcade", widgetId: "chat-tag", viewerUserId: "viewer-7" });
    assert.equal(mounted?.rendererUrl, "https://nebula.spmt.invalid/v1/nebula/chat-tag/overlay");
    assert.equal(resolver.resolve(`${outputUrl.pathname}?tenantId=spoofed`), undefined);

    const rendered = new ChatTagOverlayHttpAdapter(chatStore, e.now).handle({ method: "GET", path: "/v1/nebula/chat-tag/overlay" }, mounted?.principal);
    assert.equal(rendered.status, 200);
    assert.match(rendered.body, /Chat Tag Overlay/);

    const listedByCli = await runSpmtCli(["overlay", "outputs", "tenant-a", "nebula-arcade"], e.client);
    assert.equal(listedByCli.length, 1);
    assert.equal("browserSourceUrl" in listedByCli[0], false);
    assert.equal("tokenHash" in listedByCli[0], false);
    const apiListed = e.api.handle({ method: "GET", path: "/v1/overlay/outputs?appId=nebula-arcade", headers: { authorization: `Bearer ${e.ownerToken}`, "x-spmt-tenant": "tenant-a" } });
    assert.equal(apiListed.status, 200);

    const mcp = new SpmtMcpServer(e.operations);
    const mcpIssued = mcp.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "spmt.overlay.outputs.issue", arguments: { tenantId: "tenant-a", appId: "nebula-arcade", widgetId: "chat-tag" } } }, { accessToken: e.ownerToken, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
    assert.match(mcpIssued.result.structuredContent.browserSourceUrl, /^https:\/\/outputs\.spmt\.invalid\/o\//);

    assert.equal(rawAuthorityFiles(e.path).includes(token), false);
    assert.equal(e.store.listJournal().some((entry) => JSON.stringify(entry.payload).includes(token)), false);
    const revoked = await runSpmtCli(["overlay", "revoke", "tenant-a", issued.grant.grantId], e.client);
    assert.ok(revoked.revokedAt);
    assert.equal(resolver.resolve(outputUrl.pathname), undefined);
    assert.ok(e.store.listAudit("tenant-a").some((item) => item.action === "overlay.outputs.issue"));
    assert.ok(e.store.listAudit("tenant-a").some((item) => item.action === "overlay.outputs.revoke"));
  } finally {
    chatStore.close();
    e.store.close();
    rmSync(e.dir, { recursive: true, force: true });
  }
});

test("only the signed-in tenant owner can manage outputs", () => {
  const e = environment();
  try {
    const member = e.api.handle({ method: "POST", path: "/v1/overlay/outputs", headers: { authorization: `Bearer ${e.memberToken}`, "x-spmt-tenant": "tenant-a" }, body: { appId: "nebula-arcade", widgetId: "chat-tag" } });
    assert.equal(member.status, 403);
    const service = e.api.handle({ method: "POST", path: "/v1/overlay/outputs", headers: { authorization: `Bearer ${e.serviceToken}`, "x-spmt-tenant": "tenant-a" }, body: { appId: "nebula-arcade", widgetId: "chat-tag" } });
    assert.equal(service.status, 403);
    const crossTenant = e.api.handle({ method: "GET", path: "/v1/overlay/outputs", headers: { authorization: `Bearer ${e.ownerToken}`, "x-spmt-tenant": "tenant-b" } });
    assert.equal(crossTenant.status, 403);
  } finally {
    e.store.close();
    rmSync(e.dir, { recursive: true, force: true });
  }
});

test("hashed output grants survive restart and expire closed", () => {
  const e = environment();
  try {
    const issued = e.control.issueOverlayOutputGrant({ tenantId: "tenant-a", appId: "nebula-arcade", widgetId: "chat-tag", createdByUserId: "owner-1", ttlMs: 300_000 });
    const path = new URL(issued.browserSourceUrl).pathname;
    assert.equal(new OverlayOutputMountResolver(e.control).resolve(path)?.principal.grantId, issued.grant.grantId);
    e.store.close();
    const reopened = new SqliteAuthorityStore(e.path);
    try {
      const control = new ControlService({ store: reopened, now: e.now, outputBaseUrl: "https://outputs.spmt.invalid" });
      assert.equal(new OverlayOutputMountResolver(control).resolve(path)?.principal.grantId, issued.grant.grantId);
      e.advance(301);
      assert.equal(new OverlayOutputMountResolver(control).resolve(path), undefined);
      assert.equal(control.listOverlayOutputGrants("tenant-a")[0].grantId, issued.grant.grantId);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(e.dir, { recursive: true, force: true });
  }
});
