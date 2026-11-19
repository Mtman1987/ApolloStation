import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../dist/index.js";

test("verified owner sign-in recovers an active owned tenant missing from the profile link list", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-owner-session-recovery-"));
  const service = createSpmtService({
    databasePath: join(directory, "spmt.sqlite"),
    webhookKey: Buffer.alloc(32, 23),
    host: "127.0.0.1",
    port: 0,
    runtimeMode: "production",
    fetchImpl: async (input, init = {}) => {
      assert.equal(String(input), "https://spmt.live/api/auth/me");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer verified-owner-token");
      return new Response(JSON.stringify({ user: { id: "spmt-owner-123", username: "mtman1987", discordId: "767875979561009173" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  try {
    service.authority.ensureUser("owner-existing");
    service.data.registerUser({
      userId: "owner-existing",
      username: "mtman1987",
      displayName: "Apollo Owner",
      password: "owner-test-password-12345",
      tenantIds: ["stale-tenant-link"],
    });
    service.control.registerTenant({
      tenantId: "recovered-owner-tenant",
      ownerUserId: "owner-existing",
      displayName: "Recovered Owner Workspace",
    });
    service.authority.getOrCreateWorkspace("recovered-owner-tenant");

    // A stale Discord link points at a different legacy profile. The canonical
    // verified SPMT owner username must win over that provider mapping.
    service.authority.ensureUser("legacy-provider-user");
    service.data.registerUser({
      userId: "legacy-provider-user",
      username: "legacy-discord-profile",
      displayName: "Legacy Discord Profile",
      password: "legacy-provider-test-password-12345",
      tenantIds: ["legacy-provider-tenant"],
    });
    service.control.registerTenant({
      tenantId: "legacy-provider-tenant",
      ownerUserId: "legacy-provider-user",
      displayName: "Legacy Provider Workspace",
    });
    service.authority.getOrCreateWorkspace("legacy-provider-tenant");
    service.store.putProviderLink({
      provider: "discord",
      providerUserId: "767875979561009173",
      userId: "legacy-provider-user",
      linkedAt: new Date().toISOString(),
    });

    service.authority.ensureUser("another-user");
    service.control.registerTenant({
      tenantId: "another-users-tenant",
      ownerUserId: "another-user",
      displayName: "Another Workspace",
    });
    service.authority.getOrCreateWorkspace("another-users-tenant");

    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/auth/session/bridge-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bridgeJson: JSON.stringify({ token: "verified-owner-token" }) }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.profile.userId, "owner-existing");
    assert.deepEqual(body.tenantIds, ["recovered-owner-tenant"]);
    assert.deepEqual(service.data.getProfile("owner-existing").tenantIds, ["recovered-owner-tenant"]);
    assert.equal(body.tenantIds.includes("another-users-tenant"), false);
  } finally {
    await service.close().catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
});
