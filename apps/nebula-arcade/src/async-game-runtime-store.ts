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
      const value = "state" in stored ? stored.state : stored;
      return normalizeNebulaGameRuntimeState(value ?? {});
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
