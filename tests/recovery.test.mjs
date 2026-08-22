import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { SqliteRecoverySource, verifySqliteRecoverySnapshot } from "../packages/authority-sqlite/dist/recovery.js";
import { FileRecoveryVault, RecoveryVerificationError } from "../packages/recovery-core/dist/index.js";

function populate(path) {
  const store = new SqliteAuthorityStore(path);
  const authority = new AuthorityService({ store, now: () => "2026-08-22T02:36:00.000Z" });
  authority.linkProvider("user-1", "twitch", "tw-1");
  authority.getOrCreateWorkspace("tenant-a");
  authority.awardXp({ tenantId: "tenant-a", userId: "user-1", delta: 25, sourceAppId: "streamweaver", reason: "support", idempotencyKey: "award-1" });
  const auth = new AuthService({ store, now: () => "2026-08-22T02:36:00.000Z" });
  auth.registerServiceIdentity({ serviceId: "streamweaver", credential: "streamweaver-green-secret-123456", scopes: ["xp:write"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  store.promoteAuthorityEpoch(2);
  store.close();
}

test("vault captures an authenticated encrypted SQLite recovery point and restores it to a fresh file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-vault-"));
  const sourcePath = join(dir, "authority.db");
  const vaultDir = join(dir, "vault");
  const restoredPath = join(dir, "restored.db");
  populate(sourcePath);

  const vault = new FileRecoveryVault({
    rootDir: vaultDir,
    key: Buffer.alloc(32, 7),
    source: new SqliteRecoverySource(sourcePath),
    now: () => "2026-08-22T02:37:00.000Z",
    idFactory: () => "rp_test_001",
  });
  const manifest = await vault.capture();
  assert.equal(manifest.metadata.authorityEpoch, 2);
  assert.equal(manifest.metadata.inventory.users, 1);
  assert.equal(manifest.metadata.inventory.xpEvents, 1);
  assert.equal(manifest.metadata.inventory.serviceIdentities, 1);
  const encrypted = readFileSync(join(vaultDir, "rp_test_001.snapshot.enc"));
  assert.equal(encrypted.includes(Buffer.from("tenant-a")), false);
  const verification = await vault.verify("rp_test_001");
  assert.equal(verification.verified, true);
  await vault.materialize("rp_test_001", restoredPath);
  const restoredDescriptor = verifySqliteRecoverySnapshot(restoredPath);
  assert.deepEqual(restoredDescriptor.inventory, manifest.metadata.inventory);
  assert.equal(restoredDescriptor.authorityEpoch, 2);

  const restored = new SqliteAuthorityStore(restoredPath);
  assert.equal(restored.getWorkspace("tenant-a")?.tenantId, "tenant-a");
  assert.equal(restored.listXp("tenant-a", "user-1").length, 1);
  assert.equal(restored.getServiceIdentity("streamweaver")?.id, "streamweaver");
  restored.promoteAuthorityEpoch(3);
  assert.equal(restored.getAuthorityEpoch(), 3);
  restored.close();
  rmSync(dir, { recursive: true, force: true });
});

test("vault rejects tampered encrypted recovery points before materialization", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-vault-"));
  const sourcePath = join(dir, "authority.db");
  const vaultDir = join(dir, "vault");
  populate(sourcePath);
  const vault = new FileRecoveryVault({
    rootDir: vaultDir,
    key: Buffer.alloc(32, 9),
    source: new SqliteRecoverySource(sourcePath),
    idFactory: () => "rp_test_002",
  });
  await vault.capture();
  const cipherPath = join(vaultDir, "rp_test_002.snapshot.enc");
  const bytes = readFileSync(cipherPath);
  bytes[0] = bytes[0] ^ 0xff;
  writeFileSync(cipherPath, bytes);
  await assert.rejects(() => vault.verify("rp_test_002"), RecoveryVerificationError);
  await assert.rejects(() => vault.materialize("rp_test_002", join(dir, "should-not-exist.db")), RecoveryVerificationError);
  rmSync(dir, { recursive: true, force: true });
});
