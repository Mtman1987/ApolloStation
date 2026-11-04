import { DatabaseSync } from "node:sqlite";

export interface StreamWeaverBicVictimV1 { name: string; displayName: string; count: number; }
export interface StreamWeaverBicSnapshotV1 { tenantId: string; total: number; victims: StreamWeaverBicVictimV1[]; blacklist: string[]; }
export interface StreamWeaverBicMutationV1 { tenantId: string; target: string; displayName: string; total: number; userCount: number; duplicate: boolean; }
export interface StreamWeaverLegacyBicDataV1 { total: number; victims: Record<string, number>; blacklist?: string[]; }

type StoredMutation = Omit<StreamWeaverBicMutationV1, "duplicate">;

/** Tenant-isolated replacement for the donor global JSON/Streamer.bot Bic counters. */
export class SqliteStreamWeaverBicStore {
  private readonly db: DatabaseSync;
  constructor(databasePath: string) {
    if (!databasePath) throw new Error("StreamWeaver Bic database path is required");
    this.db = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streamweaver_bic_state(
        tenant_id TEXT PRIMARY KEY,
        total INTEGER NOT NULL CHECK(total >= 0)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_bic_victims(
        tenant_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        count INTEGER NOT NULL CHECK(count >= 0),
        PRIMARY KEY(tenant_id, username)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS streamweaver_bic_victims_rank ON streamweaver_bic_victims(tenant_id, count DESC, username);
      CREATE TABLE IF NOT EXISTS streamweaver_bic_blacklist(
        tenant_id TEXT NOT NULL,
        username TEXT NOT NULL,
        PRIMARY KEY(tenant_id, username)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_bic_operations(
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY(tenant_id, idempotency_key)
      ) STRICT;
    `);
  }
  close(): void { this.db.close(); }

  steal(tenantId: string, target: string, displayName: string, idempotencyKey: string): StreamWeaverBicMutationV1 {
    return this.mutate("steal", tenantId, target, displayName, idempotencyKey);
  }

  remove(tenantId: string, target: string, displayName: string, idempotencyKey: string): StreamWeaverBicMutationV1 {
    return this.mutate("remove", tenantId, target, displayName, idempotencyKey);
  }

  snapshot(tenantId: string): StreamWeaverBicSnapshotV1 {
    const tenant = safeId(tenantId, "tenantId");
    const state = this.db.prepare("SELECT total FROM streamweaver_bic_state WHERE tenant_id=?").get(tenant) as { total: number } | undefined;
    const victims = (this.db.prepare("SELECT username,display_name,count FROM streamweaver_bic_victims WHERE tenant_id=? AND count>0 ORDER BY count DESC,username").all(tenant) as Array<{ username: string; display_name: string; count: number }>).map((row) => ({ name: row.username, displayName: row.display_name, count: row.count }));
    const blacklist = (this.db.prepare("SELECT username FROM streamweaver_bic_blacklist WHERE tenant_id=? ORDER BY username").all(tenant) as Array<{ username: string }>).map((row) => row.username);
    return { tenantId: tenant, total: state?.total ?? 0, victims, blacklist };
  }

  isBlacklisted(tenantId: string, target: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM streamweaver_bic_blacklist WHERE tenant_id=? AND username=?").get(safeId(tenantId, "tenantId"), safeName(target)));
  }

  addToBlacklist(tenantId: string, target: string): boolean {
    const result = this.db.prepare("INSERT OR IGNORE INTO streamweaver_bic_blacklist(tenant_id,username) VALUES(?,?)").run(safeId(tenantId, "tenantId"), safeName(target));
    return Number(result.changes) > 0;
  }

  removeFromBlacklist(tenantId: string, target: string): boolean {
    const result = this.db.prepare("DELETE FROM streamweaver_bic_blacklist WHERE tenant_id=? AND username=?").run(safeId(tenantId, "tenantId"), safeName(target));
    return Number(result.changes) > 0;
  }

  /** One-time donor import: keep existing Green victims, add missing donor victims, use the higher total, merge blacklist. */
  importLegacy(tenantId: string, legacy: StreamWeaverLegacyBicDataV1, idempotencyKey: string): { imported: number; snapshot: StreamWeaverBicSnapshotV1; duplicate: boolean } {
    const tenant = safeId(tenantId, "tenantId");
    const key = safeKey(idempotencyKey);
    const operationKey = `migration:${key}`;
    const existing = this.operation(tenant, operationKey) as { imported?: number } | undefined;
    if (existing) return { imported: Number(existing.imported ?? 0), snapshot: this.snapshot(tenant), duplicate: true };
    let imported = 0;
    this.transaction(() => {
      for (const [rawName, rawCount] of Object.entries(legacy.victims ?? {})) {
        const name = safeName(rawName);
        const count = positiveInt(rawCount);
        if (!name || count <= 0) continue;
        const row = this.db.prepare("SELECT count FROM streamweaver_bic_victims WHERE tenant_id=? AND username=?").get(tenant, name) as { count: number } | undefined;
        if (row) continue;
        this.db.prepare("INSERT INTO streamweaver_bic_victims(tenant_id,username,display_name,count) VALUES(?,?,?,?)").run(tenant, name, name, count);
        imported += count;
      }
      const current = (this.db.prepare("SELECT total FROM streamweaver_bic_state WHERE tenant_id=?").get(tenant) as { total: number } | undefined)?.total ?? 0;
      const total = Math.max(current, positiveInt(legacy.total));
      this.db.prepare("INSERT INTO streamweaver_bic_state(tenant_id,total) VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET total=excluded.total").run(tenant, total);
      for (const raw of legacy.blacklist ?? []) {
        const name = safeName(raw);
        if (name) this.db.prepare("INSERT OR IGNORE INTO streamweaver_bic_blacklist(tenant_id,username) VALUES(?,?)").run(tenant, name);
      }
      this.putOperation(tenant, operationKey, { imported });
    });
    return { imported, snapshot: this.snapshot(tenant), duplicate: false };
  }

  private mutate(kind: "steal" | "remove", tenantId: string, target: string, displayName: string, idempotencyKey: string): StreamWeaverBicMutationV1 {
    const tenant = safeId(tenantId, "tenantId");
    const username = safeName(target);
    const display = safeDisplay(displayName || target);
    const key = safeKey(idempotencyKey);
    const prior = this.operation(tenant, key) as StoredMutation | undefined;
    if (prior) return { ...prior, duplicate: true };
    let mutation: StoredMutation | undefined;
    this.transaction(() => {
      const duplicate = this.operation(tenant, key) as StoredMutation | undefined;
      if (duplicate) { mutation = duplicate; return; }
      if (kind === "steal" && this.isBlacklisted(tenant, username)) throw new Error(`${display} is protected from Bic thefts`);
      const state = this.db.prepare("SELECT total FROM streamweaver_bic_state WHERE tenant_id=?").get(tenant) as { total: number } | undefined;
      const victim = this.db.prepare("SELECT count FROM streamweaver_bic_victims WHERE tenant_id=? AND username=?").get(tenant, username) as { count: number } | undefined;
      const total = kind === "steal" ? (state?.total ?? 0) + 1 : Math.max(0, (state?.total ?? 0) - 1);
      const userCount = kind === "steal" ? (victim?.count ?? 0) + 1 : Math.max(0, (victim?.count ?? 0) - 1);
      this.db.prepare("INSERT INTO streamweaver_bic_state(tenant_id,total) VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET total=excluded.total").run(tenant, total);
      if (userCount > 0) this.db.prepare("INSERT INTO streamweaver_bic_victims(tenant_id,username,display_name,count) VALUES(?,?,?,?) ON CONFLICT(tenant_id,username) DO UPDATE SET display_name=excluded.display_name,count=excluded.count").run(tenant, username, display, userCount);
      else this.db.prepare("DELETE FROM streamweaver_bic_victims WHERE tenant_id=? AND username=?").run(tenant, username);
      mutation = { tenantId: tenant, target: username, displayName: display, total, userCount };
      this.putOperation(tenant, key, mutation);
    });
    if (!mutation) throw new Error("Bic mutation did not complete");
    return { ...mutation, duplicate: false };
  }

  private operation(tenantId: string, key: string): Record<string, unknown> | undefined {
    const row = this.db.prepare("SELECT body FROM streamweaver_bic_operations WHERE tenant_id=? AND idempotency_key=?").get(tenantId, key) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as Record<string, unknown> : undefined;
  }
  private putOperation(tenantId: string, key: string, body: unknown): void {
    this.db.prepare("INSERT INTO streamweaver_bic_operations(tenant_id,idempotency_key,body) VALUES(?,?,?)").run(tenantId, key, JSON.stringify(body));
  }
  private transaction(work: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try { work(); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

function safeId(value: unknown, field: string): string { const result = String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 180); if (!result) throw new Error(`${field} is required`); return result; }
function safeKey(value: unknown): string { const result = String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 240); if (!result) throw new Error("idempotencyKey is required"); return result; }
function safeName(value: unknown): string { const result = String(value ?? "").trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 80); if (!result) throw new Error("Bic target is required"); return result; }
function safeDisplay(value: unknown): string { return String(value ?? "").trim().replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 120) || "unknown"; }
function positiveInt(value: unknown): number { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0; }
