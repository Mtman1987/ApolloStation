import { DatabaseSync } from "node:sqlite";
import type { ChatProviderV1 } from "@spmt/contracts";
import type { ChatGatewayRuntime, ProviderChatEnvelopeV1 } from "./index.js";

export type ProviderConnectionStateV1 = "pending" | "connecting" | "connected" | "backoff" | "reauthorization-required" | "stopped";

export interface ProviderConnectionConfigV1 {
  schemaVersion: 1;
  tenantId: string;
  provider: ChatProviderV1;
  connectionId: string;
  channelId: string;
  providerAccountId: string;
  desired: boolean;
}

export interface ProviderConnectionProjectionV1 extends ProviderConnectionConfigV1 {
  state: ProviderConnectionStateV1;
  cursor?: string;
  retryCount: number;
  nextAttemptAt: string;
  lastConnectedAt?: string;
  lastError?: string;
  updatedAt: string;
}

export type ProviderGrantResultV1 =
  | { status: "ready"; accessToken: string; expiresAt: string; metadata?: Record<string, string> }
  | { status: "reauthorization-required"; reason: string }
  | { status: "unavailable"; reason: string };

export interface ProviderGrantSourceV1 {
  getGrant(connection: ProviderConnectionConfigV1): Promise<ProviderGrantResultV1>;
  recoverAuthentication?(connection: ProviderConnectionConfigV1, reason: string): Promise<ProviderGrantResultV1>;
}
export interface ProviderConnectionHandleV1 { close(): void | Promise<void>; }
export interface ProviderConnectionDriverV1 {
  provider: ChatProviderV1;
  open(input: {
    connection: ProviderConnectionConfigV1;
    accessToken: string;
    grantExpiresAt: string;
    grantMetadata: Record<string, string>;
    resumeCursor?: string;
    onEnvelope(envelope: ProviderChatEnvelopeV1): void | Promise<void>;
    onCursor(cursor: string): void;
    onDisconnect(failure: { kind: "transport" | "authentication"; reason: string }): void;
  }): Promise<ProviderConnectionHandleV1>;
}

type ClaimedConnection = ProviderConnectionProjectionV1 & { leaseOwner: string; leaseExpiresAt: string };

export class SqliteProviderConnectionStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("Provider connection database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_connections(
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, provider TEXT NOT NULL, connection_id TEXT NOT NULL,
        desired INTEGER NOT NULL, state TEXT NOT NULL, retry_count INTEGER NOT NULL, next_attempt_at TEXT NOT NULL,
        cursor TEXT, last_connected_at TEXT, last_error TEXT, lease_owner TEXT, lease_expires_at TEXT,
        updated_at TEXT NOT NULL, body TEXT NOT NULL,
        UNIQUE(tenant_id,provider,connection_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS provider_connections_due ON provider_connections(desired,state,next_attempt_at,lease_expires_at);
    `);
  }
  close(): void { this.db.close(); }

  put(config: ProviderConnectionConfigV1, now = new Date().toISOString()): ProviderConnectionProjectionV1 {
    assertConfig(config);
    const at = iso(now);
    const existing = this.get(config.tenantId, config.provider, config.connectionId);
    const projection: ProviderConnectionProjectionV1 = {
      ...structuredClone(config),
      state: config.desired ? (existing?.state === "connected" ? "connected" : "pending") : "stopped",
      ...(existing?.cursor ? { cursor: existing.cursor } : {}),
      retryCount: config.desired ? (existing?.retryCount ?? 0) : 0,
      nextAttemptAt: config.desired ? at : existing?.nextAttemptAt ?? at,
      ...(existing?.lastConnectedAt ? { lastConnectedAt: existing.lastConnectedAt } : {}),
      updatedAt: at,
    };
    this.db.prepare(`INSERT INTO provider_connections(id,tenant_id,provider,connection_id,desired,state,retry_count,next_attempt_at,cursor,last_connected_at,last_error,lease_owner,lease_expires_at,updated_at,body)
      VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?)
      ON CONFLICT(id) DO UPDATE SET desired=excluded.desired,state=excluded.state,retry_count=excluded.retry_count,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,body=excluded.body,last_error=NULL,lease_owner=NULL,lease_expires_at=NULL`)
      .run(connectionKey(config), config.tenantId, config.provider, config.connectionId, config.desired ? 1 : 0, projection.state, projection.retryCount, projection.nextAttemptAt, projection.cursor ?? null, projection.lastConnectedAt ?? null, at, JSON.stringify(config));
    return projection;
  }

  get(tenantId: string, provider: ChatProviderV1, connectionId: string): ProviderConnectionProjectionV1 | undefined {
    const row = this.db.prepare("SELECT * FROM provider_connections WHERE id=?").get(connectionKey({ tenantId, provider, connectionId })) as ConnectionRow | undefined;
    return row ? project(row) : undefined;
  }

  list(tenantId: string): ProviderConnectionProjectionV1[] {
    requireId(tenantId, "tenantId");
    return (this.db.prepare("SELECT * FROM provider_connections WHERE tenant_id=? ORDER BY provider,connection_id").all(tenantId) as unknown as ConnectionRow[]).map(project);
  }

  claimDue(owner: string, now: string, leaseMs: number, limit = 25): ClaimedConnection[] {
    requireId(owner, "lease owner");
    const at = iso(now);
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) throw new Error("Provider connection lease is invalid");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Provider connection claim limit is invalid");
    const expiresAt = new Date(Date.parse(at) + leaseMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db.prepare(`SELECT * FROM provider_connections
        WHERE desired=1 AND state IN ('pending','backoff','connecting','connected') AND next_attempt_at<=?
          AND (lease_expires_at IS NULL OR lease_expires_at<=?)
        ORDER BY next_attempt_at,id LIMIT ?`).all(at, at, limit) as unknown as ConnectionRow[];
      const claim = this.db.prepare("UPDATE provider_connections SET state='connecting',lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=?");
      for (const row of rows) claim.run(owner, expiresAt, at, row.id);
      this.db.exec("COMMIT");
      return rows.map((row) => ({ ...project({ ...row, state: "connecting", lease_owner: owner, lease_expires_at: expiresAt, updated_at: at }), leaseOwner: owner, leaseExpiresAt: expiresAt }));
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  markConnected(connection: ProviderConnectionConfigV1, owner: string, now: string, leaseMs: number): void {
    const at = iso(now);
    const expiresAt = new Date(Date.parse(at) + leaseMs).toISOString();
    this.requireLease(connection, owner);
    this.db.prepare("UPDATE provider_connections SET state='connected',retry_count=0,next_attempt_at=?,last_connected_at=?,last_error=NULL,lease_expires_at=?,updated_at=? WHERE id=? AND lease_owner=?").run(at, at, expiresAt, at, connectionKey(connection), owner);
  }

  renew(connection: ProviderConnectionConfigV1, owner: string, now: string, leaseMs: number): void {
    const at = iso(now);
    const result = this.db.prepare("UPDATE provider_connections SET lease_expires_at=?,updated_at=? WHERE id=? AND lease_owner=? AND desired=1").run(new Date(Date.parse(at) + leaseMs).toISOString(), at, connectionKey(connection), owner);
    if (!result.changes) throw new Error("Provider connection lease was lost");
  }

  saveCursor(connection: ProviderConnectionConfigV1, owner: string, cursor: string, now: string): void {
    if (!cursor || cursor.length > 2_000) throw new Error("Provider cursor is invalid");
    const result = this.db.prepare("UPDATE provider_connections SET cursor=?,updated_at=? WHERE id=? AND lease_owner=?").run(cursor, iso(now), connectionKey(connection), owner);
    if (!result.changes) throw new Error("Provider connection lease was lost");
  }

  markFailure(connection: ProviderConnectionConfigV1, owner: string, reason: string, now: string): ProviderConnectionProjectionV1 {
    const current = this.get(connection.tenantId, connection.provider, connection.connectionId);
    if (!current) throw new Error("Provider connection not found");
    this.requireLease(connection, owner);
    const retryCount = current.retryCount + 1;
    const at = iso(now);
    const nextAttemptAt = new Date(Date.parse(at) + reconnectDelayMs(connection.provider, retryCount)).toISOString();
    this.db.prepare("UPDATE provider_connections SET state='backoff',retry_count=?,next_attempt_at=?,last_error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?").run(retryCount, nextAttemptAt, redact(reason), at, connectionKey(connection), owner);
    return this.get(connection.tenantId, connection.provider, connection.connectionId)!;
  }

  markReauthorizationRequired(connection: ProviderConnectionConfigV1, owner: string, reason: string, now: string): void {
    this.requireLease(connection, owner);
    this.db.prepare("UPDATE provider_connections SET state='reauthorization-required',last_error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?").run(redact(reason), iso(now), connectionKey(connection), owner);
  }

  release(connection: ProviderConnectionConfigV1, owner: string, now: string): void {
    this.db.prepare("UPDATE provider_connections SET state=CASE WHEN desired=1 THEN 'pending' ELSE 'stopped' END,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND lease_owner=?").run(iso(now), iso(now), connectionKey(connection), owner);
  }

  private requireLease(connection: ProviderConnectionConfigV1, owner: string): void {
    const row = this.db.prepare("SELECT lease_owner AS leaseOwner FROM provider_connections WHERE id=?").get(connectionKey(connection)) as { leaseOwner?: string } | undefined;
    if (!row || row.leaseOwner !== owner) throw new Error("Provider connection lease was lost");
  }
}

export class ChatProviderConnectionSupervisor {
  private readonly drivers = new Map<ChatProviderV1, ProviderConnectionDriverV1>();
  private readonly active = new Map<string, { connection: ProviderConnectionConfigV1; handle: ProviderConnectionHandleV1 }>();
  constructor(private readonly owner: string, private readonly store: SqliteProviderConnectionStore, private readonly gateway: ChatGatewayRuntime, private readonly grants: ProviderGrantSourceV1, drivers: ProviderConnectionDriverV1[], private readonly leaseMs = 30_000) {
    requireId(owner, "supervisor owner");
    for (const driver of drivers) { if (this.drivers.has(driver.provider)) throw new Error("Duplicate provider connection driver"); this.drivers.set(driver.provider, driver); }
  }

  async reconcile(now = new Date().toISOString()): Promise<{ claimed: number; connected: number; failed: number; reauthorizationRequired: number }> {
    const at = iso(now);
    for (const [key, active] of this.active) {
      try { this.store.renew(active.connection, this.owner, at, this.leaseMs); }
      catch { this.active.delete(key); await active.handle.close(); }
    }
    const claimed = this.store.claimDue(this.owner, at, this.leaseMs);
    const report = { claimed: claimed.length, connected: 0, failed: 0, reauthorizationRequired: 0 };
    for (const projection of claimed) {
      const connection = configOf(projection);
      const key = connectionKey(connection);
      if (this.active.has(key)) continue;
      const driver = this.drivers.get(connection.provider);
      if (!driver) { this.store.markFailure(connection, this.owner, "Provider driver is unavailable", at); report.failed += 1; continue; }
      let grant: ProviderGrantResultV1;
      try { grant = await this.grants.getGrant(connection); }
      catch (error) { this.store.markFailure(connection, this.owner, errorText(error), at); report.failed += 1; continue; }
      if (grant.status === "reauthorization-required") { this.store.markReauthorizationRequired(connection, this.owner, grant.reason, at); report.reauthorizationRequired += 1; continue; }
      if (grant.status === "unavailable") { this.store.markFailure(connection, this.owner, grant.reason, at); report.failed += 1; continue; }
      try {
        const handle = await driver.open({
          connection,
          accessToken: grant.accessToken,
          grantExpiresAt: grant.expiresAt,
          grantMetadata: grant.metadata ?? {},
          ...(projection.cursor ? { resumeCursor: projection.cursor } : {}),
          onEnvelope: async (envelope) => { await this.gateway.ingest(envelope); },
          onCursor: (cursor) => this.store.saveCursor(connection, this.owner, cursor, new Date().toISOString()),
          onDisconnect: (failure) => {
            const active = this.active.get(key);
            if (!active) return;
            this.active.delete(key);
            if (failure.kind === "authentication" && this.grants.recoverAuthentication) void this.recoverAuthentication(connection, failure.reason);
            else if (failure.kind === "authentication") this.store.markReauthorizationRequired(connection, this.owner, failure.reason, new Date().toISOString());
            else this.store.markFailure(connection, this.owner, failure.reason, new Date().toISOString());
          },
        });
        this.active.set(key, { connection, handle });
        this.store.markConnected(connection, this.owner, at, this.leaseMs);
        report.connected += 1;
      } catch (error) { this.store.markFailure(connection, this.owner, errorText(error), at); report.failed += 1; }
    }
    return report;
  }

  async stop(now = new Date().toISOString()): Promise<void> {
    for (const [key, active] of this.active) {
      this.active.delete(key);
      try { await active.handle.close(); } finally { this.store.release(active.connection, this.owner, now); }
    }
  }

  private async recoverAuthentication(connection: ProviderConnectionConfigV1, reason: string): Promise<void> {
    const now = new Date().toISOString();
    try {
      const result = await this.grants.recoverAuthentication!(connection, reason);
      if (result.status === "ready") this.store.release(connection, this.owner, now);
      else if (result.status === "reauthorization-required") this.store.markReauthorizationRequired(connection, this.owner, result.reason, now);
      else this.store.markFailure(connection, this.owner, result.reason, now);
    } catch (error) { this.store.markFailure(connection, this.owner, errorText(error), now); }
  }
}

export function reconnectDelayMs(provider: ChatProviderV1, retryCount: number): number {
  const base = provider === "kick" ? 15_000 : provider === "twitch" ? 2_000 : 1_000;
  return Math.min(300_000, base * 2 ** Math.max(0, Math.min(10, retryCount - 1)));
}

interface ConnectionRow { id: string; tenant_id: string; provider: ChatProviderV1; connection_id: string; desired: number; state: ProviderConnectionStateV1; retry_count: number; next_attempt_at: string; cursor?: string; last_connected_at?: string; last_error?: string; lease_owner?: string; lease_expires_at?: string; updated_at: string; body: string; }
function project(row: ConnectionRow): ProviderConnectionProjectionV1 { const config = JSON.parse(row.body) as ProviderConnectionConfigV1; return { ...config, state: row.state, ...(row.cursor ? { cursor: row.cursor } : {}), retryCount: row.retry_count, nextAttemptAt: row.next_attempt_at, ...(row.last_connected_at ? { lastConnectedAt: row.last_connected_at } : {}), ...(row.last_error ? { lastError: row.last_error } : {}), updatedAt: row.updated_at }; }
function configOf(value: ProviderConnectionProjectionV1): ProviderConnectionConfigV1 { return { schemaVersion: 1, tenantId: value.tenantId, provider: value.provider, connectionId: value.connectionId, channelId: value.channelId, providerAccountId: value.providerAccountId, desired: value.desired }; }
function connectionKey(value: Pick<ProviderConnectionConfigV1, "tenantId" | "provider" | "connectionId">): string { return `${value.tenantId}:${value.provider}:${value.connectionId}`; }
function assertConfig(value: ProviderConnectionConfigV1): void { if (value.schemaVersion !== 1 || !["twitch", "discord", "kick"].includes(value.provider) || typeof value.desired !== "boolean") throw new Error("Provider connection config is invalid"); for (const [field, name] of [[value.tenantId, "tenantId"], [value.connectionId, "connectionId"], [value.channelId, "channelId"], [value.providerAccountId, "providerAccountId"]] as const) requireId(field, name); }
function requireId(value: string, name: string): void { if (!value || value.trim() !== value || value.length > 300 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); }
function iso(value: string): string { if (!Number.isFinite(Date.parse(value))) throw new Error("Provider connection timestamp is invalid"); return new Date(value).toISOString(); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function redact(value: string): string { return value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 1_000); }
