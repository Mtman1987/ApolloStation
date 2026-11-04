import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteJsonRecordStore, TursoJsonRecordStore } from "../packages/async-json-store/index.mjs";

class FakeTursoAdapter {
  rows = new Map();
  async execute(sql, args = []) {
    if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) return { rows: [], affectedRows: 0 };
    if (sql === "SELECT 1") return { rows: [[1]], affectedRows: 0 };
    if (sql.startsWith("SELECT body FROM")) {
      const value = this.rows.get([args[0], args[1], args[2]].join("\0"));
      return { rows: value === undefined ? [] : [[value]], affectedRows: 0 };
    }
    if (sql.startsWith("INSERT INTO")) {
      this.rows.set([args[0], args[1], args[2]].join("\0"), args[3]);
      return { rows: [], affectedRows: 1 };
    }
    if (sql.startsWith("DELETE FROM")) {
      const changed = this.rows.delete([args[0], args[1], args[2]].join("\0"));
      return { rows: [], affectedRows: changed ? 1 : 0 };
    }
    if (sql.startsWith("SELECT record_key,body FROM")) {
      const prefix = [args[0], args[1]].join("\0") + "\0";
      const rows = [...this.rows.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, body]) => [key.slice(prefix.length), body])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return { rows, affectedRows: 0 };
    }
    throw new Error("Unexpected SQL in fake Turso adapter: " + sql);
  }
  async transaction(work) {
    const snapshot = new Map(this.rows);
    try { return await work({ execute: (...args) => this.execute(...args) }); }
    catch (error) { this.rows = snapshot; throw error; }
  }
}

async function exerciseStore(store) {
  await store.initialize();
  assert.deepEqual(await store.health(), { ready: true });
  await store.put("players", "tenant-a", "player-1", { score: 10, tags: ["first"] });
  await store.put("players", "tenant-a", "player-1", { score: 15, tags: ["first", "second"] });
  await store.put("players", "tenant-b", "player-1", { score: 999 });
  assert.deepEqual(await store.get("players", "tenant-a", "player-1"), { score: 15, tags: ["first", "second"] });
  assert.deepEqual(await store.get("players", "tenant-b", "player-1"), { score: 999 });
  assert.deepEqual(await store.list("players", "tenant-a"), [
    { key: "player-1", value: { score: 15, tags: ["first", "second"] } },
  ]);
  await assert.rejects(store.transaction(async (tx) => {
    await tx.put("players", "tenant-a", "rollback", { score: 1 });
    throw new Error("abort transaction");
  }), /abort transaction/);
  assert.equal(await store.get("players", "tenant-a", "rollback"), undefined);
  const result = await store.transaction(async (tx) => {
    await tx.put("players", "tenant-a", "player-2", { score: 20 });
    await tx.put("players", "tenant-a", "player-3", { score: 30 });
    return "committed";
  });
  assert.equal(result, "committed");
  assert.equal((await store.list("players", "tenant-a")).length, 3);
  assert.equal(await store.delete("players", "tenant-a", "player-2"), 1);
  assert.equal(await store.get("players", "tenant-a", "player-2"), undefined);
}

test("async JSON record store contract passes on local SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-async-store-"));
  const store = new SqliteJsonRecordStore(join(directory, "records.sqlite"));
  try { await exerciseStore(store); }
  finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("async JSON record store contract passes against the Turso adapter boundary", async () => {
  await exerciseStore(new TursoJsonRecordStore(new FakeTursoAdapter()));
});

test("async JSON record store rejects use before initialization and invalid tenant keys", async () => {
  const store = new TursoJsonRecordStore(new FakeTursoAdapter());
  await assert.rejects(store.get("players", "tenant-a", "player-1"), /not been initialized/);
  await store.initialize();
  await assert.rejects(store.put("players", "", "player-1", {}), /tenantId/);
});
