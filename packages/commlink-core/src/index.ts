import { DatabaseSync } from "node:sqlite";
import {
  assertNormalizedChatMessageV1,
  type ChatProviderV1,
  type CommlinkLiveChatQueryV1,
  type CommlinkLiveChatRecordV1,
  type NormalizedChatDeliveryV1,
  type NormalizedChatMessageV1,
} from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";

export type { CommlinkLiveChatQueryV1, CommlinkLiveChatRecordV1 } from "@spmt/contracts";

/** Durable SPMT-owned projection. It stores no provider access or refresh credentials. */
export class CommlinkLiveChatStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (!path) throw new Error("Commlink live-chat database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS commlink_live_chat (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        text TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        canonical_user_id TEXT,
        username TEXT NOT NULL,
        body TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS commlink_live_chat_tenant_time
        ON commlink_live_chat(tenant_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS commlink_live_chat_source
        ON commlink_live_chat(tenant_id, provider, channel_id, occurred_at DESC);
    `);
  }

  close(): void { this.db.close(); }

  ingest(message: NormalizedChatMessageV1): { duplicate: boolean; record: CommlinkLiveChatRecordV1 } {
    const record = toLiveChatRecord(assertNormalizedChatMessageV1(message));
    const id = messageKey(record);
    const result = this.db.prepare(`
      INSERT INTO commlink_live_chat(
        id, tenant_id, provider, connection_id, channel_id, message_id, occurred_at,
        text, provider_user_id, canonical_user_id, username, body
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING
    `).run(
      id, record.tenantId, record.provider, record.connectionId, record.channelId,
      record.messageId, record.occurredAt, record.text, record.providerUserId,
      record.canonicalUserId ?? null, record.username, JSON.stringify(record),
    );
    return { duplicate: Number(result.changes) === 0, record };
  }

  list(query: CommlinkLiveChatQueryV1): CommlinkLiveChatRecordV1[] {
    requireId(query.tenantId, "tenantId");
    const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be from 1 to 500");
    const where = ["tenant_id = ?"];
    const params: Array<string | number> = [query.tenantId];
    if (query.provider) { assertProvider(query.provider); where.push("provider = ?"); params.push(query.provider); }
    if (query.channelId) { requireId(query.channelId, "channelId"); where.push("channel_id = ?"); params.push(query.channelId); }
    if (query.search) {
      const search = query.search.trim().slice(0, 200);
      if (search) { where.push("(text LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\')"); const pattern = `%${escapeLike(search)}%`; params.push(pattern, pattern); }
    }
    params.push(limit);
    const rows = this.db.prepare(`SELECT body FROM commlink_live_chat WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC, rowid DESC LIMIT ?`).all(...params) as Array<{ body: string }>;
    return rows.map((row) => JSON.parse(row.body) as CommlinkLiveChatRecordV1);
  }

  count(tenantId: string): number {
    requireId(tenantId, "tenantId");
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM commlink_live_chat WHERE tenant_id=?").get(tenantId) as { count: number | bigint };
    return Number(row.count);
  }
}

/** Local consumer retained for isolated app tests and offline migration tools. */
export class CommlinkLiveChatGatewayConsumer {
  readonly id = "commlink-live-chat";
  constructor(private readonly store: CommlinkLiveChatStore) {}
  accepts(message: NormalizedChatMessageV1): boolean { return acceptsProvider(message.provider); }
  deliver(delivery: NormalizedChatDeliveryV1): void {
    if (delivery.consumerId !== this.id) throw new Error("Commlink delivery was routed to the wrong consumer");
    this.store.ingest(delivery.message);
  }
}

/** Production consumer: delivery crosses only the authenticated public SPMT contract. */
export class SpmtCommlinkLiveChatConsumer {
  readonly id = "commlink-live-chat";
  constructor(private readonly client: SpmtClient) {}
  accepts(message: NormalizedChatMessageV1): boolean { return acceptsProvider(message.provider); }
  async deliver(delivery: NormalizedChatDeliveryV1): Promise<void> {
    if (delivery.consumerId !== this.id) throw new Error("Commlink delivery was routed to the wrong consumer");
    await this.client.ingestCommlinkLiveChat(delivery.message.tenantId, delivery.message);
  }
}

export function createCommlinkLiveChatGatewayConsumer(store: CommlinkLiveChatStore) { return new CommlinkLiveChatGatewayConsumer(store); }
export function createSpmtCommlinkLiveChatConsumer(client: SpmtClient) { return new SpmtCommlinkLiveChatConsumer(client); }

function toLiveChatRecord(message: NormalizedChatMessageV1): CommlinkLiveChatRecordV1 {
  return {
    schemaVersion: 1,
    tenantId: message.tenantId,
    provider: message.provider,
    connectionId: message.connectionId,
    channelId: message.channelId,
    ...(message.sourceChannelId ? { sourceChannelId: message.sourceChannelId } : {}),
    messageId: message.messageId,
    occurredAt: new Date(message.occurredAt).toISOString(),
    text: message.text,
    providerUserId: message.actor.providerUserId,
    ...(message.actor.canonicalUserId ? { canonicalUserId: message.actor.canonicalUserId } : {}),
    username: message.actor.username,
    ...(message.actor.displayName ? { displayName: message.actor.displayName } : {}),
    isBot: message.actor.isBot,
    roles: [...message.actor.roles],
  };
}
function acceptsProvider(provider: ChatProviderV1) { return provider === "twitch" || provider === "discord" || provider === "kick"; }
function assertProvider(value: string): asserts value is ChatProviderV1 { if (!acceptsProvider(value as ChatProviderV1)) throw new Error("provider is invalid"); }
function messageKey(record: CommlinkLiveChatRecordV1): string { return [record.tenantId, record.provider, record.connectionId, record.messageId].join(":"); }
function requireId(value: string, name: string): void { if (!value || value.trim() !== value || value.length > 300 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }
