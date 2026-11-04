import { DatabaseSync } from "node:sqlite";
import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";

export const STREAMWEAVER_RELAY_REPLY_TTL_MS = 10 * 60 * 1_000;

export interface StreamWeaverRelayRequestV1 {
  target: string;
  message: string;
}

export interface StreamWeaverRelayEgressV1 {
  send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>;
}

export interface StreamWeaverRelayIdentityV1 {
  tenantId: string;
  provider: NormalizedChatMessageV1["provider"];
  connectionId: string;
  channelId: string;
  providerUserId: string;
  canonicalUserId?: string;
  username: string;
  displayName?: string;
  isBot: boolean;
  lastSeenAt: string;
}

interface RelayEndpointV1 {
  tenantId: string;
  provider: NormalizedChatMessageV1["provider"];
  connectionId: string;
  channelId: string;
  providerUserId: string;
  canonicalUserId?: string;
  username: string;
  displayName: string;
}

interface RelayThreadV1 {
  schemaVersion: 1;
  threadId: string;
  origin: RelayEndpointV1;
  recipient: RelayEndpointV1;
  turns: Array<{ from: string; text: string; at: string }>;
  createdAt: string;
  expiresAt: string;
  deliveryMessageId?: string;
}

export function detectBotRelayRequest(text: string): StreamWeaverRelayRequestV1 | undefined {
  const value = text.trim();
  if (!value || value.length > 8_000) return undefined;
  const patterns = [
    /(?:^|\s)(?:send|pass|relay)(?:\s+(?:a\s+)?message)?\s+to\s+@?([a-z0-9][a-z0-9_.-]{0,63})\s*(?:[:,]\s*|\s+)([\s\S]+)$/i,
    /(?:^|\s)(?:tell|ask|message|dm|notify)\s+@?([a-z0-9][a-z0-9_.-]{0,63})\s*(?:[:,]\s*|\s+)([\s\S]+)$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match) continue;
    const target = normalizeHandle(match[1] ?? "");
    const message = match[2] ?? "";
    if (!target || isRelayStopWord(target) || !message.trim()) return undefined;
    return { target, message };
  }
  return undefined;
}

export function extractRelayQuotedSegments(text: string): string[] {
  return [...text.matchAll(/"[^"\r\n]*"|'[^'\r\n]*'|“[^”\r\n]*”|‘[^’\r\n]*’/g)].map((match) => match[0]);
}

export function preserveRelayQuotedSegments(source: string, candidate: string): string {
  const quoted = extractRelayQuotedSegments(source);
  if (!quoted.length) return candidate;
  const candidateQuoted = extractRelayQuotedSegments(candidate);
  return quoted.every((value, index) => candidateQuoted[index] === value) ? candidate : source;
}

export function extractRelayReplyCommand(text: string): { kind: "reply"; message: string } | { kind: "close" } | undefined {
  const value = text.trim();
  if (/^no[.!]?$/i.test(value)) return { kind: "close" };
  const match = /^(?:reply|yes)\b[\s,:-]*(.*)$/is.exec(value);
  if (!match) return undefined;
  const message = match[1]?.trim() ?? "";
  return message ? { kind: "reply", message } : undefined;
}

export function buildRelayReplyInstructions(expiresAt: string): string {
  return `Reply within 10 minutes with \u201creply <message>\u201d or \u201cyes <message>\u201d. Send \u201cno\u201d to close. Expires ${expiresAt}.`;
}

export class SqliteStreamWeaverBotRelayStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    if (!path) throw new Error("StreamWeaver relay database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streamweaver_relay_identities(
        tenant_id TEXT NOT NULL, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL,
        username_key TEXT NOT NULL, canonical_user_id TEXT, last_seen_at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,provider,provider_user_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS streamweaver_relay_identity_name ON streamweaver_relay_identities(username_key,last_seen_at);
      CREATE TABLE IF NOT EXISTS streamweaver_botshare(
        tenant_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_relay_threads(
        thread_id TEXT PRIMARY KEY, recipient_key TEXT NOT NULL, expires_at TEXT NOT NULL, body TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS streamweaver_relay_thread_recipient ON streamweaver_relay_threads(recipient_key,expires_at);
    `);
  }

  close(): void { this.db.close(); }

  observe(message: NormalizedChatMessageV1): StreamWeaverRelayIdentityV1 {
    const identity: StreamWeaverRelayIdentityV1 = {
      tenantId: message.tenantId, provider: message.provider, connectionId: message.connectionId,
      channelId: message.channelId, providerUserId: message.actor.providerUserId,
      ...(message.actor.canonicalUserId ? { canonicalUserId: message.actor.canonicalUserId } : {}),
      username: message.actor.username,
      ...(message.actor.displayName ? { displayName: message.actor.displayName } : {}),
      isBot: message.actor.isBot, lastSeenAt: timestamp(message.occurredAt, "occurredAt"),
    };
    this.db.prepare("INSERT INTO streamweaver_relay_identities(tenant_id,provider,provider_user_id,username_key,canonical_user_id,last_seen_at,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,provider,provider_user_id) DO UPDATE SET username_key=excluded.username_key,canonical_user_id=excluded.canonical_user_id,last_seen_at=excluded.last_seen_at,body=excluded.body")
      .run(identity.tenantId, identity.provider, identity.providerUserId, normalizeHandle(identity.username), identity.canonicalUserId ?? null, identity.lastSeenAt, JSON.stringify(identity));
    return identity;
  }

  setBotShare(tenantId: string, enabled: boolean, at = this.now()): void {
    this.db.prepare("INSERT INTO streamweaver_botshare(tenant_id,enabled,updated_at) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at")
      .run(id(tenantId, "tenantId"), enabled ? 1 : 0, timestamp(at, "updatedAt"));
  }

  botShareEnabled(tenantId: string): boolean {
    const row = this.db.prepare("SELECT enabled FROM streamweaver_botshare WHERE tenant_id=?").get(id(tenantId, "tenantId")) as { enabled?: number | bigint } | undefined;
    return Number(row?.enabled ?? 0) === 1;
  }

  canAutonomousRelay(sourceTenantId: string, targetTenantId: string): boolean {
    return this.botShareEnabled(sourceTenantId) && this.botShareEnabled(targetTenantId);
  }

  resolveTarget(handle: string, source: NormalizedChatMessageV1): StreamWeaverRelayIdentityV1 | undefined {
    const key = normalizeHandle(handle);
    const rows = this.db.prepare("SELECT body FROM streamweaver_relay_identities WHERE username_key=? ORDER BY CASE WHEN tenant_id=? THEN 0 ELSE 1 END,last_seen_at DESC LIMIT 3")
      .all(key, source.tenantId) as Array<{ body: string }>;
    const identities = rows.map((row) => JSON.parse(row.body) as StreamWeaverRelayIdentityV1)
      .filter((identity) => !(identity.provider === source.provider && identity.providerUserId === source.actor.providerUserId));
    if (!identities.length) {
      const mention = source.mentions.find((item) => normalizeHandle(item.username) === key || normalizeHandle(item.token) === key);
      if (!mention) return undefined;
      return {
        tenantId: source.tenantId, provider: source.provider, connectionId: source.connectionId,
        channelId: source.channelId, providerUserId: mention.providerUserId,
        ...(mention.canonicalUserId ? { canonicalUserId: mention.canonicalUserId } : {}),
        username: mention.username, isBot: false, lastSeenAt: source.occurredAt,
      };
    }
    const distinct = new Set(identities.map((item) => item.canonicalUserId ?? `${item.provider}:${item.providerUserId}`));
    if (distinct.size > 1 && identities[0]?.tenantId !== source.tenantId) return undefined;
    return identities[0];
  }

  openThread(source: NormalizedChatMessageV1, target: StreamWeaverRelayIdentityV1, text: string, deliveryMessageId?: string): RelayThreadV1 {
    const createdAt = timestamp(source.occurredAt, "occurredAt");
    const thread: RelayThreadV1 = {
      schemaVersion: 1,
      threadId: `relay:${source.tenantId}:${source.provider}:${source.messageId}`,
      origin: endpoint(source), recipient: identityEndpoint(target),
      turns: [{ from: endpointKey(endpoint(source)), text, at: createdAt }],
      createdAt, expiresAt: new Date(Date.parse(createdAt) + STREAMWEAVER_RELAY_REPLY_TTL_MS).toISOString(),
      ...(deliveryMessageId ? { deliveryMessageId } : {}),
    };
    this.putThread(thread);
    return thread;
  }

  updateDelivery(threadId: string, providerMessageId: string): void {
    const thread = this.getThread(threadId);
    if (thread) this.putThread({ ...thread, deliveryMessageId: id(providerMessageId, "providerMessageId") });
  }

  pendingReply(message: NormalizedChatMessageV1): RelayThreadV1 | undefined {
    const keys = messageIdentityKeys(message);
    const at = timestamp(message.occurredAt, "occurredAt");
    for (const key of keys) {
      const rows = this.db.prepare("SELECT body FROM streamweaver_relay_threads WHERE recipient_key=? AND expires_at>? ORDER BY expires_at DESC LIMIT 2").all(key, at) as Array<{ body: string }>;
      if (rows.length === 1) return JSON.parse(rows[0]!.body) as RelayThreadV1;
    }
    return undefined;
  }

  closeThread(threadId: string): void { this.db.prepare("DELETE FROM streamweaver_relay_threads WHERE thread_id=?").run(id(threadId, "threadId")); }

  continueThread(thread: RelayThreadV1, text: string, at: string): RelayThreadV1 {
    const next: RelayThreadV1 = {
      ...thread,
      origin: thread.recipient,
      recipient: thread.origin,
      turns: [...thread.turns, { from: endpointKey(thread.recipient), text, at: timestamp(at, "occurredAt") }].slice(-20),
      expiresAt: new Date(Date.parse(at) + STREAMWEAVER_RELAY_REPLY_TTL_MS).toISOString(),
    };
    this.putThread(next);
    return next;
  }

  private getThread(threadId: string): RelayThreadV1 | undefined {
    const row = this.db.prepare("SELECT body FROM streamweaver_relay_threads WHERE thread_id=?").get(id(threadId, "threadId")) as { body?: string } | undefined;
    return row?.body ? JSON.parse(row.body) as RelayThreadV1 : undefined;
  }

  private putThread(thread: RelayThreadV1): void {
    this.db.prepare("INSERT INTO streamweaver_relay_threads(thread_id,recipient_key,expires_at,body) VALUES(?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET recipient_key=excluded.recipient_key,expires_at=excluded.expires_at,body=excluded.body")
      .run(thread.threadId, endpointKey(thread.recipient), thread.expiresAt, JSON.stringify(thread));
  }
}

export class StreamWeaverBotRelayConsumer {
  readonly id = "streamweaver.bot-relay" as const;
  constructor(private readonly store: SqliteStreamWeaverBotRelayStore, private readonly egress: StreamWeaverRelayEgressV1) {}
  accepts(message: NormalizedChatMessageV1): boolean { return this.willHandle(message); }
  willHandle(message: NormalizedChatMessageV1): boolean {
    return Boolean(detectBotRelayRequest(message.text) || (this.store.pendingReply(message) && extractRelayReplyCommand(message.text)));
  }
  async deliver(delivery: NormalizedChatDeliveryV1): Promise<void> {
    const source = delivery.message;
    this.store.observe(source);
    const pending = this.store.pendingReply(source);
    const reply = pending ? extractRelayReplyCommand(source.text) : undefined;
    if (pending && reply) {
      if (reply.kind === "close") {
        this.store.closeThread(pending.threadId);
        await this.egress.send(outboundToMessage(source, source, "Relay conversation closed.", `streamweaver-relay-close:${delivery.deliveryId}`));
        return;
      }
      const text = preserveRelayQuotedSegments(source.text, reply.message);
      const next = this.store.continueThread(pending, text, source.occurredAt);
      const sent = await this.egress.send(outboundToEndpoint(source, next.recipient, compactRelayCard(source, text, next.expiresAt), `streamweaver-relay-reply:${delivery.deliveryId}`));
      this.store.updateDelivery(next.threadId, sent.providerMessageId);
      return;
    }
    const request = detectBotRelayRequest(source.text);
    if (!request) return;
    const target = this.store.resolveTarget(request.target, source);
    if (!target) {
      await this.egress.send(outboundToMessage(source, source, `I could not resolve @${request.target} to one known chat identity.`, `streamweaver-relay-missing:${delivery.deliveryId}`));
      return;
    }
    if (source.actor.isBot && !this.store.canAutonomousRelay(source.tenantId, target.tenantId)) {
      await this.egress.send(outboundToMessage(source, source, "Autonomous bot relay requires BotShare to be enabled by both communities.", `streamweaver-relay-denied:${delivery.deliveryId}`));
      return;
    }
    // Human-directed relays deliberately do not consult BotShare. BotShare only
    // grants autonomous bot-to-bot sharing; it never removes a person's ability
    // to explicitly pass a message to a known recipient.
    const thread = this.store.openThread(source, target, request.message);
    const sent = await this.egress.send(outboundToIdentity(target, compactRelayCard(source, request.message, thread.expiresAt), `streamweaver-relay:${delivery.deliveryId}`));
    this.store.updateDelivery(thread.threadId, sent.providerMessageId);
    if (!source.actor.isBot) await this.egress.send(outboundToMessage(source, source, `Relayed to @${target.username}.`, `streamweaver-relay-ack:${delivery.deliveryId}`));
  }
}

function compactRelayCard(source: NormalizedChatMessageV1, text: string, expiresAt: string): string {
  const name = (source.actor.displayName || source.actor.username).replace(/[\r\n]/g, " ").slice(0, 120);
  return `📡 Relay from ${name} (${source.provider})\n${text}\n\n${buildRelayReplyInstructions(expiresAt)}`;
}
function outboundToIdentity(target: StreamWeaverRelayIdentityV1, text: string, idempotencyKey: string): OutboundChatMessageV1 { return { schemaVersion: 1, tenantId: target.tenantId, provider: target.provider, connectionId: target.connectionId, channelId: target.channelId, text, idempotencyKey }; }
function outboundToEndpoint(source: NormalizedChatMessageV1, target: RelayEndpointV1, text: string, idempotencyKey: string): OutboundChatMessageV1 { return { schemaVersion: 1, tenantId: target.tenantId, provider: target.provider, connectionId: target.connectionId, channelId: target.channelId, text, idempotencyKey, ...(target.tenantId === source.tenantId && target.provider === source.provider && target.channelId === source.channelId ? { replyToMessageId: source.messageId } : {}) }; }
function outboundToMessage(source: NormalizedChatMessageV1, target: NormalizedChatMessageV1, text: string, idempotencyKey: string): OutboundChatMessageV1 { return { schemaVersion: 1, tenantId: target.tenantId, provider: target.provider, connectionId: target.connectionId, channelId: target.channelId, text, idempotencyKey, replyToMessageId: source.messageId }; }
function endpoint(message: NormalizedChatMessageV1): RelayEndpointV1 { return { tenantId: message.tenantId, provider: message.provider, connectionId: message.connectionId, channelId: message.channelId, providerUserId: message.actor.providerUserId, ...(message.actor.canonicalUserId ? { canonicalUserId: message.actor.canonicalUserId } : {}), username: message.actor.username, displayName: message.actor.displayName || message.actor.username }; }
function identityEndpoint(identity: StreamWeaverRelayIdentityV1): RelayEndpointV1 { return { tenantId: identity.tenantId, provider: identity.provider, connectionId: identity.connectionId, channelId: identity.channelId, providerUserId: identity.providerUserId, ...(identity.canonicalUserId ? { canonicalUserId: identity.canonicalUserId } : {}), username: identity.username, displayName: identity.displayName || identity.username }; }
function messageIdentityKeys(message: NormalizedChatMessageV1): string[] { return [...new Set([message.actor.canonicalUserId ? `canonical:${message.actor.canonicalUserId}` : "", `provider:${message.provider}:${message.actor.providerUserId}`].filter(Boolean))]; }
function endpointKey(value: RelayEndpointV1): string { return value.canonicalUserId ? `canonical:${value.canonicalUserId}` : `provider:${value.provider}:${value.providerUserId}`; }
function normalizeHandle(value: string): string { return value.trim().replace(/^@/, "").toLowerCase(); }
function isRelayStopWord(value: string): boolean { return new Set(["me", "them", "him", "her", "it", "everyone", "everybody", "all", "chat"]).has(value); }
function id(value: string, name: string): string { if (!value || value.trim() !== value || value.length > 500 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); return value; }
function timestamp(value: string, name: string): string { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(`${name} is invalid`); return new Date(parsed).toISOString(); }
