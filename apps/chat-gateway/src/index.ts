import { DatabaseSync } from "node:sqlite";
import {
  assertAppModuleManifestV1,
  assertNormalizedChatMessageV1,
  type AppModuleManifestV1,
  type ChatProviderV1,
  type NormalizedChatDeliveryV1,
  type NormalizedChatMessageV1,
  type OutboundChatMessageV1,
} from "@spmt/contracts";
export * from "./connection-supervisor.js";
export * from "./provider-drivers.js";

export const manifest = assertAppModuleManifestV1({
  schemaVersion: 1,
  manifestVersion: "spmt.app-manifest/v1",
  id: "chat-gateway",
  name: "Chat Gateway",
  description: "Provider-neutral Twitch, Discord, and Kick chat connections, normalization, replay protection, and scoped delivery.",
  capabilities: ["chat-ingress", "chat-egress", "provider-presence", "reconnect", "replay"],
  surfaces: ["standalone"],
  requiredScopes: ["identity:read", "events:write", "chat:read", "chat:write", "runtime:write"],
  eventTypes: ["spmt.chat.message.received.v1", "spmt.chat.provider.lifecycle.v1"],
  integration: { identity: "connected", events: "native", runtime: "connected" },
  workers: [
    { id: "twitch-chat", role: "twitch-connection", execution: "leased", canonicalAuthority: false },
    { id: "discord-chat", role: "discord-connection", execution: "anchored", canonicalAuthority: false },
    { id: "kick-chat", role: "kick-connection", execution: "leased", canonicalAuthority: false },
  ],
} satisfies AppModuleManifestV1);

export interface ProviderChatEnvelopeV1 {
  schemaVersion: 1;
  tenantId: string;
  provider: ChatProviderV1;
  connectionId: string;
  channelId: string;
  sourceChannelId?: string;
  messageId: string;
  text: string;
  occurredAt: string;
  providerUserId: string;
  canonicalUserId?: string;
  username: string;
  displayName?: string;
  isBot?: boolean;
  roles?: Array<"broadcaster" | "moderator" | "member">;
  mentions?: Array<{ token: string; providerUserId: string; canonicalUserId?: string; username: string }>;
}

export interface ChatGatewayConsumerV1 {
  id: string;
  accepts(message: NormalizedChatMessageV1): boolean;
  deliver(delivery: NormalizedChatDeliveryV1): void | Promise<void>;
}

export interface ChatProviderSenderV1 {
  provider: ChatProviderV1;
  send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>;
}

export interface ChatGatewayDeliveryReportV1 { attempted: number; delivered: number; failed: number; }
export interface ChatGatewayIngestResultV1 { duplicate: boolean; message: NormalizedChatMessageV1; delivery: ChatGatewayDeliveryReportV1; }

export class SqliteChatGatewayStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("Chat Gateway database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }
  close(): void { this.db.close(); }

  persist(message: NormalizedChatMessageV1, consumerIds: string[]): { duplicate: boolean } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const id = messageKey(message);
      const inserted = Number(this.db.prepare("INSERT INTO chat_messages(id,tenant_id,provider,connection_id,message_id,occurred_at,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").run(id, message.tenantId, message.provider, message.connectionId, message.messageId, message.occurredAt, JSON.stringify(message)).changes);
      if (inserted === 0) { this.db.exec("COMMIT"); return { duplicate: true }; }
      const delivery = this.db.prepare("INSERT INTO chat_deliveries(id,tenant_id,consumer_id,state,attempts,available_at,body) VALUES(?,?,?,'pending',0,?,?)");
      for (const consumerId of consumerIds) {
        const deliveryId = id + ":" + consumerId;
        delivery.run(deliveryId, message.tenantId, consumerId, message.occurredAt, JSON.stringify({ schemaVersion: 1, deliveryId, consumerId, message, attempts: 0 } satisfies NormalizedChatDeliveryV1));
      }
      this.db.exec("COMMIT");
      return { duplicate: false };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  listPending(tenantId: string, consumerId?: string, limit = 100): NormalizedChatDeliveryV1[] {
    requireId(tenantId, "tenantId");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be from 1 to 500");
    const rows = consumerId
      ? this.db.prepare("SELECT body FROM chat_deliveries WHERE tenant_id=? AND consumer_id=? AND state='pending' ORDER BY rowid LIMIT ?").all(tenantId, consumerId, limit)
      : this.db.prepare("SELECT body FROM chat_deliveries WHERE tenant_id=? AND state='pending' ORDER BY rowid LIMIT ?").all(tenantId, limit);
    return (rows as Array<{ body: string }>).map((row) => JSON.parse(row.body) as NormalizedChatDeliveryV1);
  }

  complete(deliveryId: string): void { requireId(deliveryId, "deliveryId"); this.db.prepare("UPDATE chat_deliveries SET state='delivered',last_error=NULL WHERE id=?").run(deliveryId); }
  fail(deliveryId: string, error: string): void {
    requireId(deliveryId, "deliveryId");
    const row = this.db.prepare("SELECT body FROM chat_deliveries WHERE id=?").get(deliveryId) as { body: string } | undefined;
    if (!row) return;
    const delivery = JSON.parse(row.body) as NormalizedChatDeliveryV1;
    const next = { ...delivery, attempts: delivery.attempts + 1 };
    this.db.prepare("UPDATE chat_deliveries SET attempts=attempts+1,last_error=?,body=? WHERE id=?").run(redact(error), JSON.stringify(next), deliveryId);
  }
  countMessages(tenantId: string): number { return Number((this.db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE tenant_id=?").get(tenantId) as { count: number | bigint }).count); }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,provider TEXT NOT NULL,connection_id TEXT NOT NULL,message_id TEXT NOT NULL,occurred_at TEXT NOT NULL,body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS chat_messages_tenant_time ON chat_messages(tenant_id,occurred_at);
      CREATE TABLE IF NOT EXISTS chat_deliveries(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,consumer_id TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,available_at TEXT NOT NULL,last_error TEXT,body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS chat_deliveries_pending ON chat_deliveries(tenant_id,consumer_id,state,available_at);
    `);
  }
}

export class ChatGatewayRuntime {
  private readonly consumers = new Map<string, ChatGatewayConsumerV1>();
  private readonly senders = new Map<ChatProviderV1, ChatProviderSenderV1>();
  constructor(private readonly store: SqliteChatGatewayStore, consumers: ChatGatewayConsumerV1[] = [], senders: ChatProviderSenderV1[] = []) {
    for (const consumer of consumers) { requireId(consumer.id, "consumer id"); if (this.consumers.has(consumer.id)) throw new Error("Duplicate chat consumer id"); this.consumers.set(consumer.id, consumer); }
    for (const sender of senders) { if (this.senders.has(sender.provider)) throw new Error("Duplicate provider sender"); this.senders.set(sender.provider, sender); }
  }

  async ingest(envelope: ProviderChatEnvelopeV1): Promise<ChatGatewayIngestResultV1> {
    const message = normalizeProviderChatEnvelope(envelope);
    const consumerIds = [...this.consumers.values()].filter((consumer) => consumer.accepts(message)).map((consumer) => consumer.id);
    const persisted = this.store.persist(message, consumerIds);
    const delivery = persisted.duplicate ? { attempted: 0, delivered: 0, failed: 0 } : await this.flush(message.tenantId);
    return { duplicate: persisted.duplicate, message, delivery };
  }

  async flush(tenantId: string, limit = 100): Promise<ChatGatewayDeliveryReportV1> {
    const pending = this.store.listPending(tenantId, undefined, limit);
    const report = { attempted: pending.length, delivered: 0, failed: 0 };
    for (const delivery of pending) {
      const consumer = this.consumers.get(delivery.consumerId);
      if (!consumer) { this.store.fail(delivery.deliveryId, "Consumer is not registered"); report.failed += 1; continue; }
      try { await consumer.deliver(delivery); this.store.complete(delivery.deliveryId); report.delivered += 1; }
      catch (error) { this.store.fail(delivery.deliveryId, error instanceof Error ? error.message : String(error)); report.failed += 1; }
    }
    return report;
  }

  async send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }> {
    assertOutbound(message);
    const sender = this.senders.get(message.provider);
    if (!sender) throw new Error(`No ${message.provider} sender is connected`);
    return sender.send(message);
  }
}

export function normalizeProviderChatEnvelope(envelope: ProviderChatEnvelopeV1): NormalizedChatMessageV1 {
  if (envelope.schemaVersion !== 1) throw new Error("Unsupported provider chat envelope version");
  const message: NormalizedChatMessageV1 = {
    schemaVersion: 1,
    tenantId: envelope.tenantId,
    provider: envelope.provider,
    connectionId: envelope.connectionId,
    channelId: envelope.channelId,
    ...(envelope.sourceChannelId ? { sourceChannelId: envelope.sourceChannelId } : {}),
    messageId: envelope.messageId,
    text: envelope.text,
    occurredAt: envelope.occurredAt,
    actor: {
      providerUserId: envelope.providerUserId,
      ...(envelope.canonicalUserId ? { canonicalUserId: envelope.canonicalUserId } : {}),
      username: envelope.username,
      ...(envelope.displayName ? { displayName: envelope.displayName } : {}),
      isBot: envelope.isBot ?? false,
      roles: [...new Set(envelope.roles ?? (["member"] as const))],
    },
    mentions: (envelope.mentions ?? []).map((mention) => ({ ...mention })),
  };
  return assertNormalizedChatMessageV1(message);
}

function assertOutbound(message: OutboundChatMessageV1): void {
  if (message.schemaVersion !== 1 || !message.text || message.text.length > 8_000) throw new Error("Outbound chat message is invalid");
  for (const [value, name] of [[message.tenantId, "tenantId"], [message.connectionId, "connectionId"], [message.channelId, "channelId"], [message.idempotencyKey, "idempotencyKey"]] as Array<[string, string]>) requireId(value, name);
}
function messageKey(message: NormalizedChatMessageV1): string { return [message.tenantId, message.provider, message.connectionId, message.messageId].join(":"); }
function requireId(value: string, name: string): void { if (!value || value.trim() !== value || value.length > 300 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); }
function redact(value: string): string { return value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 1_000); }

export * from "./spmt-provider-grants.js";
