import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNebulaTagState } from "../apps/nebula-arcade/dist/index.js";
import { readLegacyTagSnapshots } from "../scripts/migrate-nebula-tag-to-turso.mjs";

test("legacy Tag snapshot reader extracts state, command receipts and pending outbox read-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nebula-tag-import-source-"));
  const path = join(directory, "source.sqlite");
  const writable = new DatabaseSync(path);
  try {
    writable.exec(`
      CREATE TABLE nebula_tag_state(tenant_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE nebula_tag_commands(tenant_id TEXT NOT NULL,command_id TEXT NOT NULL,occurred_at TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(tenant_id,command_id));
      CREATE TABLE nebula_tag_outbox(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,command_id TEXT NOT NULL,created_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,result TEXT NOT NULL,UNIQUE(tenant_id,command_id));
    `);
    const state = createNebulaTagState("tenant-import-reader");
    const result = { schemaVersion: 1, tenantId: state.tenantId, commandId: "join-one", kind: "join", status: "applied", code: "joined", message: "joined", stateChanged: true };
    writable.prepare("INSERT INTO nebula_tag_state VALUES(?,?,?,?)").run(state.tenantId, 1, "2026-08-23T08:00:00.000Z", JSON.stringify(state));
    writable.prepare("INSERT INTO nebula_tag_commands VALUES(?,?,?,?)").run(state.tenantId, "join-one", "2026-08-23T08:00:00.000Z", JSON.stringify(result));
    writable.prepare("INSERT INTO nebula_tag_outbox VALUES(?,?,?,?,?,?,?)").run("legacy-outbox-id", state.tenantId, "join-one", "2026-08-23T08:00:00.000Z", 2, "temporary error", JSON.stringify(result));
  } finally { writable.close(); }

  const source = new DatabaseSync(path, { readOnly: true });
  try {
    const snapshots = readLegacyTagSnapshots(source);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].tenantId, "tenant-import-reader");
    assert.equal(snapshots[0].revision, 1);
    assert.equal(snapshots[0].commands.length, 1);
    assert.equal(snapshots[0].outbox.length, 1);
    assert.equal(snapshots[0].outbox[0].attempts, 2);
    assert.equal(source.prepare("SELECT COUNT(*) AS count FROM nebula_tag_state").get().count, 1);
  } finally {
    source.close();
    await rm(directory, { recursive: true, force: true });
  }
});
