import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";

async function withService(run) {
  const dir = mkdtempSync(join(tmpdir(), "spmt-onboarding-http-"));
  const sent = [];
  const service = createSpmtService({ databasePath: join(dir, "spmt.db"), webhookKey: Buffer.alloc(32, 7), port: 0, host: "127.0.0.1", publicBaseUrl: "https://spmt.live", sendDiscordDm: async (id, message) => sent.push({ id, message }) });
  try {
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address !== "string");
    await run(service, `http://127.0.0.1:${address.port}`, sent);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
}

test("public setup choices expose exactly the SpaceMountain invite and existing-member DM reset", async () => {
  await withService(async (_service, base) => {
    const response = await fetch(`${base}/v1/auth/setup-options`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.options.length, 2);
    assert.equal(body.options[0].id, "spacemountain-invite");
    assert.equal(body.options[0].primary, true);
    assert.equal(body.options[1].id, "discord-dm-reset");
    assert.equal(body.options.some((item) => item.id === "twitch-recovery"), false);
  });
});

test("service-scoped account provisioning creates app-owned identity and login routes it to first-time setup", async () => {
  await withService(async (service, base) => {
    service.auth.registerServiceIdentity({ serviceId: "nebula-arcade", credential: "nebula-arcade-provision-secret-123456789", scopes: ["identity:provision"], tenantMode: "any" });
    const token = service.auth.issueServiceAccess("nebula-arcade", "nebula-arcade-provision-secret-123456789").accessToken;
    const provision = await fetch(`${base}/v1/accounts/provision`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ tenantId: "tenant-new-user", username: "brandnew", displayName: "Brand New" }) });
    assert.equal(provision.status, 201);
    const account = await provision.json();
    assert.equal(account.credentialState, "setup-required");
    const login = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "brandnew", password: "anything-at-all" }) });
    assert.equal(login.status, 409);
    const loginBody = await login.json();
    assert.equal(loginBody.error, "setup_required");
    assert.equal(loginBody.next, "spacemountain-invite");
  });
});

test("Discord invite endpoint returns the exact welcome embed contract for SpaceMountain", async () => {
  await withService(async (service, base) => {
    service.auth.registerServiceIdentity({ serviceId: "spacemountain", credential: "spacemountain-onboard-secret-123456", scopes: ["identity:onboard"], tenantMode: "any" });
    const token = service.auth.issueServiceAccess("spacemountain", "spacemountain-onboard-secret-123456").accessToken;
    const response = await fetch(`${base}/v1/onboarding/discord-invite`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ tenantId: "tenant-welcome", displayName: "Test User", username: "testuser", discord: { id: "discord-789", username: "testuser" } }) });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.welcome.title, "Welcome to SpaceMountain, Test User");
    assert.equal(body.welcome.actionLabel, "Link Twitch & finish setup");
    assert.match(body.welcome.setupUrl, /^https:\/\/spmt\.live\/v1\/onboarding\/twitch\/start\?ticket=/);
    assert.equal(service.store.getProviderLink("discord", "discord-789")?.userId, body.account.userId);
  });
});
