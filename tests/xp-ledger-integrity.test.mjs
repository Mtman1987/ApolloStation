import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-xp-integrity-"));
  return { dir, path: join(dir, "authority.db") };
}

function derived(events) {
  return {
    spendableXp: Math.max(0, events.reduce((sum, event) => sum + event.delta, 0)),
    lifetimeXp: Math.max(0, events.reduce((sum, event) => sum + (event.delta > 0 && event.metadata?.lifetimeEligible !== false ? event.delta : 0), 0)),
  };
}

test("XP wallet is reconciled from the append-only canonical ledger rather than a mutable projection", () => {
  const { dir, path } = tempDb();
  try {
    let store = new SqliteAuthorityStore(path);
    let authority = new AuthorityService({ store });
    authority.awardXp({ tenantId: "tenant-a", userId: "user-a", delta: 100, sourceAppId: "dsh", reason: "support", idempotencyKey: "award-1" });
    authority.spendXp({ tenantId: "tenant-a", userId: "user-a", amount: 30, sourceAppId: "shipyard", idempotencyKey: "spend-1" });
    authority.awardXp({ tenantId: "tenant-a", userId: "user-a", delta: 20, sourceAppId: "migration", reason: "migration-adjustment", idempotencyKey: "adjust-1", metadata: { lifetimeEligible: false } });

    const ledger = authority.listXpLedger("tenant-a", "user-a", 100).reverse();
    const expected = derived(ledger);
    const wallet = authority.getXpWallet("tenant-a", "user-a");
    assert.equal(wallet.spendableXp, expected.spendableXp);
    assert.equal(wallet.lifetimeXp, expected.lifetimeXp);
    assert.equal(wallet.currentXp, expected.spendableXp);
    assert.equal(wallet.totalXp, expected.lifetimeXp);
    assert.equal(wallet.spendableXp, 90);
    assert.equal(wallet.lifetimeXp, 100);
    store.close();

    store = new SqliteAuthorityStore(path);
    authority = new AuthorityService({ store });
    const reopenedLedger = authority.listXpLedger("tenant-a", "user-a", 100).reverse();
    const reopenedExpected = derived(reopenedLedger);
    const reopenedWallet = authority.getXpWallet("tenant-a", "user-a");
    assert.equal(reopenedWallet.spendableXp, reopenedExpected.spendableXp);
    assert.equal(reopenedWallet.lifetimeXp, reopenedExpected.lifetimeXp);
    assert.deepEqual(reopenedWallet, wallet);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("XP reconciliation stays tenant-isolated and never maxes or sums another tenant's balance", () => {
  const { dir, path } = tempDb();
  try {
    const store = new SqliteAuthorityStore(path);
    const authority = new AuthorityService({ store });
    authority.awardXp({ tenantId: "tenant-a", userId: "same-user", delta: 10, sourceAppId: "dsh", reason: "a", idempotencyKey: "a-1" });
    authority.awardXp({ tenantId: "tenant-b", userId: "same-user", delta: 1000, sourceAppId: "dsh", reason: "b", idempotencyKey: "b-1" });
    assert.equal(authority.getXpWallet("tenant-a", "same-user").spendableXp, 10);
    assert.equal(authority.getXpWallet("tenant-b", "same-user").spendableXp, 1000);
    assert.equal(authority.listXpLedger("tenant-a", "same-user", 100).length, 1);
    assert.equal(authority.listXpLedger("tenant-b", "same-user", 100).length, 1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
