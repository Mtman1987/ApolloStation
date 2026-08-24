import { DatabaseSync } from "node:sqlite";
import { SpmtClient } from "@spmt/sdk";
import {
  DEFAULT_CHAT_TAG_RULES,
  assertChatTagStateV1,
  createChatTagState,
  executeChatTagCommand,
  publishChatTagCommandResult,
  planChatTagMessage,
  planChatTagRotation,
  type ChatTagCommandResultV1,
  type ChatTagCommandV1,
  type ChatTagRulesV1,
  type ChatTagStateV1,
  type ChatTagInboundMessageV1,
  type ChatTagMessagePlanV1,
  type ChatTagRotationPlanV1,
} from "./chat-tag.js";

export interface StoredChatTagStateV1 {
  revision: number;
  state: ChatTagStateV1;
}

export interface StoredChatTagCommandV1 extends StoredChatTagStateV1 {
  result: ChatTagCommandResultV1;
  duplicate: boolean;
}

export interface ChatTagDeliveryReportV1 {
  attempted: number;
  delivered: number;
  failed: number;
}

interface PendingChatTagDeliveryV1 {
  id: string;
  tenantId: string;
  result: ChatTagCommandResultV1;
}

export interface ChatTagStore {
  getState(tenantId: string): StoredChatTagStateV1;
  applyCommand(command: ChatTagCommandV1, rules?: ChatTagRulesV1): StoredChatTagCommandV1;
  listPendingDeliveries(tenantId: string, limit?: number): PendingChatTagDeliveryV1[];
  markDeliveryComplete(id: string): void;
  markDeliveryFailed(id: string, message: string): void;
  importState(state: ChatTagStateV1, migrationId: string): StoredChatTagStateV1 & { duplicate: boolean };
}

/**
 * App-private Chat Tag authority. This database belongs to Nebula Arcade and is
 * not a second copy of SPMT identity, XP, workspace, or cross-app state.
 */
export class SqliteChatTagStore implements ChatTagStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (!path) throw new Error("Chat Tag database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  getState(tenantId: string): StoredChatTagStateV1 {
    requireId(tenantId, "tenantId");
    const row = this.db.prepare("SELECT revision, body FROM chat_tag_state WHERE tenant_id=?").get(tenantId) as
      | { revision: number; body: string }
      | undefined;
    if (!row) return { revision: 0, state: createChatTagState(tenantId) };
    return { revision: row.revision, state: assertChatTagStateV1(JSON.parse(row.body), tenantId) };
  }

  applyCommand(command: ChatTagCommandV1, rules: ChatTagRulesV1 = DEFAULT_CHAT_TAG_RULES): StoredChatTagCommandV1 {
    requireId(command.tenantId, "tenantId");
    requireId(command.commandId, "commandId");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getState(command.tenantId);
      const prior = this.db.prepare(
        "SELECT result FROM chat_tag_commands WHERE tenant_id=? AND command_id=?",
      ).get(command.tenantId, command.commandId) as { result: string } | undefined;
      if (prior) {
        this.db.exec("COMMIT");
        return {
          ...current,
          result: { ...JSON.parse(prior.result) as ChatTagCommandResultV1, status: "duplicate", stateChanged: false },
          duplicate: true,
        };
      }

      const applied = executeChatTagCommand(current.state, command, rules);
      const revision = current.revision + 1;
      this.db.prepare(`
        INSERT INTO chat_tag_state(tenant_id, revision, updated_at, body)
        VALUES(?,?,?,?)
        ON CONFLICT(tenant_id) DO UPDATE SET
          revision=excluded.revision,
          updated_at=excluded.updated_at,
          body=excluded.body
      `).run(command.tenantId, revision, command.occurredAt, JSON.stringify(applied.state));
      this.db.prepare(`
        INSERT INTO chat_tag_commands(tenant_id, command_id, occurred_at, result)
        VALUES(?,?,?,?)
      `).run(command.tenantId, command.commandId, command.occurredAt, JSON.stringify(applied.result));
      if (applied.result.event || applied.result.xpAward) {
        this.db.prepare(`
          INSERT INTO chat_tag_outbox(id, tenant_id, command_id, created_at, attempts, result)
          VALUES(?,?,?,?,0,?)
        `).run(
          `chat-tag-outbox:${command.tenantId}:${command.commandId}`,
          command.tenantId,
          command.commandId,
          command.occurredAt,
          JSON.stringify(applied.result),
        );
      }
      this.db.exec("COMMIT");
      return { revision, state: applied.state, result: applied.result, duplicate: false };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listPendingDeliveries(tenantId: string, limit = 100): PendingChatTagDeliveryV1[] {
    requireId(tenantId, "tenantId");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be from 1 to 500");
    const rows = this.db.prepare(`
      SELECT id, tenant_id, result
      FROM chat_tag_outbox
      WHERE tenant_id=?
      ORDER BY created_at, id
      LIMIT ?
    `).all(tenantId, limit) as Array<{ id: string; tenant_id: string; result: string }>;
    return rows.map((row) => ({ id: row.id, tenantId: row.tenant_id, result: JSON.parse(row.result) as ChatTagCommandResultV1 }));
  }

  markDeliveryComplete(id: string): void {
    requireId(id, "deliveryId");
    this.db.prepare("DELETE FROM chat_tag_outbox WHERE id=?").run(id);
  }

  markDeliveryFailed(id: string, message: string): void {
    requireId(id, "deliveryId");
    this.db.prepare(`
      UPDATE chat_tag_outbox
      SET attempts=attempts+1, last_error=?
      WHERE id=?
    `).run(safeError(message), id);
  }

  importState(stateValue: ChatTagStateV1, migrationId: string): StoredChatTagStateV1 & { duplicate: boolean } {
    const state = assertChatTagStateV1(stateValue);
    requireId(migrationId, "migrationId");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db.prepare("SELECT 1 FROM chat_tag_migrations WHERE tenant_id=? AND migration_id=?").get(state.tenantId, migrationId);
      if (prior) { const current = this.getState(state.tenantId); this.db.exec("COMMIT"); return { ...current, duplicate: true }; }
      const current = this.getState(state.tenantId);
      if (current.revision !== 0) throw new Error("Chat Tag state already exists for this tenant");
      this.db.prepare("INSERT INTO chat_tag_state(tenant_id,revision,updated_at,body) VALUES(?,?,?,?)").run(state.tenantId, 1, new Date().toISOString(), JSON.stringify(state));
      this.db.prepare("INSERT INTO chat_tag_migrations(tenant_id,migration_id,imported_at) VALUES(?,?,?)").run(state.tenantId, migrationId, new Date().toISOString());
      this.db.exec("COMMIT");
      return { revision: 1, state, duplicate: false };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_tag_state(
        tenant_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        body TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS chat_tag_commands(
        tenant_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        result TEXT NOT NULL,
        PRIMARY KEY(tenant_id, command_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS chat_tag_commands_time
        ON chat_tag_commands(tenant_id, occurred_at);
      CREATE TABLE IF NOT EXISTS chat_tag_outbox(
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        result TEXT NOT NULL,
        UNIQUE(tenant_id, command_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS chat_tag_outbox_pending
        ON chat_tag_outbox(tenant_id, created_at);
      CREATE TABLE IF NOT EXISTS chat_tag_migrations(
        tenant_id TEXT NOT NULL,
        migration_id TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id, migration_id)
      ) STRICT;
    `);
  }
}

export class ChatTagRuntime {
  constructor(
    private readonly store: ChatTagStore,
    private readonly spmt: SpmtClient,
    private readonly rules: ChatTagRulesV1 = DEFAULT_CHAT_TAG_RULES,
  ) {}

  getState(tenantId: string): StoredChatTagStateV1 {
    return this.store.getState(tenantId);
  }

  async execute(command: ChatTagCommandV1): Promise<StoredChatTagCommandV1 & { delivery: ChatTagDeliveryReportV1 }> {
    const applied = this.store.applyCommand(command, this.rules);
    const delivery = await this.flushPending(command.tenantId);
    return { ...applied, delivery };
  }

  async ingest(message: ChatTagInboundMessageV1): Promise<ChatTagMessagePlanV1 | (StoredChatTagCommandV1 & { kind: "result"; delivery: ChatTagDeliveryReportV1 })> {
    const plan = planChatTagMessage(this.store.getState(message.tenantId).state, message);
    if (plan.kind === "ignored") {
      const state = this.store.getState(message.tenantId).state;
      if (!state.players[message.userId]) return plan;
      const applied = await this.execute({
        schemaVersion: 1,
        tenantId: message.tenantId,
        commandId: `${message.provider}:${message.messageId}:activity`,
        actorUserId: message.userId,
        occurredAt: message.occurredAt,
        channelId: message.channelId,
        kind: "record-activity",
      });
      return { kind: "result", ...applied };
    }
    if (plan.kind !== "command") return plan;
    const applied = await this.execute(plan.command);
    return { kind: "result", ...applied };
  }

  async reconcileRotation(input: { tenantId: string; channelId: string; now: string; liveUserIds?: string[]; random?: () => number }): Promise<ChatTagRotationPlanV1 | (StoredChatTagCommandV1 & { kind: "result"; rotation: ChatTagRotationPlanV1; delivery: ChatTagDeliveryReportV1 })> {
    const rotation = planChatTagRotation(this.store.getState(input.tenantId).state, input);
    if (!rotation.command) return rotation;
    const applied = await this.execute(rotation.command);
    return { kind: "result", rotation, ...applied };
  }

  async flushPending(tenantId: string, limit = 100): Promise<ChatTagDeliveryReportV1> {
    const pending = this.store.listPendingDeliveries(tenantId, limit);
    const report: ChatTagDeliveryReportV1 = { attempted: pending.length, delivered: 0, failed: 0 };
    for (const item of pending) {
      try {
        await publishChatTagCommandResult(this.spmt, item.result);
        this.store.markDeliveryComplete(item.id);
        report.delivered += 1;
      } catch (error) {
        this.store.markDeliveryFailed(item.id, error instanceof Error ? error.message : String(error));
        report.failed += 1;
      }
    }
    return report;
  }
}

function requireId(value: string, name: string): void {
  if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
}

function safeError(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .slice(0, 1_000);
}
