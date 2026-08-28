import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccountRecoveryService, SqliteAccountSetupStore } from "../packages/account-recovery-core/dist/index.js";
import { ProviderIdentityOperationError, ProviderIdentityOperations } from "../packages/account-recovery-core/dist/provider-identity-ops.js";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { ControlService } from "../packages/control-core/dist/index.js";
import { PlatformDataService } from "../packages/platform-data-core/dist/index.js";
import { SqlitePlatformDataStore } from "../packages/platform-data-sqlite/dist/index.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-provider-ops-"));
  const path = join(dir, "spmt.db");
  const store = new SqliteAuthorityStore(path);
  const platformStore = new SqlitePlatformDataStore(path);
  const setupStore = new SqliteAccountSetupStore(path);
  const authority = new AuthorityService({ store });
  const auth = new AuthService({ store });
  const control = new ControlService({ store });
  new PlatformDataService({ store: platformStore, auth, webhookKey: Buffer.alloc(32, 7) });
  const accounts = new AccountRecoveryService({ authority, authorityStore: store, control, platformStore, setupStore });
  const operations = new ProviderIdentityOperations(auth, accounts);
  auth.registerServiceIdentity({ serviceId: "discord-stream-hub", credential: "dsh-identity-secret-123456789", scopes: ["identity:read", "identity:write"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  auth.registerServiceIdentity({ serviceId: "streamweaver-reader", credential: "reader-identity-secret-123456", scopes: ["identity:read"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  const dsh = auth.issueServiceAccess("discord-stream-hub", "dsh-identity-secret-123456789").accessToken;
  const reader = auth.issueServiceAccess("streamweaver-reader", "reader-identity-secret-123456").accessToken;
  return { dir, store, platformStore, setupStore, authority, auth, operations, dsh, reader, close() { setupStore.close(); platformStore.close(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("provider grandfather operation binds source app to service identity and tenant scope", () => {
  const f = fixture();
  try {
    const result = f.operations.execute({ name: "identity.provider.grandfather", input: { tenantId: "tenant-a", provider: "discord", providerUserId: "discord-44", providerUsername: "captain", sourceAppId: "spoofed-app" } }, { accessToken: f.dsh });
    assert.equal(result.provider, "discord");
    assert.equal(result.providerUserId, "discord-44");
    assert.equal(result.profile.username, "captain");
    assert.deepEqual(result.profile.tenantIds, []);
    assert.equal(f.store.getProviderLink("discord", "discord-44")?.userId, result.userId);
    assert.throws(() => f.operations.execute({ name: "identity.provider.grandfather", input: { tenantId: "tenant-b", provider: "discord", providerUserId: "discord-other" } }, { accessToken: f.dsh }), (error) => error instanceof ProviderIdentityOperationError && error.code === "unauthorized");
  } finally { f.close(); }
});

test("read scope can resolve immutable provider identity but cannot create one", () => {
  const f = fixture();
  try {
    const created = f.operations.execute({ name: "identity.provider.grandfather", input: { tenantId: "tenant-a", provider: "twitch", providerUserId: "twitch-22", providerUsername: "streamer" } }, { accessToken: f.dsh });
    const resolved = f.operations.execute({ name: "identity.provider.resolve", input: { tenantId: "tenant-a", provider: "twitch", providerUserId: "twitch-22" } }, { accessToken: f.reader });
    assert.equal(resolved.userId, created.userId);
    assert.throws(() => f.operations.execute({ name: "identity.provider.grandfather", input: { tenantId: "tenant-a", provider: "twitch", providerUserId: "twitch-33" } }, { accessToken: f.reader }), (error) => error instanceof ProviderIdentityOperationError && error.code === "unauthorized");
  } finally { f.close(); }
});

test("human identity:write is not enough to mass-import provider accounts", () => {
  const f = fixture();
  try {
    f.authority.ensureUser("owner-user");
    const human = f.auth.issueHumanSession({ userId: "owner-user", scopes: ["identity:write", "identity:read"], tenantIds: ["tenant-a"] }).accessToken;
    assert.throws(() => f.operations.execute({ name: "identity.provider.grandfather", input: { tenantId: "tenant-a", provider: "discord", providerUserId: "discord-human" } }, { accessToken: human }), (error) => error instanceof ProviderIdentityOperationError && error.code === "unauthorized");
  } finally { f.close(); }
});

test("unlinked provider lookup is a clean not-found instead of a fabricated identity", () => {
  const f = fixture();
  try {
    assert.throws(() => f.operations.execute({ name: "identity.provider.resolve", input: { tenantId: "tenant-a", provider: "discord", providerUserId: "missing" } }, { accessToken: f.reader }), (error) => error instanceof ProviderIdentityOperationError && error.code === "not_found");
  } finally { f.close(); }
});
