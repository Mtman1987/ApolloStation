import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore } from "@spmt/async-json-store";
import { createMosaicQueueState, type MosaicQueueState } from "./mosaic-core.js";
import { normalizeMosaicQueueState } from "./mosaic-store.js";

export interface NebulaMosaicRecordStoreOptions {
  databasePath?: string;
  mode?: "sqlite" | "turso";
  url?: string;
  authToken?: string;
}

/**
 * Async persistence implementation for Nebula Mosaic. The service prefix is
 * enforced by the shared factory; tenant and channel remain separate keys.
 * It deliberately stores only Mosaic state, never player balances or identity.
 */
export class AsyncNebulaMosaicRecordStore {
  private readonly records: AsyncJsonRecordStore;

  constructor(options: NebulaMosaicRecordStoreOptions = {}) {
    this.records = createAsyncJsonRecordStore({
      service: "nebula-arcade",
      ...(options.databasePath ? { databasePath: options.databasePath } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.authToken ? { authToken: options.authToken } : {}),
    });
  }

  async initialize(): Promise<void> {
    await this.records.initialize();
  }

  async health(): Promise<{ ready: boolean }> {
    return this.records.health();
  }

  async get(tenantValue: unknown, channelValue: unknown): Promise<MosaicQueueState> {
    const tenantId = cleanKey(tenantValue, "tenant id");
    const channel = cleanKey(channelValue, "channel");
    const state = await this.records.get<MosaicQueueState>("mosaic-state", tenantId, channel);
    return state ? normalizeMosaicQueueState(state) : createMosaicQueueState();
  }

  async update<T>(
    tenantValue: unknown,
    channelValue: unknown,
    mutate: (state: MosaicQueueState) => T,
    now = Date.now(),
  ): Promise<{ state: MosaicQueueState; result: T }> {
    const tenantId = cleanKey(tenantValue, "tenant id");
    const channel = cleanKey(channelValue, "channel");
    return this.records.transaction(async (tx) => {
      const stored = await tx.get<MosaicQueueState>("mosaic-state", tenantId, channel);
      const state = stored ? normalizeMosaicQueueState(stored) : createMosaicQueueState();
      const result = mutate(state);
      const normalized = normalizeMosaicQueueState(state);
      await tx.put("mosaic-state", tenantId, channel, {
        ...normalized,
        updatedAt: new Date(now).toISOString(),
      });
      return { state: normalized, result };
    });
  }

  async close(): Promise<void> {
    await this.records.close();
  }
}

function cleanKey(value: unknown, name: string): string {
  const key = String(value ?? "").trim().replace(/^#/, "").toLowerCase();
  if (!key || key.length > 180 || /[\\u0000-\\u001f]/.test(key)) {
    throw new Error(`Mosaic ${name} is invalid`);
  }
  return key;
}
