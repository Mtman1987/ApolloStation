import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import { importNebulaActionActivitySnapshot, readNebulaActionActivitySnapshot } from "../scripts/migrate-nebula-action-activity-to-turso.mjs";

test("Nebula action/activity importer is read-only by default and verifies tenant-scoped records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nebula-action-activity-import-"));
  const sourcePath = join(dir, "source.sqlite"), targetPath = join(dir, "target.sqlite");
  const source = new DatabaseSync(sourcePath);
  source.exec(`
    CREATE TABLE nebula_game_actions(tenant_id TEXT,action_id TEXT,channel TEXT,game_id TEXT,actor_id TEXT,username TEXT,display_name TEXT,action TEXT,args TEXT,message TEXT,occurred_at TEXT);
    CREATE TABLE nebula_arcade_channels(tenant_id TEXT,channel_id TEXT,game_ids TEXT,last_spmt_at INTEGER);
    CREATE TABLE nebula_arcade_members(tenant_id TEXT,channel_id TEXT,actor_id TEXT,game_id TEXT,joined INTEGER,last_seen_at INTEGER);
    CREATE TABLE nebula_arcade_choices(tenant_id TEXT,channel_id TEXT,actor_id TEXT,targets TEXT,expires_at INTEGER);
    INSERT INTO nebula_game_actions VALUES('tenant-a','action-1','room','bingo','spmt:alice','alice','Alice','claim','["1"]','spmt bingo claim 1','2026-11-05T10:00:00.000Z');
    INSERT INTO nebula_arcade_channels VALUES('tenant-a','room','["bingo"]',1000);
    INSERT INTO nebula_arcade_members VALUES('tenant-a','room','spmt:alice','bingo',1,2000);
    INSERT INTO nebula_arcade_choices VALUES('tenant-a','room','spmt:alice','[{"gameId":"bingo","command":"join","args":[]}]',30000);
  `);
  source.close();
  const readOnly = new DatabaseSync(sourcePath, { readOnly: true });
  let snapshot;
  try { snapshot = readNebulaActionActivitySnapshot(readOnly); assert.equal(readOnly.prepare("SELECT COUNT(*) AS n FROM nebula_game_actions").get().n, 1); }
  finally { readOnly.close(); }
  assert.deepEqual(snapshot.counts, { actions: 1, channels: 1, members: 1, choices: 1 });
  const target = createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "sqlite", databasePath: targetPath });
  try {
    await target.initialize();
    const result = await importNebulaActionActivitySnapshot(target, snapshot);
    assert.equal(result.imported, 4);
    assert.equal((await target.list("game-actions", "tenant-a")).length, 1);
    assert.equal((await target.list("arcade-activity-members", "tenant-a"))[0].value.joined, true);
    await assert.rejects(importNebulaActionActivitySnapshot(target, snapshot), /destination is not empty/);
  } finally { await target.close(); await rm(dir, { recursive: true, force: true }); }
});
