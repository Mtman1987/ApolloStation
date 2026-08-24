import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtServiceWithProviderIdentity } from "../apps/spmt-service/dist/provider-identity-host.js";

test("provider identity HTTP adapter shares the real SPMT port without breaking existing routes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-provider-host-"));
  const port = await freePort();
  const service = createSpmtServiceWithProviderIdentity({
    databasePath: join(dir, "spmt.sqlite"),
    port,
    publicBaseUrl: `http://127.0.0.1:${port}`,
    webhookKey: Buffer.alloc(32, 12),
  });
  service.auth.registerServiceIdentity({
    serviceId: "discord-stream-hub",
    credential: "dsh-host-provider-secret-123456789",
    scopes: ["identity:read", "identity:write"],
    tenantMode: "allow-list",
    tenantIds: ["tenant-a"],
  });
  const token = service.auth.issueServiceAccess("discord-stream-hub", "dsh-host-provider-secret-123456789").accessToken;
  await new Promise((resolve, reject) => { service.server.once("error", reject); service.server.listen(port, "127.0.0.1", resolve); });
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(health.status, 200, "existing SPMT health route still delegates to the original handler");

    const create = await fetch(`http://127.0.0.1:${port}/v1/identity/provider/grandfather`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-spmt-tenant": "tenant-a", "content-type": "application/json" },
      body: JSON.stringify({ provider: "discord", providerUserId: "discord-host-1", providerUsername: "host-user" }),
    });
    assert.equal(create.status, 200);
    const created = await create.json();
    assert.equal(created.providerUserId, "discord-host-1");
    assert.deepEqual(created.profile.tenantIds, []);

    const resolve = await fetch(`http://127.0.0.1:${port}/v1/identity/provider?provider=discord&providerUserId=discord-host-1`, {
      headers: { authorization: `Bearer ${token}`, "x-spmt-tenant": "tenant-a" },
    });
    assert.equal(resolve.status, 200);
    assert.equal((await resolve.json()).userId, created.userId);

    const normal404 = await fetch(`http://127.0.0.1:${port}/not-a-real-route`);
    assert.equal(normal404.status, 404, "unrelated requests continue through the original SPMT handler");
  } finally {
    await new Promise((resolve) => service.server.close(resolve));
    service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}
