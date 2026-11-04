import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateNebulaGameMixTable } from "../scripts/migrate-nebula-game-mixes-to-turso.mjs";

const COLUMNS = ["tenant_id", "mix_id", "name", "mode", "rotation_seconds", "active_game_id", "layers", "created_at", "updated_at", "activity_box"];
const sample = ["tenant-a", "mix-1", "Main mix", "simultaneous", 20, null, '[{"gameId":"tag","enabled":true}]', "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", 1];

class FakeTurso {
  constructor({ exists = false, columns = COLUMNS, rows = [] } = {}) { this.exists = exists; this.columns = [...columns]; this.rows = rows.map((row) => [...row]); }
  async execute(sql, args = []) {
    if (sql.startsWith("SELECT name FROM sqlite_master")) return { rows: this.exists ? [["nebula_game_mixes"]] : [] };
    if (sql.startsWith("PRAGMA table_info")) return { rows: this.columns.map((name, index) => [index, name, "TEXT", name === "active_game_id" ? 0 : 1, null, name === "tenant_id" ? 1 : name === "mix_id" ? 2 : 0]) };
    if (sql.startsWith("SELECT COUNT(*)")) return { rows: [[this.rows.length]] };
    if (sql.startsWith("CREATE TABLE")) { this.exists = true; this.columns = [...COLUMNS]; return { rows: [], affectedRows: 0 }; }
    if (sql.startsWith("ALTER TABLE")) { this.columns.push("activity_box"); this.rows = this.rows.map((row) => [...row, 0]); return { rows: [], affectedRows: 0 }; }
    if (sql.startsWith("SELECT tenant_id,mix_id")) return { rows: this.rows.map((row) => [...row]) };
    throw new Error("Unexpected SQL: " + sql);
  }
  async transaction(callback) {
    const snapshot = this.rows.map((row) => [...row]);
    try { return await callback({ execute: async (_sql, values) => { this.rows.push([...values]); return { rows: [], affectedRows: 1 }; } }); }
    catch (error) { this.rows = snapshot; throw error; }
  }
}

function sourceFixture({ activityBox = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "nebula-game-mix-import-"));
  const path = join(directory, "source.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE nebula_game_mixes (
    tenant_id TEXT NOT NULL, mix_id TEXT NOT NULL, name TEXT NOT NULL, mode TEXT NOT NULL,
    rotation_seconds INTEGER NOT NULL, active_game_id TEXT, layers TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    ${activityBox ? "activity_box INTEGER NOT NULL DEFAULT 0," : ""}
    PRIMARY KEY (tenant_id, mix_id)
  )`);
  const columns = ["tenant_id", "mix_id", "name", "mode", "rotation_seconds", "active_game_id", "layers", "created_at", "updated_at", ...(activityBox ? ["activity_box"] : [])];
  const placeholders = columns.map(() => "?").join(",");
  db.prepare(`INSERT INTO nebula_game_mixes(${columns.join(",")}) VALUES(${placeholders})`).run(...(activityBox ? sample : sample.slice(0, 9)));
  db.close();
  return { directory, path };
}

test("Game Mix importer dry-runs without writing to Turso", async () => {
  const source = sourceFixture();
  const destination = new FakeTurso();
  try {
    const result = await migrateNebulaGameMixTable({ sourcePath: source.path, adapter: destination });
    assert.equal(result.sourceCount, 1);
    assert.equal(result.applied, false);
    assert.equal(destination.exists, false);
    assert.equal(destination.rows.length, 0);
  } finally { rmSync(source.directory, { recursive: true, force: true }); }
});

test("Game Mix importer refuses a non-empty target table without changing it", async () => {
  const source = sourceFixture();
  const destination = new FakeTurso({ exists: true, rows: [sample] });
  try {
    await assert.rejects(() => migrateNebulaGameMixTable({ sourcePath: source.path, adapter: destination, apply: true }), /already contains 1 row/);
    assert.equal(destination.rows.length, 1);
  } finally { rmSync(source.directory, { recursive: true, force: true }); }
});

test("Game Mix importer creates an isolated target table, copies rows and verifies the hash", async () => {
  const source = sourceFixture();
  const destination = new FakeTurso();
  try {
    const before = new DatabaseSync(source.path, { readOnly: true }).prepare("SELECT COUNT(*) AS count FROM nebula_game_mixes").get().count;
    const result = await migrateNebulaGameMixTable({ sourcePath: source.path, adapter: destination, apply: true });
    assert.equal(result.applied, true);
    assert.equal(result.verified, true);
    assert.equal(result.destinationCount, 1);
    assert.equal(destination.exists, true);
    assert.deepEqual(destination.rows[0], sample);
    const afterDb = new DatabaseSync(source.path, { readOnly: true });
    assert.equal(afterDb.prepare("SELECT COUNT(*) AS count FROM nebula_game_mixes").get().count, before);
    afterDb.close();
  } finally { rmSync(source.directory, { recursive: true, force: true }); }
});

test("Game Mix importer maps legacy rows without activity_box to the canonical default", async () => {
  const source = sourceFixture({ activityBox: false });
  const destination = new FakeTurso();
  try {
    const result = await migrateNebulaGameMixTable({ sourcePath: source.path, adapter: destination, apply: true });
    assert.equal(result.verified, true);
    assert.equal(destination.rows[0][9], 0);
  } finally { rmSync(source.directory, { recursive: true, force: true }); }
});
