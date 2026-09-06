import { DatabaseSync } from "node:sqlite";
import {
  assertNormalizedChatMessageV1, normalizeCommlinkRichContent, normalizeCommlinkProviderMutation, type CommlinkProviderMutationV1,
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
      CREATE TABLE IF NOT EXISTS commlink_provider_mutations(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
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
    this.applyMutation(id);
    const current=this.db.prepare("SELECT body FROM commlink_live_chat WHERE id=?").get(id)!;
    return { duplicate: Number(result.changes) === 0, record:JSON.parse(String(current.body)) as CommlinkLiveChatRecordV1 };
  }

  mutate(input:CommlinkProviderMutationV1) {
    const value=normalizeCommlinkProviderMutation(input),id=mutationKey(value);this.db.exec("BEGIN IMMEDIATE");
    try {const row=this.db.prepare("SELECT body FROM commlink_provider_mutations WHERE id=?").get(id),prior=row?JSON.parse(String(row.body)) as CommlinkProviderMutationV1:undefined;
      const duplicate=Boolean(prior&&(prior.operation==="delete"||(value.operation==="edit"&&Date.parse(prior.occurredAt)>Date.parse(value.occurredAt))||JSON.stringify(prior)===JSON.stringify(value)));
      if(!duplicate){const next=value.operation==="delete"?value:{...prior,...value};this.db.prepare("INSERT INTO commlink_provider_mutations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(id,JSON.stringify(next));}
      const record=this.applyMutation(messageKey(value));this.db.exec("COMMIT");return {duplicate,record:record?.channelId===value.channelId?record:undefined};
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  private applyMutation(id:string){
    const source=this.db.prepare("SELECT body FROM commlink_live_chat WHERE id=?").get(id);if(!source)return undefined;
    let record=JSON.parse(String(source.body)) as CommlinkLiveChatRecordV1;const patch=this.db.prepare("SELECT body FROM commlink_provider_mutations WHERE id=?").get(mutationKey(record));if(!patch)return record;const value=JSON.parse(String(patch.body)) as CommlinkProviderMutationV1;
    record=value.operation==="delete"?{...record,text:"[Message removed]",rich:{source:"discord",eventType:"delete",attachments:[],deleted:true}}:{...record,...(value.text!==undefined?{text:value.text||"[Message has no text]"}:{}),...(value.rich?{rich:value.rich}:{})};
    this.db.prepare("UPDATE commlink_live_chat SET text=?,body=? WHERE id=?").run(record.text,JSON.stringify(record),id);return record;
  }

  ingestMirror(record:CommlinkLiveChatRecordV1,operation:"message"|"edit"|"delete") {
    if(!["social-stream","tiktok"].includes(record.provider)||record.canonicalUserId||record.roles.length)throw new Error("Invalid mirrored chat identity");
    const id=messageKey(record),prior=this.db.prepare("SELECT body FROM commlink_live_chat WHERE id=?").get(id);
    if(prior&&operation==="message")return {duplicate:true,record:JSON.parse(String(prior.body)) as CommlinkLiveChatRecordV1};
    if(operation==="delete"){record={...record,text:"[Message removed]",rich:{source:record.rich?.source??"social-stream",eventType:"delete",attachments:[],deleted:true}};}
    this.db.prepare("INSERT INTO commlink_live_chat VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,body=excluded.body").run(id,record.tenantId,record.provider,record.connectionId,record.channelId,record.messageId,record.occurredAt,record.text,record.providerUserId,null,record.username,JSON.stringify(record));
    return {duplicate:false,record};
  }
  list(query: CommlinkLiveChatQueryV1): CommlinkLiveChatRecordV1[] {
    requireId(query.tenantId, "tenantId");
    const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be from 1 to 500");
    const where = ["tenant_id = ?"];
    const params: Array<string | number> = [query.tenantId];
    if (query.provider) { if(!["social-stream","tiktok"].includes(query.provider))assertProvider(query.provider); where.push("provider = ?"); params.push(query.provider); }
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
    ...(message.rich?{rich:normalizeCommlinkRichContent(message.rich)}:{}),
    providerUserId: message.actor.providerUserId,
    ...(message.actor.canonicalUserId ? { canonicalUserId: message.actor.canonicalUserId } : {}),
    username: message.actor.username,
    ...(message.actor.displayName ? { displayName: message.actor.displayName } : {}),
    isBot: message.actor.isBot,
    roles: [...message.actor.roles],
  };
}
function acceptsProvider(provider: ChatProviderV1) { return provider === "twitch" || provider === "discord" || provider === "kick" || provider === "youtube"; }
function assertProvider(value: string): asserts value is ChatProviderV1 { if (!acceptsProvider(value as ChatProviderV1)) throw new Error("provider is invalid"); }
function messageKey(record: Pick<CommlinkLiveChatRecordV1,"tenantId"|"provider"|"connectionId"|"channelId"|"messageId">): string { return [record.tenantId, record.provider, record.connectionId, record.messageId].join(":"); }
function requireId(value: string, name: string): void { if (!value || value.trim() !== value || value.length > 300 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }

export * from "./operator.js";
export * from './social-stream.js';

function mutationKey(record:Pick<CommlinkLiveChatRecordV1,"tenantId"|"provider"|"connectionId"|"channelId"|"messageId">){return JSON.stringify([record.tenantId,record.provider,record.connectionId,record.channelId,record.messageId]);}

export * from "./tiktok.js";
