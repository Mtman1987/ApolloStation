import { randomUUID } from "node:crypto";
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore } from "@spmt/async-json-store";
import { NEBULA_ARCADE_GAMES } from "./game-hub.js";
import type { NebulaGameActionV1 } from "./game-actions.js";

export interface AsyncNebulaGameActionStoreOptions { databasePath?: string; mode?: "sqlite" | "turso"; url?: string; authToken?: string; }

/** Async transactional action history store; shares the nebula-arcade service namespace. */
export class AsyncNebulaGameActionStore {
  private readonly records: AsyncJsonRecordStore;
  constructor(options: AsyncNebulaGameActionStoreOptions = {}) {
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
  close(): Promise<void> | void { return this.records.close(); }

  async record(input: Omit<NebulaGameActionV1, "id"> & { id?: string }): Promise<NebulaGameActionV1> {
    const item: NebulaGameActionV1 = {
      id: cleanId(input.id ?? `game-action-${randomUUID()}`, "actionId"),
      tenantId: cleanId(input.tenantId, "tenantId"),
      channel: cleanChannel(input.channel),
      gameId: cleanGame(input.gameId),
      actorId: cleanText(input.actorId, 160),
      username: cleanText(input.username, 120).toLowerCase(),
      displayName: cleanText(input.displayName, 120),
      action: cleanText(input.action, 40).toLowerCase(),
      args: normalizeArgs(input.args),
      message: String(input.message ?? "").trim().slice(0, 500),
      occurredAt: cleanIso(input.occurredAt),
    };
    return this.records.transaction(async (tx) => {
      const existing = await tx.get<NebulaGameActionV1>("game-actions", item.tenantId, item.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(item)) throw new Error("Nebula action id was reused with different input");
        return existing;
      }
      await tx.put("game-actions", item.tenantId, item.id, item);
      const rows = await tx.list<NebulaGameActionV1>("game-actions", item.tenantId);
      const ordered = rows.map((row) => row.value).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
      for (const stale of ordered.slice(0, Math.max(0, ordered.length - 500))) await tx.delete("game-actions", item.tenantId, stale.id);
      return item;
    });
  }

  async get(tenantId: string, actionId: string): Promise<NebulaGameActionV1 | undefined> {
    return this.records.get<NebulaGameActionV1>("game-actions", cleanId(tenantId, "tenantId"), cleanId(actionId, "actionId"));
  }

  async list(tenantId: string, input: { channel?: string; gameIds?: string[]; after?: string; limit?: number } = {}): Promise<NebulaGameActionV1[]> {
    const tenant = cleanId(tenantId, "tenantId"), limit = Math.max(1, Math.min(250, Math.floor(Number(input.limit ?? 100))));
    const rows = await this.records.list<NebulaGameActionV1>("game-actions", tenant);
    const games = input.gameIds?.length ? new Set(input.gameIds.map(cleanGame)) : undefined;
    const channel = input.channel ? cleanChannel(input.channel) : undefined;
    let items = rows.map((row) => row.value).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
      .filter((item) => (!channel || item.channel === channel) && (!games || games.has(item.gameId)));
    if (input.after) { const index = items.findIndex((item) => item.id === input.after); if (index >= 0) items = items.slice(index + 1); }
    return items.slice(-limit);
  }
}

const GAME_IDS = new Set(NEBULA_ARCADE_GAMES.map((game) => game.id));
function cleanGame(value: string) { const id = String(value ?? "").trim().toLowerCase(); if (!GAME_IDS.has(id)) throw new Error("Unknown Nebula game"); return id; }
function cleanChannel(value: string) { const result = String(value ?? "").trim().toLowerCase().replace(/^#/, "").slice(0, 80); if (!result) throw new Error("Nebula channel is required"); return result; }
function cleanId(value: string, name: string) { const result = String(value ?? "").trim(); if (!result || result.length > 200 || /[\\r\\n\\0]/.test(result)) throw new Error(`${name} is invalid`); return result; }
function cleanText(value: string, max: number) { const result = String(value ?? "").trim().slice(0, max); if (!result || /[\\r\\n\\0]/.test(result)) throw new Error("Nebula action text is invalid"); return result; }
function cleanIso(value: string) { if (!Number.isFinite(Date.parse(value))) throw new Error("Nebula action timestamp is invalid"); return value; }
function normalizeArgs(value: readonly string[]) { if (!Array.isArray(value)) return []; return value.map((item) => String(item ?? "").trim().slice(0, 80)).filter(Boolean).slice(0, 8); }
