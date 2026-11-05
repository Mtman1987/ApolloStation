import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore, AsyncJsonRecordView } from "@spmt/async-json-store";
import {
  DEFAULT_NEBULA_TAG_RULES,
  DEFAULT_NEBULA_TAG_ROTATION_RULES,
  assertNebulaTagStateV1,
  createNebulaTagState,
  executeNebulaTagCommand,
  type NebulaTagCommandResultV1,
  type NebulaTagCommandV1,
  type NebulaTagRulesV1,
  type NebulaTagRotationRulesV1,
  type NebulaTagStateV1,
} from "./nebula-tag.js";
import type {
  StoredNebulaTagStateV1,
  StoredNebulaTagCommandV1,
} from "./nebula-tag-runtime.js";

interface PendingDelivery {
  id: string;
  tenantId: string;
  commandId: string;
  createdAt: string;
  attempts: number;
  lastError?: string;
  result: NebulaTagCommandResultV1;
}

export interface AsyncNebulaTagStoreOptions {
  databasePath?: string;
  mode?: "sqlite" | "turso";
  url?: string;
  authToken?: string;
}

/**
 * Async Nebula Tag persistence. State, command idempotency, delivery outbox,
 * and migration receipts are written in the same transaction. The existing
 * synchronous SQLite store remains the default until all runtime callers have
 * been migrated and the async implementation has passed parity acceptance.
 */
export class AsyncNebulaTagRecordStore {
  private readonly records: AsyncJsonRecordStore;

  constructor(options: AsyncNebulaTagStoreOptions = {}) {
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
  close(): Promise<void> { return this.records.close(); }

  async getState(tenantId: string): Promise<StoredNebulaTagStateV1> {
    requireId(tenantId, "tenantId");
    const stored = await this.records.get<StoredNebulaTagStateV1>("tag-state", tenantId, "current");
    return stored
      ? { revision: stored.revision, state: assertNebulaTagStateV1(stored.state, tenantId) }
      : { revision: 0, state: createNebulaTagState(tenantId) };
  }

  async rotationRules(_tenantId: string): Promise<NebulaTagRotationRulesV1> {
    return { ...DEFAULT_NEBULA_TAG_ROTATION_RULES };
  }

  async applyCommand(command: NebulaTagCommandV1, rules: NebulaTagRulesV1 = DEFAULT_NEBULA_TAG_RULES): Promise<StoredNebulaTagCommandV1> {
    requireId(command.tenantId, "tenantId");
    requireId(command.commandId, "commandId");
    return this.records.transaction(async (tx) => {
      const current = await readState(tx, command.tenantId);
      const prior = await tx.get<NebulaTagCommandResultV1>("tag-commands", command.tenantId, command.commandId);
      if (prior) {
        return {
          ...current,
          result: { ...prior, status: "duplicate", stateChanged: false },
          duplicate: true,
        };
      }

      const applied = executeNebulaTagCommand(current.state, command, rules);
      const revision = current.revision + 1;
      const result: StoredNebulaTagCommandV1 = {
        revision,
        state: applied.state,
        result: applied.result,
        duplicate: false,
      };
      await tx.put("tag-state", command.tenantId, "current", { revision, state: applied.state });
      await tx.put("tag-commands", command.tenantId, command.commandId, applied.result);
      if (applied.result.event || applied.result.xpAward) {
        const id = `nebula-arcade:tag-outbox:${encodeURIComponent(command.tenantId)}:${encodeURIComponent(command.commandId)}`;
        await tx.put<PendingDelivery>("tag-outbox", command.tenantId, id, {
          id,
          tenantId: command.tenantId,
          commandId: command.commandId,
          createdAt: command.occurredAt,
          attempts: 0,
          result: applied.result,
        });
      }
      return result;
    });
  }

  async listPendingDeliveries(tenantId: string, limit = 100): Promise<Array<{ id: string; tenantId: string; result: NebulaTagCommandResultV1 }>> {
    requireId(tenantId, "tenantId");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be from 1 to 500");
    const rows = await this.records.list<PendingDelivery>("tag-outbox", tenantId);
    return rows
      .map((row) => row.value)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(({ id, tenantId: owner, result }) => ({ id, tenantId: owner, result }));
  }

  async markDeliveryComplete(id: string): Promise<void> {
    requireId(id, "deliveryId");
    const tenantId = outboxTenant(id);
    await this.records.delete("tag-outbox", tenantId, id);
  }

  async markDeliveryFailed(id: string, message: string): Promise<void> {
    requireId(id, "deliveryId");
    const tenantId = outboxTenant(id);
    await this.records.transaction(async (tx) => {
      const item = await tx.get<PendingDelivery>("tag-outbox", tenantId, id);
      if (!item) return;
      await tx.put("tag-outbox", tenantId, id, {
        ...item,
        attempts: item.attempts + 1,
        lastError: safeError(message),
      });
    });
  }

  async importState(stateValue: NebulaTagStateV1, migrationId: string): Promise<StoredNebulaTagStateV1 & { duplicate: boolean }> {
    const state = assertNebulaTagStateV1(stateValue);
    requireId(migrationId, "migrationId");
    return this.records.transaction(async (tx) => {
      const receipt = await tx.get<{ importedAt: string }>("tag-migrations", state.tenantId, migrationId);
      const current = await readState(tx, state.tenantId);
      if (receipt) return { ...current, duplicate: true };
      if (current.revision !== 0) throw new Error("Nebula Arcade tag game state already exists for this tenant");
      const importedAt = new Date().toISOString();
      const result = { revision: 1, state, duplicate: false };
      await tx.put("tag-state", state.tenantId, "current", { revision: 1, state });
      await tx.put("tag-migrations", state.tenantId, migrationId, { importedAt });
      return result;
    });
  }
}

async function readState(tx: AsyncJsonRecordView, tenantId: string): Promise<StoredNebulaTagStateV1> {
  const stored = await tx.get<StoredNebulaTagStateV1>("tag-state", tenantId, "current");
  return stored
    ? { revision: stored.revision, state: assertNebulaTagStateV1(stored.state, tenantId) }
    : { revision: 0, state: createNebulaTagState(tenantId) };
}

function outboxTenant(id: string): string {
  const prefix = "nebula-arcade:tag-outbox:";
  if (!id.startsWith(prefix)) throw new Error("deliveryId is invalid");
  const remainder = id.slice(prefix.length);
  const split = remainder.indexOf(":");
  if (split < 1) throw new Error("deliveryId is invalid");
  return decodeURIComponent(remainder.slice(0, split));
}

function requireId(value: string, name: string): void {
  if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
}

function safeError(value: string): string {
  return value
    .replace(/\\bBearer\\s+\\S+/gi, "Bearer [REDACTED]")
    .replace(/((?:token|secret|password|authorization)\\s*[:=]\\s*)\\S+/gi, "$1[REDACTED]")
    .slice(0, 1_000);
}
