import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityConflictError, AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-authority-"));
  return { dir, path: join(dir, "authority.db") };
}

test("SQLite authority survives reopen with workspace, XP, idempotency, and journal intact", () => {
  const { dir, path } = tempDb();
  try {
    let store = new SqliteAuthorityStore(path);
    let authority = new AuthorityService({ store, idFactory: (prefix) => `${prefix}_fixed` });
    authority.ensureUser("user-a");
    authority.linkProvider("user-a", "twitch", "123");
    authority.getOrCreateWorkspace("tenant-a");
    authority.updateWorkspace("tenant-a", 1, { appearance: { theme: "dark" } });
    const award = { tenantId: "tenant-a", userId: "user-a", delta: 10, sourceAppId: "nebula-arcade", reason: "test", idempotencyKey: "award-1" };
    assert.equal(authority.awardXp(award).duplicate, false);
    assert.equal(authority.awardXp(award).duplicate, true);
    const before = store.listJournal();
    assert.ok(before.length >= 5);
    store.close();

    store = new SqliteAuthorityStore(path);
    authority = new AuthorityService({ store, idFactory: (prefix) => `${prefix}_after` });
    assert.equal(authority.getXpBalance("tenant-a", "user-a"), 10);
    assert.equal(authority.awardXp(award).duplicate, true);
    assert.equal(store.getWorkspace("tenant-a")?.appearance.theme, "dark");
    assert.equal(store.getProviderLink("twitch", "123")?.userId, "user-a");
    assert.equal(authority.listProviderLinks("user-a").length, 1);
    authority.unlinkProvider("user-a", "twitch", "123");
    assert.equal(authority.listProviderLinks("user-a").length, 0);
    store.close();

    store = new SqliteAuthorityStore(path);
    authority = new AuthorityService({ store });
    assert.equal(authority.listProviderLinks("user-a").length, 0);
    assert.ok(store.getProviderLink("twitch", "123")?.revokedAt);
    assert.equal(store.listJournal().length, before.length + 1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("authority epoch only moves forward and new journal entries carry promoted epoch", () => {
  const { dir, path } = tempDb();
  try {
    const store = new SqliteAuthorityStore(path);
    const authority = new AuthorityService({ store });
    assert.equal(store.getAuthorityEpoch(), 1);
    assert.equal(store.promoteAuthorityEpoch(2), 2);
    assert.throws(() => store.promoteAuthorityEpoch(2), AuthorityConflictError);
    authority.getOrCreateWorkspace("tenant-b");
    assert.equal(store.listJournal().at(-1)?.epoch, 2);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default authority IDs remain unique after a persistent store reopens", () => {
  const { dir, path } = tempDb();
  try {
    let store = new SqliteAuthorityStore(path);
    let authority = new AuthorityService({ store, now: () => "2026-08-24T12:00:00.000Z" });
    const first = authority.audit({ actorType: "user", actorId: "owner", action: "workspace.update", target: "tenant-a", outcome: "accepted", tenantId: "tenant-a" });
    store.close();

    store = new SqliteAuthorityStore(path);
    authority = new AuthorityService({ store, now: () => "2026-08-24T12:01:00.000Z" });
    const second = authority.audit({ actorType: "user", actorId: "owner", action: "workspace.update", target: "tenant-a", outcome: "accepted", tenantId: "tenant-a" });
    assert.notEqual(second.id, first.id);
    assert.equal(store.listAudit("tenant-a").length, 2);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
