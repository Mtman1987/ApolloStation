import { DatabaseSync } from "node:sqlite";
import {
  defaultNebulaGameRuntimeState,
  normalizeNebulaGameRuntimeState,
  type NebulaGameRuntimeStateV1,
} from "./game-runtime.js";
import { migrateLegacyNebulaArcadeStorage } from "./legacy-nebula-migration.js";

export class SqliteNebulaGameRuntimeStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (!path) throw new Error("Nebula game runtime database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    migrateLegacyNebulaArcadeStorage(this.db);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS nebula_game_runtime (
        tenant_id TEXT NOT NULL,
        runtime_key TEXT NOT NULL,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, runtime_key)
      ) STRICT;
    `);
  }

  close(): void { this.db.close(); }

  get(tenantId: string, runtimeKey = "default"): NebulaGameRuntimeStateV1 {
    const tenant = cleanId(tenantId, "tenantId");
    const key = cleanId(runtimeKey, "runtimeKey");
    const row = this.db.prepare("SELECT body FROM nebula_game_runtime WHERE tenant_id=? AND runtime_key=?").get(tenant, key) as { body: string } | undefined;
    if (!row) return defaultNebulaGameRuntimeState();
    try { return normalizeNebulaGameRuntimeState(JSON.parse(row.body) as Partial<NebulaGameRuntimeStateV1>); }
    catch { return defaultNebulaGameRuntimeState(); }
  }

  put(tenantId: string, state: NebulaGameRuntimeStateV1, runtimeKey = "default", now = new Date()): NebulaGameRuntimeStateV1 {
    const tenant = cleanId(tenantId, "tenantId");
    const key = cleanId(runtimeKey, "runtimeKey");
    if (!Number.isFinite(now.getTime())) throw new Error("Nebula game runtime timestamp is invalid");
    const normalized = normalizeNebulaGameRuntimeState(state);
    this.db.prepare(`
      INSERT INTO nebula_game_runtime(tenant_id,runtime_key,body,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(tenant_id,runtime_key) DO UPDATE SET
        body=excluded.body,
        updated_at=excluded.updated_at
    `).run(tenant, key, JSON.stringify(normalized), now.toISOString());
    return structuredClone(normalized);
  }

  update<T>(tenantId: string, mutate: (state: NebulaGameRuntimeStateV1) => T, runtimeKey = "default", now = new Date()): { state: NebulaGameRuntimeStateV1; result: T } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.get(tenantId, runtimeKey);
      const result = mutate(state);
      const saved = this.put(tenantId, state, runtimeKey, now);
      this.db.exec("COMMIT");
      return { state: saved, result };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function cleanId(value: string, name: string) {
  const clean = String(value ?? "").trim();
  if (!clean || clean.length > 180 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`);
  return clean;
}
