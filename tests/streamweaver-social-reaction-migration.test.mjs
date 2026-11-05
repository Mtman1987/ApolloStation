import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAsyncJsonRecordStore } from "../packages/async-json-store/factory.mjs";
import { readStreamWeaverSocialReactionSnapshot, importStreamWeaverSocialReactionSnapshot } from "../scripts/migrate-streamweaver-social-reactions-to-turso.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "streamweaver-social-migration-"));
  const sourcePath = join(directory, "source.sqlite"), destinationPath = join(directory, "destination.sqlite");
  const db = new DatabaseSync(sourcePath);
  db.exec(`CREATE TABLE streamweaver_social_reactions(tenant_id TEXT NOT NULL,delivery_id TEXT NOT NULL,trigger TEXT NOT NULL,actor TEXT NOT NULL,target TEXT NOT NULL,animation_key TEXT NOT NULL,job_id TEXT,reaction TEXT,state TEXT NOT NULL,attempts INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(tenant_id,delivery_id)) STRICT;`);
  db.prepare("INSERT INTO streamweaver_social_reactions VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("tenant-a","d1","!boop","Alice","Bob","boop",null,"Alice boops Bob","ready",1,"2026-11-05T12:00:00.000Z");
  db.prepare("INSERT INTO streamweaver_social_reactions VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("tenant-b","d2","!hug","Bob","Alice","hug","job-2",null,"waiting",2,"2026-11-05T12:01:00.000Z");
  db.close();
  const store = createAsyncJsonRecordStore({ service: "streamweaver", mode: "sqlite", databasePath: destinationPath });
  await store.initialize();
  return { directory, sourcePath, store, async close() { await store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("StreamWeaver social reaction importer snapshots deterministically and imports all tenants", async () => {
  const t = await fixture();
  try {
    const db = new DatabaseSync(t.sourcePath, { readOnly: true });
    const first = readStreamWeaverSocialReactionSnapshot(db), second = readStreamWeaverSocialReactionSnapshot(db);
    db.close();
    assert.equal(first.digest, second.digest);
    assert.deepEqual(first.counts, { reactions: 2, tenants: 2 });
    const result = await importStreamWeaverSocialReactionSnapshot(t.store, first, "migration-a");
    assert.equal(result.imported, true);
    assert.deepEqual(result.verified, { "tenant-a": 1, "tenant-b": 1 });
    assert.equal((await t.store.get("social-reactions", "tenant-b", "d2")).jobId, "job-2");
    assert.equal((await importStreamWeaverSocialReactionSnapshot(t.store, first, "migration-a")).duplicate, true);
    await assert.rejects(importStreamWeaverSocialReactionSnapshot(t.store, { ...first, digest: "other" }, "migration-a"), /different social-reaction source digest/);
  } finally { await t.close(); }
});

test("StreamWeaver social reaction importer refuses populated destinations without partial writes", async () => {
  const t = await fixture();
  try {
    const db = new DatabaseSync(t.sourcePath, { readOnly: true });
    const snapshot = readStreamWeaverSocialReactionSnapshot(db); db.close();
    await t.store.put("social-reactions", "tenant-a", "occupied", { state: "pending" });
    await assert.rejects(importStreamWeaverSocialReactionSnapshot(t.store, snapshot, "migration-a"), /not empty/);
    assert.equal((await t.store.list("social-reactions", "tenant-b")).length, 0);
    assert.equal((await t.store.list("social-reaction-migrations", "_index")).length, 0);
  } finally { await t.close(); }
});
