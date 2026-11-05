import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore, AsyncJsonRecordView } from "@spmt/async-json-store";
import {
  defaultNebulaGameRuntimeState,
  normalizeNebulaGameRuntimeState,
  type NebulaGameRuntimeStateV1,
} from "./game-runtime.js";
import { NebulaGameRuntimeCorruptionError } from "./game-runtime-store.js";

export interface AsyncNebulaGameRuntimeStoreOptions {
  databasePath?: string;
  mode?: "sqlite" | "turso";
  url?: string;
  authToken?: string;
}

/** Async transactional counterpart to SqliteNebulaGameRuntimeStore. */
export class AsyncNebulaGameRuntimeStore {
  private readonly records: AsyncJsonRecordStore;

  constructor(options: AsyncNebulaGameRuntimeStoreOptions = {}) {
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

  async get(tenantId: string, runtimeKey = "default"): Promise<NebulaGameRuntimeStateV1> {
    const tenant = cleanId(tenantId, "tenantId");
    const key = cleanId(runtimeKey, "runtimeKey");
    const stored = await this.records.get<{ state?: Partial<NebulaGameRuntimeStateV1> } | Partial<NebulaGameRuntimeStateV1>>("game-runtime", tenant, key);
    if (!stored) return defaultNebulaGameRuntimeState();
    try {
      const wrapped = stored as { state?: Partial<NebulaGameRuntimeStateV1> };
      const value = wrapped.state && typeof wrapped.state === "object" ? wrapped.state : stored as Partial<NebulaGameRuntimeStateV1>;
      return normalizeNebulaGameRuntimeState(value);
    }
    catch (error) { throw new NebulaGameRuntimeCorruptionError(tenant, key, error); }
  }

  async put(tenantId: string, state: NebulaGameRuntimeStateV1, runtimeKey = "default", now = new Date()): Promise<NebulaGameRuntimeStateV1> {
    const tenant = cleanId(tenantId, "tenantId");
    const key = cleanId(runtimeKey, "runtimeKey");
    if (!Number.isFinite(now.getTime())) throw new Error("Nebula game runtime timestamp is invalid");
    const normalized = normalizeNebulaGameRuntimeState(state);
    await this.records.put("game-runtime", tenant, key, { state: normalized, updatedAt: now.toISOString() });
    return structuredClone(normalized);
  }

  async importState(tenantId: string, stateValue: NebulaGameRuntimeStateV1, migrationId: string, runtimeKey = "default", updatedAt = new Date().toISOString()): Promise<{ imported: boolean; duplicate: boolean }> {
    const tenant = cleanId(tenantId, "tenantId");
    const key = cleanId(runtimeKey, "runtimeKey");
    const migration = cleanId(migrationId, "migrationId");
    if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("Nebula game runtime migration timestamp is invalid");
    const state = normalizeNebulaGameRuntimeState(stateValue);
    return this.records.transaction(async (tx) => {
      const receiptKey = migration + ":" + key;
      const receipt = await tx.get("game-runtime-migrations", tenant, receiptKey);
      if (receipt) return { imported: false, duplicate: true };
      const existing = await tx.get("game-runtime", tenant, key);
      if (existing) throw new Error("Nebula game runtime destination is not empty for tenant " + tenant);
      await tx.put("game-runtime", tenant, key, { state, updatedAt });
      await tx.put("game-runtime-migrations", tenant, receiptKey, { importedAt: new Date().toISOString() });
      return { imported: true, duplicate: false };
    });
  }

  async update<T>(
    tenantId: string,
    mutate: (state: NebulaGameRuntimeStateV1) => T,
    runtimeKey = "default",
    now = new Date(),
  ): Promise<{ state: NebulaGameRuntimeStateV1; result: T }> {
    const tenant = cleanId(tenantId, "tenantId");
    const key = cleanId(runtimeKey, "runtimeKey");
    if (!Number.isFinite(now.getTime())) throw new Error("Nebula game runtime timestamp is invalid");
    return this.records.transaction(async (tx) => {
      const current = await readState(tx, tenant, key);
      const result = mutate(current);
      const normalized = normalizeNebulaGameRuntimeState(current);
      await tx.put("game-runtime", tenant, key, { state: normalized, updatedAt: now.toISOString() });
      return { state: structuredClone(normalized), result };
    });
  }
}

async function readState(tx: AsyncJsonRecordView, tenantId: string, runtimeKey: string): Promise<NebulaGameRuntimeStateV1> {
  const stored = await tx.get<{ state?: Partial<NebulaGameRuntimeStateV1> }>("game-runtime", tenantId, runtimeKey);
  if (!stored) return defaultNebulaGameRuntimeState();
  try { return normalizeNebulaGameRuntimeState(stored.state ?? stored as Partial<NebulaGameRuntimeStateV1>); }
  catch (error) { throw new NebulaGameRuntimeCorruptionError(tenantId, runtimeKey, error); }
}

function cleanId(value: string, name: string): string {
  const clean = String(value ?? "").trim();
  if (!clean || clean.length > 180 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`);
  return clean;
}
