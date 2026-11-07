import test from "node:test";
import assert from "node:assert/strict";
import { discoverNebulaTenantFromSpmt } from "../scripts/nebula-tenant-discovery.mjs";

test("Nebula importer discovers the canonical tenant through SPMT's Chat Gateway service identity", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/auth/service-token")) {
      return Response.json({ accessToken: "short-lived-service-token", accessExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    return Response.json({ connections: [
      { schemaVersion: 1, tenantId: "workspace-real", provider: "twitch", connectionId: "bot-1", channelId: "mtman1987", desired: true },
      { schemaVersion: 1, tenantId: "workspace-real", provider: "twitch", connectionId: "bot-2", channelId: "backup", desired: true },
      { schemaVersion: 1, tenantId: "ignored", provider: "twitch", connectionId: "old", channelId: "old", desired: false },
    ] });
  };
  const tenantId = await discoverNebulaTenantFromSpmt({
    spmtOrigin: "https://apollo-node-1.hostless.app",
    workerCredential: "x".repeat(40),
    fetchImpl,
  });
  assert.equal(tenantId, "workspace-real");
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].init.body).serviceId, "chat-gateway");
  assert.equal(JSON.parse(calls[0].init.body).credential, "x".repeat(40));
  assert.equal(calls[1].init.headers["x-spmt-app"], "chat-gateway");
  assert.equal(calls[1].init.headers.authorization, "Bearer short-lived-service-token");
});

test("Nebula tenant discovery fails closed for zero or multiple desired Twitch tenants", async () => {
  for (const connections of [
    [],
    [
      { schemaVersion: 1, tenantId: "a", provider: "twitch", connectionId: "one", channelId: "one", desired: true },
      { schemaVersion: 1, tenantId: "b", provider: "twitch", connectionId: "two", channelId: "two", desired: true },
    ],
  ]) {
    let call = 0;
    await assert.rejects(() => discoverNebulaTenantFromSpmt({
      spmtOrigin: "https://apollo-node-1.hostless.app",
      workerCredential: "x".repeat(40),
      fetchImpl: async () => ++call === 1
        ? Response.json({ accessToken: "token" })
        : Response.json({ connections }),
    }), /exactly one desired Twitch workspace tenant/);
  }
});

test("Nebula tenant discovery rejects insecure origins and short credentials before making requests", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return Response.json({}); };
  await assert.rejects(() => discoverNebulaTenantFromSpmt({ spmtOrigin: "http://apollo-node-1.hostless.app", workerCredential: "x".repeat(40), fetchImpl }), /HTTPS origin/);
  await assert.rejects(() => discoverNebulaTenantFromSpmt({ spmtOrigin: "https://apollo-node-1.hostless.app", workerCredential: "short", fetchImpl }), /at least 32 characters/);
  assert.equal(calls, 0);
});
