import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore } from "@spmt/async-json-store";
import type { StreamWeaverSocialReactionRecord } from "./social-reaction-store.js";

const RECORDS = "social-reactions";
const TENANTS = "social-reaction-tenants";

export interface AsyncStreamWeaverSocialReactionStoreOptions {
  databasePath?: string;
  mode?: "sqlite" | "turso";
  url?: string;
  authToken?: string;
  now?: () => string;
}

/** Durable async counterpart to SqliteStreamWeaverSocialReactionStore. */
export class AsyncStreamWeaverSocialReactionStore {
  private readonly records: AsyncJsonRecordStore;
  private readonly now: () => string;

  constructor(options: AsyncStreamWeaverSocialReactionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.records = createAsyncJsonRecordStore({
      service: "streamweaver",
      ...(options.databasePath ? { databasePath: options.databasePath } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.authToken ? { authToken: options.authToken } : {}),
    });
  }

  initialize(): Promise<void> { return this.records.initialize(); }
  health(): Promise<{ ready: boolean }> { return this.records.health(); }
  close(): Promise<void> | void { return this.records.close(); }

  async enqueue(input: { tenantId: string; deliveryId: string; trigger: string; actor: string; target?: string; animationKey: string }): Promise<void> {
    await this.initialize();
    await this.records.transaction(async (tx) => {
      const old = await tx.get<StreamWeaverSocialReactionRecord>(RECORDS, input.tenantId, input.deliveryId);
      if (old) return;
      const value: StreamWeaverSocialReactionRecord = {
        tenantId: input.tenantId, deliveryId: input.deliveryId, trigger: input.trigger, actor: input.actor,
        target: input.target ?? "", animationKey: input.animationKey, state: "pending", attempts: 0, createdAt: this.now(),
      };
      await tx.put(TENANTS, "_index", input.tenantId, { tenantId: input.tenantId });
      await tx.put(RECORDS, input.tenantId, input.deliveryId, value);
    });
  }

  async pending(limit = 100): Promise<StreamWeaverSocialReactionRecord[]> {
    await this.initialize();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Social reaction pending limit must be from 1 to 1000");
    const tenants = await this.records.list<{ tenantId: string }>(TENANTS, "_index");
    const rows: StreamWeaverSocialReactionRecord[] = [];
    for (const tenant of tenants) {
      const records = await this.records.list<StreamWeaverSocialReactionRecord>(RECORDS, tenant.key);
      for (const row of records) if (row.value.state === "pending" || row.value.state === "waiting") rows.push(row.value);
    }
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.tenantId.localeCompare(b.tenantId) || a.deliveryId.localeCompare(b.deliveryId)).slice(0, limit);
  }

  async setJob(tenantId: string, deliveryId: string, jobId: string, attempts: number): Promise<void> {
    await this.mutate(tenantId, deliveryId, (value) => ({ ...value, jobId, state: "waiting", attempts }));
  }

  async retry(tenantId: string, deliveryId: string): Promise<void> {
    await this.mutate(tenantId, deliveryId, (value) => {
      const next = { ...value, state: "pending" as const };
      delete next.jobId;
      return next;
    });
  }

  async complete(tenantId: string, deliveryId: string, reaction: string, state: "ready" | "failed" = "ready"): Promise<void> {
    await this.mutate(tenantId, deliveryId, (value) => ({ ...value, reaction, state }));
  }

  async recent(tenantId: string, limit = 40): Promise<string[]> {
    await this.initialize();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Social reaction recent limit must be from 1 to 1000");
    return (await this.records.list<StreamWeaverSocialReactionRecord>(RECORDS, tenantId))
      .map((row) => row.value).filter((value) => value.reaction !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.deliveryId.localeCompare(a.deliveryId))
      .slice(0, limit).map((value) => value.reaction!);
  }

  async count(tenantId: string): Promise<number> {
    await this.initialize();
    return (await this.records.list<StreamWeaverSocialReactionRecord>(RECORDS, tenantId)).filter((row) => row.value.reaction !== undefined).length;
  }

  private async mutate(tenantId: string, deliveryId: string, change: (value: StreamWeaverSocialReactionRecord) => StreamWeaverSocialReactionRecord): Promise<void> {
    await this.initialize();
    await this.records.transaction(async (tx) => {
      const value = await tx.get<StreamWeaverSocialReactionRecord>(RECORDS, tenantId, deliveryId);
      if (!value) return;
      await tx.put(RECORDS, tenantId, deliveryId, change(value));
    });
  }
}
