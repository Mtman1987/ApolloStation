/**
 * Local SQLite -> Turso write-back for SPMT authority and platform stores.
 *
 * The boot-time hydrate (turso-hydrate.ts) restores local state from Turso,
 * but the Fly -> Hostless migration removed the durable local disk the
 * stores were designed for: on Hostless the SQLite file lives in /tmp and
 * is wiped on every redeploy, so anything written only locally was lost.
 * This module closes the loop the hydrate opened: on an interval and again
 * at shutdown it mirrors the identity/session tables (users, tenants,
 * workspaces, provider links, XP ledger, access sessions, refresh tokens,
 * user profiles, user credentials) into the same spmt_* Turso tables the
 * hydrate reads back, using INSERT OR REPLACE so repeated syncs are
 * idempotent. It never deletes remote rows; expirations and revocations
 * are state inside the mirrored row bodies, so they survive the round trip.
 */
import { DatabaseSync } from "node:sqlite";
import { TursoHttpAdapter, type TursoValue } from "@spmt/turso-http";

export type TursoSyncReport = {
  enabled: boolean;
  reason?: string;
  error?: string;
  tables: Record<string, { local: number; written: number; error?: string }>;
  durationMs: number;
  syncedAt?: string;
};

type MirrorTable = {
  local: string;
  remote: string;
  columns: string[];
  ddl: string;
};

const MIRROR_TABLES: MirrorTable[] = [
  {
    local: "users", remote: "spmt_users", columns: ["id", "body"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_users" ("id" TEXT PRIMARY KEY, "body" TEXT NOT NULL)',
  },
  {
    local: "tenants", remote: "spmt_tenants", columns: ["id", "owner_user_id", "status", "body"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_tenants" ("id" TEXT PRIMARY KEY, "owner_user_id" TEXT NOT NULL, "status" TEXT NOT NULL, "body" TEXT NOT NULL)',
  },
  {
    local: "workspaces", remote: "spmt_workspace_profiles", columns: ["tenant_id", "revision", "body"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_workspace_profiles" ("tenant_id" TEXT PRIMARY KEY, "revision" INTEGER NOT NULL, "body" TEXT NOT NULL)',
  },
  {
    local: "provider_links", remote: "spmt_provider_links", columns: ["provider", "provider_user_id", "user_id", "body"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_provider_links" ("provider" TEXT NOT NULL, "provider_user_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "body" TEXT NOT NULL, PRIMARY KEY ("provider", "provider_user_id"))',
  },
  {
    local: "xp_events", remote: "spmt_xp_ledger", columns: ["id", "tenant_id", "user_id", "idempotency_key", "delta", "body"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_xp_ledger" ("id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "idempotency_key" TEXT NOT NULL, "delta" INTEGER NOT NULL, "body" TEXT NOT NULL)',
  },
  {
    local: "access_sessions", remote: "spmt_access_sessions", columns: ["id", "token_hash", "expires_at", "body"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_access_sessions" ("id" TEXT PRIMARY KEY, "token_hash" TEXT NOT NULL, "expires_at" TEXT NOT NULL, "body" TEXT NOT NULL)',
  },
  {
    local: "refresh_tokens", remote: "spmt_refresh_tokens", columns: ["id", "token_hash", "family_id", "expires_at", "body"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_refresh_tokens" ("id" TEXT PRIMARY KEY, "token_hash" TEXT NOT NULL, "family_id" TEXT NOT NULL, "expires_at" TEXT NOT NULL, "body" TEXT NOT NULL)',
  },
  {
    local: "user_profiles", remote: "spmt_user_profiles", columns: ["user_id", "username", "body"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_user_profiles" ("user_id" TEXT PRIMARY KEY, "username" TEXT NOT NULL, "body" TEXT NOT NULL)',
  },
  {
    local: "user_credentials", remote: "spmt_user_credentials", columns: ["user_id", "salt", "password_hash"],
    ddl: 'CREATE TABLE IF NOT EXISTS "spmt_user_credentials" ("user_id" TEXT PRIMARY KEY, "salt" TEXT NOT NULL, "password_hash" TEXT NOT NULL)',
  },
];

const ROWS_PER_STATEMENT = 100;
const STATEMENTS_PER_PIPELINE = 20;

const env = (name: string) => process.env[name]?.trim() || undefined;
const dbUrl = () => env("TURSO_DATABASE_URL") || env("SHARED_TURSO_DATABASE_URL");
const authToken = () => env("TURSO_AUTH_TOKEN") || env("NODE1_TURSO_AUTH_TOKEN");
const ident = (value: string) => '"' + value.replaceAll('"', '""') + '"';

function toTursoValue(value: unknown): TursoValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  return String(value);
}

async function syncTable(local: DatabaseSync, remote: TursoHttpAdapter, table: MirrorTable): Promise<{ local: number; written: number; error?: string }> {
  const present = local.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table.local);
  if (!present) return { local: 0, written: 0 };
  await remote.execute(table.ddl);
  // The Turso copies of some tables were created by the seed import with the
  // recovered export's column names (users keyed by user_id, not id). Insert
  // through the columns the remote table actually has, with that one alias.
  const pragma = await remote.execute(`PRAGMA table_info(${ident(table.remote)})`, [], true);
  const remoteColumns = new Set(pragma.rows.map((row) => String(row[1] ?? "")));
  const pairs = table.columns
    .map((column) => ({ local: column, remote: column === "id" && !remoteColumns.has("id") && remoteColumns.has("user_id") ? "user_id" : column }))
    .filter((pair) => remoteColumns.has(pair.remote));
  if (!pairs.length) return { local: 0, written: 0, error: `remote table ${table.remote} has none of the expected columns` };
  const columnList = pairs.map((pair) => ident(pair.remote)).join(", ");
  // Page the local read instead of materializing the whole table: the
  // identity tables are small, but the XP ledger holds ~180k promoted
  // seed-era rows, and loading every row (plus the per-statement argument
  // copies) into memory killed the first post-promotion deployment during
  // its initial sync. One pipeline round of rows is held at a time.
  const PAGE_SIZE = ROWS_PER_STATEMENT * STATEMENTS_PER_PIPELINE;
  let localCount = 0, written = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = local.prepare(`SELECT ${table.columns.map(ident).join(", ")} FROM ${ident(table.local)} ORDER BY rowid LIMIT ${PAGE_SIZE} OFFSET ${offset}`).all() as Array<Record<string, unknown>>;
    if (!rows.length) break;
    localCount += rows.length;
    const statements: Array<{ sql: string; args: TursoValue[] }> = [];
    for (let j = 0; j < rows.length; j += ROWS_PER_STATEMENT) {
      const chunk = rows.slice(j, Math.min(j + ROWS_PER_STATEMENT, rows.length));
      const placeholders = chunk.map(() => `(${pairs.map(() => "?").join(", ")})`).join(", ");
      statements.push({
        sql: `INSERT OR REPLACE INTO ${ident(table.remote)} (${columnList}) VALUES ${placeholders}`,
        args: chunk.flatMap((row) => pairs.map((pair) => toTursoValue(row[pair.local]))),
      });
    }
    await remote.pipeline(statements);
    written += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  return { local: localCount, written };
}

export async function syncSpmtToTurso(options: { databasePath: string; fetchImpl?: typeof fetch }): Promise<TursoSyncReport> {
  const started = Date.now();
  const report: TursoSyncReport = { enabled: false, tables: {}, durationMs: 0 };
  const url = dbUrl(), token = authToken();
  if (!url || !token) {
    report.reason = "TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set; local SQLite only";
    report.durationMs = Date.now() - started;
    return report;
  }
  report.enabled = true;
  const remote = new TursoHttpAdapter({ url, authToken: token, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  let local: DatabaseSync | undefined;
  try {
    local = new DatabaseSync(options.databasePath, { readOnly: true, timeout: 5000 });
    for (const table of MIRROR_TABLES) {
      try {
        report.tables[table.remote] = await syncTable(local, remote, table);
      } catch (error) {
        report.tables[table.remote] = { local: 0, written: 0, error: error instanceof Error ? error.message.slice(0, 200) : "sync failed" };
      }
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message.slice(0, 200) : "local database open failed";
  } finally {
    local?.close();
  }
  report.durationMs = Date.now() - started;
  report.syncedAt = new Date().toISOString();
  return report;
}
