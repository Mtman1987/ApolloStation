import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ProviderGrantBroker,
  ProviderGrantError,
  ProviderOAuthRefreshError,
  SqliteProviderCredentialAuthority,
  createFirstPartyProviderRefreshAdapters,
} from "../packages/provider-grants-core/dist/index.js";

const at = "2026-08-28T12:00:00.000Z";
const linked = (overrides = {}) => ({
  schemaVersion: 1,
  tenantId: "tenant-a",
  provider: "twitch",
  providerUserId: "provider-user-1",
  accessToken: "expired-access-token",
  refreshToken: "rotating-refresh-token",
  refreshMode: "oauth",
  metadata: { username: "creator", broadcasterId: "provider-user-1" },
  scopes: ["chat:read"],
  expiresAt: "2026-08-28T11:59:00.000Z",
  refreshExpiresAt: "2026-09-28T12:00:00.000Z",
  allowedAppIds: ["chat-gateway"],
  allowedCapabilities: ["provider-chat"],
  ...overrides,
});

function fixture(adapter, owner = "refresh-worker-a") {
  const directory = mkdtempSync(join(tmpdir(), "apollo-provider-credentials-"));
  const databasePath = join(directory, "authority.sqlite");
  const authority = new SqliteProviderCredentialAuthority(databasePath, Buffer.alloc(32, 9), adapter ? [adapter] : [], {
    now: () => at,
    owner,
    clients: { twitch: { clientId: "twitch-client-id", clientSecret: "twitch-client-secret" } },
  });
  return { directory, databasePath, authority, close() { authority.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("SPMT refreshes once, stores rotated secrets encrypted, and issues only a bounded grant", async () => {
  const calls = [];
  const adapter = { provider: "twitch", async refresh(input) { calls.push(input); return { accessToken: "fresh-access-token", refreshToken: "fresh-refresh-token", expiresAt: "2026-08-28T13:00:00.000Z", scopes: ["chat:read"] }; } };
  const f = fixture(adapter);
  try {
    f.authority.put(linked());
    const broker = new ProviderGrantBroker(f.authority, undefined, { now: () => at, idFactory: () => "pgrant_rotated", maximumTtlSeconds: 120 });
    const grant = await broker.issue({ schemaVersion: 1, tenantId: "tenant-a", requesterAppId: "chat-gateway", provider: "twitch", providerUserId: "provider-user-1", capabilityId: "provider-chat", requiredScopes: ["chat:read"], ttlSeconds: 60 });
    assert.equal(grant.credential.accessToken, "fresh-access-token");
    assert.equal(grant.expiresAt, "2026-08-28T12:01:00.000Z");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].refreshToken, "rotating-refresh-token");
    assert.equal(f.authority.get("tenant-a", "twitch", "provider-user-1").revision, 2);
    f.authority.close();
    const bytes = readdirSync(f.directory).map((name) => readFileSync(join(f.directory, name)).toString("latin1")).join("\n");
    assert.doesNotMatch(bytes, /expired-access-token|rotating-refresh-token|fresh-access-token|fresh-refresh-token/);
  } finally {
    try { f.authority.close(); } catch {}
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("a refresh lease fences concurrent workers and invalid grants become reauthorization-required", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const adapter = { provider: "twitch", async refresh() { await waiting; return { accessToken: "fresh-access-token", refreshToken: "fresh-refresh-token", expiresAt: "2026-08-28T13:00:00.000Z" }; } };
  const f = fixture(adapter, "refresh-worker-a");
  const second = new SqliteProviderCredentialAuthority(f.databasePath, Buffer.alloc(32, 9), [adapter], { now: () => at, owner: "refresh-worker-b", clients: { twitch: { clientId: "twitch-client-id", clientSecret: "twitch-client-secret" } } });
  try {
    f.authority.put(linked());
    const firstResolve = f.authority.resolve({ tenantId: "tenant-a", provider: "twitch", providerUserId: "provider-user-1" });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(() => second.resolve({ tenantId: "tenant-a", provider: "twitch", providerUserId: "provider-user-1" }), (error) => error instanceof ProviderGrantError && error.code === "unavailable");
    release();
    assert.equal((await firstResolve).accessToken, "fresh-access-token");
    const permanent = { provider: "twitch", async refresh() { throw new ProviderOAuthRefreshError(true, "Twitch authorization must be renewed"); } };
    second.close();
    const rejecting = new SqliteProviderCredentialAuthority(f.databasePath, Buffer.alloc(32, 9), [permanent], { now: () => "2026-08-28T14:00:00.000Z", owner: "refresh-worker-c", clients: { twitch: { clientId: "twitch-client-id", clientSecret: "twitch-client-secret" } } });
    const result = await rejecting.recover({ tenantId: "tenant-a", provider: "twitch", providerUserId: "provider-user-1", reason: "provider returned 401" });
    assert.equal(result.status, "reauthorization-required");
    assert.equal(rejecting.get("tenant-a", "twitch", "provider-user-1").state, "reauthorization-required");
    rejecting.close();
  } finally {
    try { second.close(); } catch {}
    f.close();
  }
});

test("one-way donor import is replay-safe and never overwrites a newer provider link", () => {
  const f = fixture(undefined);
  try {
    f.authority.put(linked({ accessToken: "current-access-token", refreshToken: "current-refresh-token", expiresAt: "2026-08-28T13:00:00.000Z" }));
    const input = { schemaVersion: 1, migrationId: "provider-donor-freeze-1", records: [
      { ...linked({ accessToken: "stale-donor-access", refreshToken: "stale-donor-refresh" }), sourceRecordId: "donor-row-1" },
      { ...linked({ tenantId: "tenant-b", providerUserId: "provider-user-2", accessToken: "tenant-b-access-token", refreshToken: "tenant-b-refresh-token" }), sourceRecordId: "donor-row-2" },
    ].map(({ schemaVersion: _schemaVersion, ...record }) => record) };
    const receipt = f.authority.importLegacy(input);
    assert.deepEqual({ imported: receipt.imported, skippedExisting: receipt.skippedExisting }, { imported: 1, skippedExisting: 1 });
    assert.deepEqual(f.authority.importLegacy(input), receipt);
    assert.equal(f.authority.get("tenant-a", "twitch", "provider-user-1").revision, 1);
    assert.equal(f.authority.list("tenant-b").length, 1);
    assert.equal("accessToken" in f.authority.list("tenant-b")[0], false);
  } finally { f.close(); }
});

test("official Twitch, Discord, and Kick refresh adapters use form posts and preserve rotated refresh tokens", async () => {
  const requests = [];
  const adapters = createFirstPartyProviderRefreshAdapters(async (url, init) => {
    requests.push({ url, init });
    return { ok: true, status: 200, async json() { return { access_token: `${requests.length}-access-token`, refresh_token: `${requests.length}-refresh-token`, expires_in: 3600, scope: "chat:read chat:write" }; } };
  });
  for (const adapter of adapters) {
    const result = await adapter.refresh({ clientId: "provider-client-id", clientSecret: "provider-client-secret", refreshToken: "provider-refresh-token", now: at });
    assert.equal(result.expiresAt, "2026-08-28T13:00:00.000Z");
    assert.match(result.refreshToken, /refresh-token$/);
  }
  assert.deepEqual(requests.map((request) => new URL(request.url).host), ["id.twitch.tv", "discord.com", "id.kick.com"]);
  assert.match(requests[0].init.body, /client_secret=provider-client-secret/);
  assert.match(requests[1].init.headers.authorization, /^Basic /);
  assert.doesNotMatch(requests[1].init.body, /provider-client-secret/);
  assert.match(requests[2].init.body, /client_secret=provider-client-secret/);
});
