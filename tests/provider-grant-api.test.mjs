import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { MemoryProviderCredentialSource, ProviderGrantBroker } from "../packages/provider-grants-core/dist/index.js";
import { SpmtApiError, SpmtClient } from "../packages/sdk/dist/index.js";

test("SPMT issues provider grants only to an installed scoped service and never exposes them to a human session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-provider-api-")), source = new MemoryProviderCredentialSource(), receipts = [];
  source.put("tenant-a", { provider: "twitch", providerUserId: "twitch-1", accessToken: "twitch-provider-token", metadata: { clientId: "client-1", broadcasterId: "twitch-1" }, scopes: ["chat:read"], expiresAt: "2026-08-28T13:00:00.000Z", allowedAppIds: ["chat-gateway"], allowedCapabilities: ["provider-chat"] });
  const broker = new ProviderGrantBroker(source, { record: (receipt) => receipts.push(receipt) }, { now: () => "2026-08-28T12:00:00.000Z", idFactory: () => "pgrant_http_1" });
  const service = createSpmtService({ databasePath: join(dir, "authority.sqlite"), webhookKey: Buffer.alloc(32, 4), host: "127.0.0.1", port: 0, providerGrants: broker });
  try {
    service.authority.ensureUser("owner-a");
    service.control.registerTenant({ tenantId: "tenant-a", ownerUserId: "owner-a", displayName: "Tenant A" });
    for (const appId of ["chat-gateway", "streamweaver"]) service.control.registerApp({ appId, name: appId, description: "Provider grant fixture", version: "1.0.0", launchUrl: `https://${appId}.example.test/`, allowedScopes: ["providers:grant"], surfaces: ["standalone"], status: "active" });
    service.control.installApp("tenant-a", "chat-gateway");
    service.auth.registerServiceIdentity({ serviceId: "chat-gateway", credential: "chat-gateway-secret-123456", scopes: ["providers:grant"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
    service.auth.registerServiceIdentity({ serviceId: "streamweaver", credential: "streamweaver-secret-123456", scopes: ["providers:grant"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
    const humanToken = service.auth.issueHumanSession({ userId: "owner-a", scopes: ["providers:grant"], tenantIds: ["tenant-a"] }).accessToken;
    await service.listen();
    const address = service.server.address(), baseUrl = `http://127.0.0.1:${address.port}`;
    const client = (appId, token) => new SpmtClient({ baseUrl, appId, getAccessToken: () => token });
    const serviceToken = service.auth.issueServiceAccess("chat-gateway", "chat-gateway-secret-123456").accessToken;
    const grant = await client("chat-gateway", serviceToken).issueProviderGrant("tenant-a", "twitch", "twitch-1", "provider-chat", ["chat:read"], 60);
    assert.equal(grant.requesterAppId, "chat-gateway");
    assert.equal(grant.credential.accessToken, "twitch-provider-token");
    assert.equal(grant.expiresAt, "2026-08-28T12:01:00.000Z");
    assert.equal("credential" in receipts[0], false);
    const uninstalledToken = service.auth.issueServiceAccess("streamweaver", "streamweaver-secret-123456").accessToken;
    await assert.rejects(() => client("streamweaver", uninstalledToken).issueProviderGrant("tenant-a", "twitch", "twitch-1", "provider-chat", ["chat:read"]), (error) => error instanceof SpmtApiError && error.status === 403);
    await assert.rejects(() => client("spacemountain", humanToken).issueProviderGrant("tenant-a", "twitch", "twitch-1", "provider-chat", ["chat:read"]), (error) => error instanceof SpmtApiError && error.status === 403);
    assert.ok(service.store.listAudit("tenant-a").some((item) => item.action === "provider-grants.issue" && item.actorId === "chat-gateway"));
    assert.doesNotMatch(JSON.stringify(service.store.listAudit("tenant-a")), /twitch-provider-token/);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("SPMT owns encrypted refresh, tenant isolation, and service-only authentication recovery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-provider-refresh-api-")), refreshes = [];
  const service = createSpmtService({
    databasePath: join(dir, "authority.sqlite"),
    webhookKey: Buffer.alloc(32, 4),
    providerCredentialKey: Buffer.alloc(32, 7),
    providerOAuthClients: { twitch: { clientId: "twitch-client-id", clientSecret: "twitch-client-secret" } },
    fetchImpl: async (url, init) => {
      refreshes.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ access_token: `fresh-access-token-${refreshes.length}`, refresh_token: `fresh-refresh-token-${refreshes.length}`, expires_in: 3600, scope: ["chat:read"] }), { status: 200, headers: { "content-type": "application/json" } });
    },
    host: "127.0.0.1",
    port: 0,
  });
  try {
    service.authority.ensureUser("owner-a");
    service.authority.ensureUser("owner-b");
    for (const [tenantId, ownerUserId] of [["tenant-a", "owner-a"], ["tenant-b", "owner-b"]]) {
      service.control.registerTenant({ tenantId, ownerUserId, displayName: tenantId });
    }
    service.control.registerApp({ appId: "chat-gateway", name: "Chat Gateway", description: "Provider grant fixture", version: "1.0.0", launchUrl: "https://chat-gateway.example.test/", allowedScopes: ["providers:grant"], surfaces: ["standalone"], status: "active" });
    for (const tenantId of ["tenant-a", "tenant-b"]) service.control.installApp(tenantId, "chat-gateway");
    service.auth.registerServiceIdentity({ serviceId: "chat-gateway", credential: "chat-gateway-secret-123456", scopes: ["providers:grant"], tenantMode: "allow-list", tenantIds: ["tenant-a", "tenant-b"] });
    for (const tenantId of ["tenant-a", "tenant-b"]) service.providerCredentials.put({ schemaVersion: 1, tenantId, provider: "twitch", providerUserId: "shared-provider-id", accessToken: `${tenantId}-expired-access`, refreshToken: `${tenantId}-refresh-token`, refreshMode: "oauth", metadata: { username: tenantId }, scopes: ["chat:read"], expiresAt: "2026-08-28T11:00:00.000Z", refreshExpiresAt: "2026-09-28T12:00:00.000Z", allowedAppIds: ["chat-gateway"], allowedCapabilities: ["provider-chat"] });
    await service.listen();
    const address = service.server.address(), baseUrl = `http://127.0.0.1:${address.port}`;
    const serviceToken = service.auth.issueServiceAccess("chat-gateway", "chat-gateway-secret-123456").accessToken;
    const client = new SpmtClient({ baseUrl, appId: "chat-gateway", getAccessToken: () => serviceToken });
    const first = await client.issueProviderGrant("tenant-a", "twitch", "shared-provider-id", "provider-chat", ["chat:read"], 60);
    const second = await client.issueProviderGrant("tenant-b", "twitch", "shared-provider-id", "provider-chat", ["chat:read"], 60);
    assert.notEqual(first.credential.accessToken, second.credential.accessToken);
    assert.equal(refreshes.length, 2);
    const recovered = await client.recoverProviderCredential("tenant-a", "twitch", "shared-provider-id", "provider returned authorization=secret-value");
    assert.equal(recovered.status, "ready");
    assert.equal(refreshes.length, 3);
    const humanToken = service.auth.issueHumanSession({ userId: "owner-a", scopes: ["providers:grant"], tenantIds: ["tenant-a"] }).accessToken;
    const human = new SpmtClient({ baseUrl, appId: "spacemountain", getAccessToken: () => humanToken });
    await assert.rejects(() => human.recoverProviderCredential("tenant-a", "twitch", "shared-provider-id", "retry"), (error) => error instanceof SpmtApiError && error.status === 403);
    const audit = JSON.stringify(service.store.listAudit("tenant-a"));
    assert.match(audit, /provider-grants\.recover/);
    assert.doesNotMatch(audit, /secret-value|fresh-access-token|fresh-refresh-token/);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});
