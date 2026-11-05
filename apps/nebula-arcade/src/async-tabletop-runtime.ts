import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore, AsyncJsonRecordView } from "@spmt/async-json-store";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteNebulaTabletopRuntime } from "./tabletop-runtime.js";
import type { NormalizedChatMessageV1 } from "@spmt/contracts";

export interface AsyncNebulaTabletopRuntimeOptions {
  databasePath?: string;
  mode?: "sqlite" | "turso";
  url?: string;
  authToken?: string;
}

/**
 * Transactional async persistence boundary for the existing tabletop domain.
 *
 * The existing SQLite tabletop class is used only as a short-lived, isolated
 * execution engine. Each call hydrates a private scratch database from the
 * current record-store transaction, runs the established domain logic, then
 * writes the resulting rows back through that same transaction. No durable
 * state is stored in the scratch database; it is removed before the call
 * returns. This preserves the existing command implementation while keeping
 * all durable reads/writes, including game-runtime rewards and media outbox,
 * inside one SQLite/Turso record-store transaction.
 */
export class AsyncNebulaTabletopRuntime {
  private readonly records: AsyncJsonRecordStore;

  constructor(options: AsyncNebulaTabletopRuntimeOptions = {}) {
    this.records = createAsyncJsonRecordStore({
      service: "nebula-arcade",
      ...(options.databasePath ? { databasePath: options.databasePath } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.authToken ? { authToken: options.authToken } : {}),
    });
  }

  initialize(): Promise<void> { return this.records.initialize(); }
  health(): Promise<{ ready: boolean }> { return this.records.health(); }
  async close(): Promise<void> { await this.records.close(); }

  async snapshot(tenant: string, channel: string, userId?: string): Promise<ReturnType<SqliteNebulaTabletopRuntime["snapshot"]>> {
    return this.withScratch(tenant, (runtime) => runtime.snapshot(tenant, channel, userId), true);
  }

  async execute(message: NormalizedChatMessageV1): Promise<string | undefined> {
    return this.withScratch(message.tenantId, (runtime) => runtime.execute(message), true);
  }

  async succeeded(message: NormalizedChatMessageV1): Promise<boolean> {
    await this.initialize();
    const id = `${message.provider}:${message.connectionId}:${message.messageId}`;
    return Boolean(await this.records.get("tabletop-command-receipts", message.tenantId, id));
  }

  async pendingOutbox(tenant: string, limit = 50): Promise<Array<{ id: string; kind: string; body: Record<string, any>; status: string; updated_at: string }>> {
    await this.initialize();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("outbox limit must be from 1 to 100");
    const rows = await this.records.list<{ kind: string; body: Record<string, any>; status: string; updatedAt: string }>("tabletop-media-outbox", tenant);
    return rows.map((row) => ({ id: row.key, kind: row.value.kind, body: row.value.body, status: row.value.status, updated_at: row.value.updatedAt }))
      .filter((row) => !["done", "failed", "cancelled"].includes(row.status))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async updateOutbox(tenant: string, id: string, status: string, body: unknown, now = new Date().toISOString()): Promise<void> {
    await this.initialize();
    await this.records.transaction(async (tx) => {
      const current = await tx.get<{ kind: string; body: unknown; status: string; updatedAt: string }>("tabletop-media-outbox", tenant, id);
      if (!current) return;
      await tx.put("tabletop-media-outbox", tenant, id, { ...current, body, status, updatedAt: now });
    });
  }

  async tradeSnapshot(tenant: string, actorId: string, players: Record<string, { username?: string; displayName?: string }> = {}, now = Date.now()): Promise<ReturnType<SqliteNebulaTabletopRuntime["tradeSnapshot"]>> {
    return this.withScratch(tenant, (runtime) => runtime.tradeSnapshot(tenant, actorId, players, now), false);
  }

  async trade(tenant: string, actorId: string, actorName: string, input: { action: "offer" | "accept" | "decline" | "cancel"; toId?: string; giveCardId?: number; wantCardId?: number; offerId?: string; requestId?: string }, players: Record<string, { username?: string; displayName?: string }> = {}, now = Date.now()): Promise<ReturnType<SqliteNebulaTabletopRuntime["trade"]>> {
    return this.withScratch(tenant, (runtime) => runtime.trade(tenant, actorId, actorName, input, players, now), true);
  }

  async ingestBingoTranscript(tenant: string, channel: string, text: unknown, now = Date.now()): Promise<ReturnType<SqliteNebulaTabletopRuntime["ingestBingoTranscript"]>> {
    return this.withScratch(tenant, (runtime) => runtime.ingestBingoTranscript(tenant, channel, text, now), true);
  }

  async observeBingo(message: NormalizedChatMessageV1): Promise<string | undefined> {
    return this.withScratch(message.tenantId, (runtime) => runtime.observeBingo(message), true);
  }

  async quackverseState(tenant: string, channel: string, now = new Date()): Promise<ReturnType<SqliteNebulaTabletopRuntime["quackverseState"]>> {
    return this.withScratch(tenant, (runtime) => runtime.quackverseState(tenant, channel, now), false);
  }

  async importData(tenant: string, input: Parameters<SqliteNebulaTabletopRuntime["importData"]>[1]): Promise<void> {
    await this.withScratch(tenant, (runtime) => runtime.importData(tenant, input), true);
  }

  private async withScratch<T>(tenant: string, work: (runtime: SqliteNebulaTabletopRuntime) => T, persist: boolean): Promise<T> {
    await this.initialize();
    if (!tenant || tenant.trim() !== tenant || tenant.length > 180 || /[\r\n\0]/.test(tenant)) throw new Error("tenantId is invalid");
    return this.records.transaction(async (tx) => {
      const tabletop = await tx.list<Record<string, unknown>>("tabletop-state", tenant);
      const receipts = await tx.list<{ result: string }>("tabletop-command-receipts", tenant);
      const trades = await tx.list<{ result: unknown }>("quackverse-trade-receipts", tenant);
      const outbox = await tx.list<{ kind: string; body: unknown; status: string; updatedAt: string }>("tabletop-media-outbox", tenant);
      const gameRuntime = await tx.get<{ state?: unknown; updatedAt?: string } | Record<string, unknown>>("game-runtime", tenant, "default");
      const directory = mkdtempSync(join(tmpdir(), "nebula-tabletop-scratch-"));
      const databasePath = join(directory, "execution.sqlite");
      let runtime: SqliteNebulaTabletopRuntime | undefined;
      let db: DatabaseSync | undefined;
      try {
        const engine = new SqliteNebulaTabletopRuntime(databasePath);
        runtime = engine;
        db = new DatabaseSync(databasePath, { timeout: 5_000 });
        db.exec("CREATE TABLE IF NOT EXISTS nebula_media_outbox(tenant_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,id))");
        const putTabletop = db.prepare("INSERT OR REPLACE INTO nebula_tabletop(tenant_id,channel_id,game_id,body) VALUES(?,?,?,?)");
        for (const row of tabletop) {
          const [channel, game] = splitPair(row.key, "tabletop-state");
          putTabletop.run(tenant, channel, game, JSON.stringify(row.value));
        }
        const putReceipt = db.prepare("INSERT OR REPLACE INTO nebula_tabletop_receipts(tenant_id,input_id,result) VALUES(?,?,?)");
        for (const row of receipts) putReceipt.run(tenant, row.key, row.value.result);
        const putTrade = db.prepare("INSERT OR REPLACE INTO nebula_quackverse_trade_receipts(tenant_id,actor_id,request_id,result) VALUES(?,?,?,?)");
        for (const row of trades) {
          const [actor, request] = splitPair(row.key, "quackverse-trade-receipts");
          putTrade.run(tenant, actor, request, JSON.stringify(row.value.result));
        }
        const putOutbox = db.prepare("INSERT OR REPLACE INTO nebula_media_outbox(tenant_id,id,kind,body,status,updated_at) VALUES(?,?,?,?,?,?)");
        for (const row of outbox) putOutbox.run(tenant, row.key, row.value.kind, JSON.stringify(row.value.body), row.value.status, row.value.updatedAt);
        if (gameRuntime) {
          const state = (gameRuntime as { state?: unknown }).state ?? gameRuntime;
          const updatedAt = String((gameRuntime as { updatedAt?: unknown }).updatedAt ?? new Date(0).toISOString());
          db.prepare("INSERT OR REPLACE INTO nebula_game_runtime(tenant_id,runtime_key,body,updated_at) VALUES(?,'default',?,?)").run(tenant, JSON.stringify(state), updatedAt);
        }
        db.close(); db = undefined;

        const result = work(engine);
        if (persist) {
          db = new DatabaseSync(databasePath, { timeout: 5_000 });
          await writeTabletopRecords(tx, tenant, db, tabletop);
          await writeReceiptRecords(tx, tenant, db, receipts);
          await writeTradeRecords(tx, tenant, db, trades);
          await writeOutboxRecords(tx, tenant, db, outbox);
          const gameRow = db.prepare("SELECT body,updated_at FROM nebula_game_runtime WHERE tenant_id=? AND runtime_key='default'").get(tenant) as { body: string; updated_at: string } | undefined;
          if (gameRow) await tx.put("game-runtime", tenant, "default", { state: JSON.parse(gameRow.body), updatedAt: gameRow.updated_at });
        }
        return result;
      } finally {
        try { db?.close(); } catch {}
        try { runtime?.close(); } catch {}
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

function pairKey(first: string, second: string): string { return `${encodeURIComponent(first)}:${encodeURIComponent(second)}`; }
function splitPair(key: string, namespace: string): [string, string] {
  const index = key.indexOf(":");
  if (index < 1 || index === key.length - 1) throw new Error(`Invalid ${namespace} record key`);
  return [decodeURIComponent(key.slice(0, index)), decodeURIComponent(key.slice(index + 1))];
}
async function replaceRows<T>(tx: AsyncJsonRecordView, namespace: string, tenant: string, previous: Array<{ key: string }>, next: Array<{ key: string; value: T }>) {
  const keys = new Set(next.map((row) => row.key));
  for (const row of previous) if (!keys.has(row.key)) await tx.delete(namespace, tenant, row.key);
  for (const row of next) await tx.put(namespace, tenant, row.key, row.value);
}
async function writeTabletopRecords(tx: AsyncJsonRecordView, tenant: string, db: DatabaseSync, previous: Array<{ key: string }>) {
  const rows = db.prepare("SELECT channel_id,game_id,body FROM nebula_tabletop WHERE tenant_id=?").all(tenant) as Array<{ channel_id: string; game_id: string; body: string }>;
  await replaceRows(tx, "tabletop-state", tenant, previous, rows.map((row) => ({ key: pairKey(row.channel_id, row.game_id), value: JSON.parse(row.body) })));
}
async function writeReceiptRecords(tx: AsyncJsonRecordView, tenant: string, db: DatabaseSync, previous: Array<{ key: string }>) {
  const rows = db.prepare("SELECT input_id,result FROM nebula_tabletop_receipts WHERE tenant_id=?").all(tenant) as Array<{ input_id: string; result: string }>;
  await replaceRows(tx, "tabletop-command-receipts", tenant, previous, rows.map((row) => ({ key: row.input_id, value: { result: row.result } })));
}
async function writeTradeRecords(tx: AsyncJsonRecordView, tenant: string, db: DatabaseSync, previous: Array<{ key: string }>) {
  const rows = db.prepare("SELECT actor_id,request_id,result FROM nebula_quackverse_trade_receipts WHERE tenant_id=?").all(tenant) as Array<{ actor_id: string; request_id: string; result: string }>;
  await replaceRows(tx, "quackverse-trade-receipts", tenant, previous, rows.map((row) => ({ key: pairKey(row.actor_id, row.request_id), value: { result: JSON.parse(row.result) } })));
}
async function writeOutboxRecords(tx: AsyncJsonRecordView, tenant: string, db: DatabaseSync, previous: Array<{ key: string }>) {
  const rows = db.prepare("SELECT id,kind,body,status,updated_at FROM nebula_media_outbox WHERE tenant_id=?").all(tenant) as Array<{ id: string; kind: string; body: string; status: string; updated_at: string }>;
  await replaceRows(tx, "tabletop-media-outbox", tenant, previous, rows.map((row) => ({ key: row.id, value: { kind: row.kind, body: JSON.parse(row.body), status: row.status, updatedAt: row.updated_at } })));
}
