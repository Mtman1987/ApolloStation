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
  const dir = mkdtempSync(join(tmpdir(), "spmt-onboarding-"));
  const path = join(dir, "spmt.db");
  const store = new SqliteAuthorityStore(path);
  const platformStore = new SqlitePlatformDataStore(path);
  const setupStore = new SqliteAccountSetupStore(path);
  const authority = new AuthorityService({ store, now: () => "2026-08-22T03:20:00.000Z" });
  const auth = new AuthService({ store, now: () => "2026-08-22T03:20:00.000Z" });
  const control = new ControlService({ store, now: () => "2026-08-22T03:20:00.000Z" });
  const data = new PlatformDataService({ store: platformStore, auth, webhookKey: Buffer.alloc(32, 8), now: () => "2026-08-22T03:20:00.000Z" });
  let seq = 0;
  const accounts = new AccountRecoveryService({ authority, authorityStore: store, control, platformStore, setupStore, now: () => "2026-08-22T03:20:00.000Z", tokenFactory: () => `ticket_${++seq}_${"x".repeat(40)}` });
  return { dir, path, store, platformStore, setupStore, authority, auth, control, data, accounts, close() { setupStore.close(); platformStore.close(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a tenant creates one passwordless SPMT account immediately and remains idempotent", () => {
  const f = fixture();
  try {
    const first = f.accounts.provisionAccount({ tenantId: "tenant-nebula-arcade-1", sourceAppId: "nebula-arcade", username: "newmember", displayName: "New Member" });
    assert.equal(first.credentialState, "setup-required");
    assert.equal(first.createdUser, true);
    assert.equal(first.createdTenant, true);
    assert.equal(f.platformStore.getUserCredential(first.userId), undefined);
    assert.equal(f.control.getTenant("tenant-nebula-arcade-1").ownerUserId, first.userId);
    assert.equal(f.authority.getWorkspace("tenant-nebula-arcade-1")?.tenantId, "tenant-nebula-arcade-1");
    f.authority.awardXp({ tenantId: "tenant-nebula-arcade-1", userId: first.userId, delta: 5, sourceAppId: "nebula-arcade", reason: "joined", idempotencyKey: "join-1" });
    assert.equal(f.authority.getXpBalance("tenant-nebula-arcade-1", first.userId), 5);
    const second = f.accounts.provisionAccount({ tenantId: "tenant-nebula-arcade-1", sourceAppId: "discord-stream-hub", username: "newmember" });
    assert.equal(second.userId, first.userId);
    assert.equal(second.createdUser, false);
    assert.equal(second.createdTenant, false);
  } finally { f.close(); }
});

test("Discord invite then Twitch verification upgrades the same provisional account and allows login", () => {
  const f = fixture();
  try {
    const invite = f.accounts.createDiscordInvite({ tenantId: "tenant-a", sourceAppId: "spacemountain", username: "captain", displayName: "Captain", discord: { id: "discord-100", username: "captain" } });
    assert.equal(invite.account.credentialState, "setup-required");
    assert.equal(f.store.getProviderLink("discord", "discord-100")?.userId, invite.account.userId);
    const started = f.accounts.beginTwitchVerification(invite.ticket);
    f.accounts.completeTwitchVerification(invite.ticket, started.state, { id: "twitch-200", username: "captainlive" });
    assert.equal(f.store.getProviderLink("twitch", "twitch-200")?.userId, invite.account.userId);
    f.accounts.completeFirstTimePassword(invite.ticket, "a-strong-first-password");
    const login = f.data.login("captain", "a-strong-first-password", ["workspace:read"]);
    assert.equal(login.profile.userId, invite.account.userId);
    assert.throws(() => f.accounts.completeFirstTimePassword(invite.ticket, "another-strong-password"), /already used/);
  } finally { f.close(); }
});

test("existing members can receive a one-time Discord DM reset without a plaintext password", () => {
  const f = fixture();
  try {
    const invite = f.accounts.createDiscordInvite({ tenantId: "tenant-b", sourceAppId: "spacemountain", username: "membertwo", discord: { id: "discord-222" } });
    const started = f.accounts.beginTwitchVerification(invite.ticket);
    f.accounts.completeTwitchVerification(invite.ticket, started.state, { id: "twitch-222" });
    f.accounts.completeFirstTimePassword(invite.ticket, "original-password-123");
    const reset = f.accounts.createDmPasswordReset("membertwo");
    assert.ok(reset);
    assert.equal(reset.discordUserId, "discord-222");
    f.accounts.openDmPasswordReset(reset.ticket);
    f.accounts.completeDmPasswordReset(reset.ticket, "replacement-password-456");
    assert.throws(() => f.data.login("membertwo", "original-password-123", ["workspace:read"]));
    assert.equal(f.data.login("membertwo", "replacement-password-456", ["workspace:read"]).profile.userId, invite.account.userId);
    assert.throws(() => f.accounts.completeDmPasswordReset(reset.ticket, "replacement-password-789"), /already used/);
  } finally { f.close(); }
});

test("tenant ownership and pre-linked provider identity never silently merge different accounts", () => {
  const f = fixture();
  try {
    const a = f.accounts.provisionAccount({ tenantId: "tenant-one", sourceAppId: "nebula-arcade", username: "one" });
    const b = f.accounts.provisionAccount({ tenantId: "tenant-two", sourceAppId: "nebula-arcade", username: "two", discord: { id: "discord-existing" } });
    assert.notEqual(a.userId, b.userId);
    assert.throws(() => f.accounts.provisionAccount({ tenantId: "tenant-one", sourceAppId: "spacemountain", discord: { id: "discord-existing" } }), /migration review/);
  } finally { f.close(); }
});
