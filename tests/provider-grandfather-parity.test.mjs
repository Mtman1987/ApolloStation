import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccountRecoveryService, SqliteAccountSetupStore } from "../packages/account-recovery-core/dist/index.js";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { ControlService } from "../packages/control-core/dist/index.js";
import { PlatformDataService } from "../packages/platform-data-core/dist/index.js";
import { SqlitePlatformDataStore } from "../packages/platform-data-sqlite/dist/index.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-provider-import-"));
  const path = join(dir, "spmt.db");
  const store = new SqliteAuthorityStore(path);
  const platformStore = new SqlitePlatformDataStore(path);
  const setupStore = new SqliteAccountSetupStore(path);
  const authority = new AuthorityService({ store, now: () => "2026-08-24T19:00:00.000Z" });
  const auth = new AuthService({ store, now: () => "2026-08-24T19:00:00.000Z" });
  const control = new ControlService({ store, now: () => "2026-08-24T19:00:00.000Z" });
  const data = new PlatformDataService({ store: platformStore, auth, webhookKey: Buffer.alloc(32, 4), now: () => "2026-08-24T19:00:00.000Z" });
  const accounts = new AccountRecoveryService({ authority, authorityStore: store, control, platformStore, setupStore, now: () => "2026-08-24T19:00:00.000Z" });
  return { dir, path, store, platformStore, setupStore, authority, auth, control, data, accounts, close() { setupStore.close(); platformStore.close(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("trusted provider grandfathering creates one global passwordless SPMT identity without inventing a tenant", () => {
  const f = fixture();
  try {
    const first = f.accounts.grandfatherProviderIdentity({ sourceAppId: "discord-stream-hub", provider: "discord", providerUserId: "767875979561009173", providerUsername: "Captain Name", displayName: "Captain Name" });
    assert.equal(first.createdUser, true);
    assert.equal(first.linkedProvider, true);
    assert.equal(first.credentialState, "setup-required");
    assert.deepEqual(first.profile.tenantIds, []);
    assert.equal(first.profile.username, "captain-name");
    assert.equal(f.store.getProviderLink("discord", "767875979561009173")?.userId, first.userId);
    assert.equal(f.platformStore.getUserCredential(first.userId), undefined);

    const second = f.accounts.grandfatherProviderIdentity({ sourceAppId: "discord-stream-hub", provider: "discord", providerUserId: "767875979561009173", providerUsername: "renamed-captain" });
    assert.equal(second.userId, first.userId);
    assert.equal(second.createdUser, false);
    assert.equal(second.linkedProvider, false);
    assert.equal(second.profile.username, "captain-name", "provider rename does not become a new SPMT identity");
  } finally { f.close(); }
});

test("provider display-name collisions never merge two immutable provider ids", () => {
  const f = fixture();
  try {
    const discord = f.accounts.grandfatherProviderIdentity({ sourceAppId: "discord-stream-hub", provider: "discord", providerUserId: "discord-1", providerUsername: "same-name" });
    const twitch = f.accounts.grandfatherProviderIdentity({ sourceAppId: "discord-stream-hub", provider: "twitch", providerUserId: "twitch-2", providerUsername: "same-name" });
    assert.notEqual(discord.userId, twitch.userId);
    assert.equal(discord.profile.username, "same-name");
    assert.notEqual(twitch.profile.username, "same-name");
    assert.match(twitch.profile.username, /^same-name-/);
    assert.equal(f.accounts.resolveProviderIdentity("discord", "discord-1")?.userId, discord.userId);
    assert.equal(f.accounts.resolveProviderIdentity("twitch", "twitch-2")?.userId, twitch.userId);
  } finally { f.close(); }
});

test("revoked provider identity is not silently resolved but verified grandfathering returns it to the same SPMT user", () => {
  const f = fixture();
  try {
    const first = f.accounts.grandfatherProviderIdentity({ sourceAppId: "discord-stream-hub", provider: "discord", providerUserId: "discord-relink", providerUsername: "relink-user" });
    f.authority.unlinkProvider(first.userId, "discord", "discord-relink");
    assert.equal(f.accounts.resolveProviderIdentity("discord", "discord-relink"), undefined);
    const relinked = f.accounts.grandfatherProviderIdentity({ sourceAppId: "discord-stream-hub", provider: "discord", providerUserId: "discord-relink", providerUsername: "relink-user" });
    assert.equal(relinked.userId, first.userId);
    assert.equal(relinked.createdUser, false);
    assert.equal(relinked.linkedProvider, true);
    assert.equal(relinked.recoveredRevokedLink, true);
    assert.equal(f.accounts.resolveProviderIdentity("discord", "discord-relink")?.userId, first.userId);
  } finally { f.close(); }
});

test("provider imports survive SQLite reopen and keep the same canonical user", () => {
  const f = fixture();
  let userId;
  try {
    userId = f.accounts.grandfatherProviderIdentity({ sourceAppId: "discord-stream-hub", provider: "twitch", providerUserId: "twitch-persist", providerUsername: "persist-user" }).userId;
    f.setupStore.close(); f.platformStore.close(); f.store.close();

    const store2 = new SqliteAuthorityStore(f.path);
    const platformStore2 = new SqlitePlatformDataStore(f.path);
    const setupStore2 = new SqliteAccountSetupStore(f.path);
    const authority2 = new AuthorityService({ store: store2 });
    const auth2 = new AuthService({ store: store2 });
    const control2 = new ControlService({ store: store2 });
    new PlatformDataService({ store: platformStore2, auth: auth2, webhookKey: Buffer.alloc(32, 4) });
    const accounts2 = new AccountRecoveryService({ authority: authority2, authorityStore: store2, control: control2, platformStore: platformStore2, setupStore: setupStore2 });
    assert.equal(accounts2.resolveProviderIdentity("twitch", "twitch-persist")?.userId, userId);
    const replay = accounts2.grandfatherProviderIdentity({ sourceAppId: "discord-stream-hub", provider: "twitch", providerUserId: "twitch-persist", providerUsername: "persist-user" });
    assert.equal(replay.userId, userId);
    assert.equal(replay.createdUser, false);
    setupStore2.close(); platformStore2.close(); store2.close();
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
