import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAsyncJsonRecordStore } from "../packages/async-json-store/factory.mjs";
import { readNebulaTabletopSnapshot, importNebulaTabletopSnapshot } from "../scripts/migrate-nebula-tabletop-to-turso.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nebula-tabletop-migration-"));
  const sourcePath = join(directory, "source.sqlite");
  const destinationPath = join(directory, "destination.sqlite");
  const db = new DatabaseSync(sourcePath);
  db.exec(`
    CREATE TABLE nebula_tabletop(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,game_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,channel_id,game_id));
    CREATE TABLE nebula_tabletop_receipts(tenant_id TEXT NOT NULL,input_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(tenant_id,input_id));
    CREATE TABLE nebula_quackverse_trade_receipts(tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,request_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(tenant_id,actor_id,request_id));
    CREATE TABLE nebula_media_outbox(tenant_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,id));
    CREATE TABLE nebula_game_runtime(tenant_id TEXT NOT NULL,runtime_key TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,runtime_key));
  `);
  db.prepare("INSERT INTO nebula_tabletop VALUES(?,?,?,?)").run("tenant-a", "room-a", "shared-bingo", JSON.stringify({ boardId: "room-a:2026-11-05" }));
  db.prepare("INSERT INTO nebula_tabletop_receipts VALUES(?,?,?)").run("tenant-a", "twitch:conn:message-1", "Bingo claimed");
  db.prepare("INSERT INTO nebula_quackverse_trade_receipts VALUES(?,?,?,?)").run("tenant-a", "alice", "request-1", JSON.stringify({ status: "offered" }));
  db.prepare("INSERT INTO nebula_media_outbox VALUES(?,?,?,?,?,?)").run("tenant-a", "twitch:conn:pack-1", "pack", JSON.stringify({ userId: "alice" }), "pending", "2026-11-05T12:00:00.000Z");
  db.prepare("INSERT INTO nebula_game_runtime VALUES(?,?,?,?)").run("tenant-a", "default", JSON.stringify({ schemaVersion: 1, channels: {}, players: {}, ledger: [], processedCommandIds: [], checkinBonusReceipts: {} }), "2026-11-05T12:00:00.000Z");
  db.close();
  const store = createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "sqlite", databasePath: destinationPath });
  await store.initialize();
  return { directory, sourcePath, destinationPath, store, async close() { await store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("Nebula tabletop importer produces deterministic read-only snapshot and imports every coupled namespace", async () => {
  const t = await fixture();
  try {
    const db = new DatabaseSync(t.sourcePath, { readOnly: true });
    const first = readNebulaTabletopSnapshot(db, "tenant-a");
    const second = readNebulaTabletopSnapshot(db, "tenant-a");
    db.close();
    assert.equal(first.digest, second.digest);
    assert.deepEqual(first.counts, { tabletop: 1, commandReceipts: 1, tradeReceipts: 1, mediaOutbox: 1, gameRuntime: 1 });
    const imported = await importNebulaTabletopSnapshot(t.store, first, "migration-a");
    assert.equal(imported.imported, true);
    assert.deepEqual(imported.verified, {
      "tabletop-state": 1,
      "tabletop-command-receipts": 1,
      "quackverse-trade-receipts": 1,
      "tabletop-media-outbox": 1,
    });
    assert.deepEqual(await t.store.get("tabletop-command-receipts", "tenant-a", "twitch:conn:message-1"), { result: "Bingo claimed" });
    assert.equal((await t.store.get("tabletop-media-outbox", "tenant-a", "twitch:conn:pack-1")).status, "pending");
    assert.equal((await importNebulaTabletopSnapshot(t.store, first, "migration-a")).duplicate, true);
  } finally { await t.close(); }
});

test("Nebula tabletop importer refuses populated destinations and mismatched game runtime without partial writes", async () => {
  const t = await fixture();
  try {
    const db = new DatabaseSync(t.sourcePath, { readOnly: true });
    const snapshot = readNebulaTabletopSnapshot(db, "tenant-a");
    db.close();
    await t.store.put("tabletop-state", "tenant-a", "occupied", { value: true });
    await assert.rejects(importNebulaTabletopSnapshot(t.store, snapshot, "migration-a"), /destination is not empty/);
    await t.store.delete("tabletop-state", "tenant-a", "occupied");
    await t.store.put("game-runtime", "tenant-a", "default", { state: { schemaVersion: 1, channels: {}, players: {}, ledger: [], processedCommandIds: ["different"], checkinBonusReceipts: {} }, updatedAt: "2026-11-05T12:00:00.000Z" });
    await assert.rejects(importNebulaTabletopSnapshot(t.store, snapshot, "migration-a"), /differs from the tabletop source snapshot/);
    assert.equal((await t.store.list("tabletop-state", "tenant-a")).length, 0);
    assert.equal((await t.store.list("tabletop-migrations", "tenant-a")).length, 0);
  } finally { await t.close(); }
});
