import { DatabaseSync } from "node:sqlite";
import type { ExecutionJobV1, NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";

export interface StreamWeaverPersonaConfigV1 {
  schemaVersion: 1;
  tenantId: string;
  personaId: string;
  displayName: string;
  aliases: string[];
  ownerCanonicalUserId: string;
  homeChannelIds: string[];
  summonWindowMs: number;
}

export interface StreamWeaverPersonaInvocationV1 {
  schemaVersion: 1;
  tenantId: string;
  personaId: string;
  userId: string;
  message: string;
  surface: "stream";
  provider: NormalizedChatMessageV1["provider"];
  channelId: string;
  conversationId: string;
  idempotencyKey: string;
  occurredAt: string;
}

export interface StreamWeaverPersonaRuntimeV1 {
  invoke(input: StreamWeaverPersonaInvocationV1): Promise<{ status: "accepted"; jobId: string } | { status: "unavailable"; reason: string }>;
}
export interface StreamWeaverChatEgressV1 { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>; }
export interface StreamWeaverPersonaConfigSourceV1 { get(tenantId: string): StreamWeaverPersonaConfigV1 | undefined | Promise<StreamWeaverPersonaConfigV1 | undefined>; }
export interface StreamWeaverAssistantClientV1 {
  invokeCommunityAssistant(tenantId: string, input: { userId: string; message: string; surface: "stream"; conversationId: string; routingPreference: "automatic"; remember: true }, idempotencyKey: string): Promise<{ status: "accepted"; jobId: string } | { status: "unavailable"; reason: string }>;
  getExecutionJob(tenantId: string, jobId: string): Promise<ExecutionJobV1>;
}

export interface StreamWeaverPersonaReplyV1 {
  schemaVersion: 1;
  tenantId: string;
  deliveryId: string;
  jobId: string;
  displayName: string;
  provider: NormalizedChatMessageV1["provider"];
  connectionId: string;
  channelId: string;
  replyToMessageId: string;
  createdAt: string;
  state: "pending" | "sent" | "failed";
  attempts: number;
  availableAt: string;
  lastError?: string;
  providerMessageId?: string;
  completedAt?: string;
}

export type StreamWeaverPersonaRouteV1 =
  | { kind: "ignored"; reason: "bot" | "not-addressed" | "outside-summon-window" }
  | { kind: "invoke"; invocation: StreamWeaverPersonaInvocationV1; openSummonUntil?: string };

export class SqliteStreamWeaverSummonStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("StreamWeaver summon database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS persona_summons(tenant_id TEXT NOT NULL,provider TEXT NOT NULL,channel_id TEXT NOT NULL,persona_id TEXT NOT NULL,opened_by_user_id TEXT NOT NULL,expires_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,provider,channel_id,persona_id)) STRICT;");
    this.db.exec("CREATE TABLE IF NOT EXISTS persona_reply_outbox(delivery_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,job_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','sent','failed')),attempts INTEGER NOT NULL,available_at TEXT NOT NULL,last_error TEXT,provider_message_id TEXT,completed_at TEXT,body TEXT NOT NULL) STRICT; CREATE INDEX IF NOT EXISTS persona_reply_outbox_pending ON persona_reply_outbox(state,available_at,tenant_id);");
  }
  close(): void { this.db.close(); }
  get(tenantId: string, provider: string, channelId: string, personaId: string): { expiresAt: string } | undefined {
    return this.db.prepare("SELECT expires_at AS expiresAt FROM persona_summons WHERE tenant_id=? AND provider=? AND channel_id=? AND persona_id=?").get(tenantId, provider, channelId, personaId) as { expiresAt: string } | undefined;
  }
  open(input: { tenantId: string; provider: string; channelId: string; personaId: string; openedByUserId: string; expiresAt: string }): void {
    this.db.prepare("INSERT INTO persona_summons(tenant_id,provider,channel_id,persona_id,opened_by_user_id,expires_at,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,provider,channel_id,persona_id) DO UPDATE SET opened_by_user_id=excluded.opened_by_user_id,expires_at=excluded.expires_at,body=excluded.body").run(input.tenantId, input.provider, input.channelId, input.personaId, input.openedByUserId, input.expiresAt, JSON.stringify(input));
  }
  enqueueReply(input: Omit<StreamWeaverPersonaReplyV1, "state" | "attempts" | "availableAt">): { duplicate: boolean; reply: StreamWeaverPersonaReplyV1 } {
    const body = replyBody(input);
    const encoded = JSON.stringify(body);
    const inserted = Number(this.db.prepare("INSERT INTO persona_reply_outbox(delivery_id,tenant_id,job_id,state,attempts,available_at,body) VALUES(?,?,?,'pending',0,?,?) ON CONFLICT(delivery_id) DO NOTHING").run(body.deliveryId, body.tenantId, body.jobId, body.createdAt, encoded).changes);
    const reply = this.getReply(body.deliveryId);
    if (!reply) throw new Error("StreamWeaver reply outbox did not persist the accepted job");
    if (JSON.stringify(replyBody(reply)) !== encoded) throw new Error("StreamWeaver reply delivery was reused for a different job");
    return { duplicate: inserted === 0, reply };
  }
  getReply(deliveryId: string): StreamWeaverPersonaReplyV1 | undefined {
    const row = this.db.prepare("SELECT body,state,attempts,available_at AS availableAt,last_error AS lastError,provider_message_id AS providerMessageId,completed_at AS completedAt FROM persona_reply_outbox WHERE delivery_id=?").get(required(deliveryId, "deliveryId")) as ReplyRow | undefined;
    return row ? hydrateReply(row) : undefined;
  }
  listPendingReplies(now: string, tenantId?: string, limit = 100): StreamWeaverPersonaReplyV1[] {
    const at = timestamp(now, "now");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("reply limit must be from 1 to 500");
    const rows = tenantId
      ? this.db.prepare("SELECT body,state,attempts,available_at AS availableAt,last_error AS lastError,provider_message_id AS providerMessageId,completed_at AS completedAt FROM persona_reply_outbox WHERE state='pending' AND available_at<=? AND tenant_id=? ORDER BY rowid LIMIT ?").all(at, required(tenantId, "tenantId"), limit)
      : this.db.prepare("SELECT body,state,attempts,available_at AS availableAt,last_error AS lastError,provider_message_id AS providerMessageId,completed_at AS completedAt FROM persona_reply_outbox WHERE state='pending' AND available_at<=? ORDER BY rowid LIMIT ?").all(at, limit);
    return (rows as unknown as ReplyRow[]).map(hydrateReply);
  }
  deferReply(deliveryId: string, availableAt: string, error?: string): void {
    this.db.prepare("UPDATE persona_reply_outbox SET attempts=attempts+1,available_at=?,last_error=? WHERE delivery_id=? AND state='pending'").run(timestamp(availableAt, "availableAt"), error ? safeError(error) : null, required(deliveryId, "deliveryId"));
  }
  completeReply(deliveryId: string, providerMessageId: string, completedAt: string): void {
    this.db.prepare("UPDATE persona_reply_outbox SET state='sent',provider_message_id=?,completed_at=?,last_error=NULL WHERE delivery_id=? AND state='pending'").run(required(providerMessageId, "providerMessageId"), timestamp(completedAt, "completedAt"), required(deliveryId, "deliveryId"));
  }
  failReply(deliveryId: string, error: string, completedAt: string): void {
    this.db.prepare("UPDATE persona_reply_outbox SET state='failed',last_error=?,completed_at=? WHERE delivery_id=? AND state='pending'").run(safeError(error), timestamp(completedAt, "completedAt"), required(deliveryId, "deliveryId"));
  }
}

export class SpmtStreamWeaverPersonaRuntime implements StreamWeaverPersonaRuntimeV1 {
  constructor(private readonly client: Pick<StreamWeaverAssistantClientV1, "invokeCommunityAssistant">) {}
  invoke(input: StreamWeaverPersonaInvocationV1) {
    return this.client.invokeCommunityAssistant(input.tenantId, { userId: input.userId, message: input.message, surface: "stream", conversationId: input.conversationId, routingPreference: "automatic", remember: true }, input.idempotencyKey);
  }
}

export class StreamWeaverPersonaReplyReconciler {
  private readonly now: () => string;
  private readonly retryDelayMs: number;
  private readonly requesterAppId: string;
  constructor(private readonly store: SqliteStreamWeaverSummonStore, private readonly client: Pick<StreamWeaverAssistantClientV1, "getExecutionJob">, private readonly egress: StreamWeaverChatEgressV1, options: { now?: () => string; retryDelayMs?: number; requesterAppId?: string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.requesterAppId = options.requesterAppId ?? "streamweaver";
    if (!Number.isSafeInteger(this.retryDelayMs) || this.retryDelayMs < 100 || this.retryDelayMs > 60_000) throw new Error("StreamWeaver reply retry delay is invalid");
  }
  async runOnce(tenantId?: string, limit = 100) {
    const replies = this.store.listPendingReplies(this.now(), tenantId, limit);
    const report = { observed: replies.length, waiting: 0, sent: 0, deferred: 0, rejected: 0 };
    for (const reply of replies) {
      try {
        const job = await this.client.getExecutionJob(reply.tenantId, reply.jobId);
        if (!this.owns(reply, job)) { this.store.failReply(reply.deliveryId, "Accepted job no longer matches its StreamWeaver delivery", this.now()); report.rejected += 1; continue; }
        if (["queued", "leased", "running"].includes(job.state)) { this.defer(reply); report.waiting += 1; continue; }
        const text = terminalReplyText(reply, job);
        const sent = await this.egress.send({ schemaVersion: 1, tenantId: reply.tenantId, provider: reply.provider, connectionId: reply.connectionId, channelId: reply.channelId, text, idempotencyKey: `streamweaver-persona-result:${reply.deliveryId}`, replyToMessageId: reply.replyToMessageId });
        this.store.completeReply(reply.deliveryId, sent.providerMessageId, this.now());
        report.sent += 1;
      } catch (error) {
        this.defer(reply, error instanceof Error ? error.message : "StreamWeaver reply reconciliation failed");
        report.deferred += 1;
      }
    }
    return report;
  }
  async run(signal: AbortSignal, options: { tenantId?: string; pollMs?: number; limit?: number } = {}) {
    const pollMs = options.pollMs ?? 1_000;
    if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60_000) throw new Error("StreamWeaver reply poll interval is invalid");
    while (!signal.aborted) { await this.runOnce(options.tenantId, options.limit); await pause(pollMs, signal); }
  }
  private owns(reply: StreamWeaverPersonaReplyV1, job: ExecutionJobV1) {
    return job.tenantId === reply.tenantId && job.id === reply.jobId && job.ownerAppId === "stellar-core" && job.capabilityId === "stellar-core.ai-chat.v1" && job.requestedByType === "service" && job.requestedById === this.requesterAppId && job.input.callerAppId === this.requesterAppId;
  }
  private defer(reply: StreamWeaverPersonaReplyV1, error?: string) { this.store.deferReply(reply.deliveryId, new Date(Date.parse(this.now()) + this.retryDelayMs).toISOString(), error); }
}

export class StreamWeaverChatGatewayConsumer {
  readonly id = "streamweaver.persona" as const;
  constructor(private readonly summons: SqliteStreamWeaverSummonStore, private readonly configs: StreamWeaverPersonaConfigSourceV1, private readonly personas: StreamWeaverPersonaRuntimeV1, private readonly egress: StreamWeaverChatEgressV1) {}
  accepts(message: NormalizedChatMessageV1): boolean { return !message.actor.isBot; }
  async deliver(delivery: NormalizedChatDeliveryV1): Promise<void> {
    const config = await this.configs.get(delivery.message.tenantId);
    if (!config) return;
    const active = this.summons.get(config.tenantId, delivery.message.provider, delivery.message.channelId, config.personaId);
    const route = planStreamWeaverPersonaRoute(delivery, config, active?.expiresAt);
    if (route.kind === "ignored") return;
    if (route.openSummonUntil) this.summons.open({ tenantId: config.tenantId, provider: delivery.message.provider, channelId: delivery.message.channelId, personaId: config.personaId, openedByUserId: route.invocation.userId, expiresAt: route.openSummonUntil });
    const result = await this.personas.invoke(route.invocation);
    if (result.status === "accepted") {
      this.summons.enqueueReply({ schemaVersion: 1, tenantId: delivery.message.tenantId, deliveryId: delivery.deliveryId, jobId: result.jobId, displayName: config.displayName, provider: delivery.message.provider, connectionId: delivery.message.connectionId, channelId: delivery.message.channelId, replyToMessageId: delivery.message.messageId, createdAt: delivery.message.occurredAt });
      return;
    }
    await this.egress.send({ schemaVersion: 1, tenantId: delivery.message.tenantId, provider: delivery.message.provider, connectionId: delivery.message.connectionId, channelId: delivery.message.channelId, text: config.displayName + " is unavailable: " + result.reason, idempotencyKey: "streamweaver-unavailable:" + delivery.deliveryId, replyToMessageId: delivery.message.messageId });
  }
}

export function planStreamWeaverPersonaRoute(delivery: NormalizedChatDeliveryV1, config: StreamWeaverPersonaConfigV1, activeSummonExpiresAt?: string): StreamWeaverPersonaRouteV1 {
  assertConfig(config);
  const message = delivery.message;
  if (message.actor.isBot) return { kind: "ignored", reason: "bot" };
  const owner = message.actor.canonicalUserId === config.ownerCanonicalUserId;
  const explicit = mentioned(message.text, config.aliases);
  const casual = addressed(message.text, config.aliases);
  const home = config.homeChannelIds.includes(message.channelId);
  const now = Date.parse(message.occurredAt);
  const active = Boolean(activeSummonExpiresAt && Number.isFinite(Date.parse(activeSummonExpiresAt)) && Date.parse(activeSummonExpiresAt) > now);
  if (!owner && !explicit) return { kind: "ignored", reason: "not-addressed" };
  if (!owner && !home && !active) return { kind: "ignored", reason: "outside-summon-window" };
  if (owner && !casual) return { kind: "ignored", reason: "not-addressed" };
  const userId = message.actor.canonicalUserId ?? "provider:" + message.provider + ":" + message.actor.providerUserId;
  const invocation: StreamWeaverPersonaInvocationV1 = { schemaVersion: 1, tenantId: config.tenantId, personaId: config.personaId, userId, message: stripAddress(message.text, config.aliases), surface: "stream", provider: message.provider, channelId: message.channelId, conversationId: "chat:" + message.provider + ":" + message.channelId, idempotencyKey: "streamweaver-persona:" + delivery.deliveryId, occurredAt: message.occurredAt };
  const openSummonUntil = owner && !home ? new Date(now + config.summonWindowMs).toISOString() : undefined;
  return { kind: "invoke", invocation, ...(openSummonUntil ? { openSummonUntil } : {}) };
}

function mentioned(text: string, aliases: string[]): boolean { return aliases.some((alias) => new RegExp("(^|\\s)@" + escapeRegex(alias) + "(?:\\b|$)", "i").test(text)); }
function addressed(text: string, aliases: string[]): boolean { return aliases.some((alias) => new RegExp("(^|[^a-z0-9_])(?:@|!|hey\\s+)?" + escapeRegex(alias) + "(?:[^a-z0-9_]|$)", "i").test(text)); }
function stripAddress(text: string, aliases: string[]): string { let value = text.trim(); for (const alias of aliases) value = value.replace(new RegExp("^(?:hey\\s+)?[!@]?" + escapeRegex(alias) + "[,!:;\\s-]*", "i"), ""); return value.trim() || text.trim(); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function assertConfig(config: StreamWeaverPersonaConfigV1): void { if (config.schemaVersion !== 1 || !config.tenantId || !config.personaId || !config.displayName || !config.ownerCanonicalUserId || !config.aliases.length || !Number.isSafeInteger(config.summonWindowMs) || config.summonWindowMs < 1) throw new Error("StreamWeaver persona config is invalid"); }
type ReplyRow = { body: string; state: StreamWeaverPersonaReplyV1["state"]; attempts: number | bigint; availableAt: string; lastError?: string | null; providerMessageId?: string | null; completedAt?: string | null };
function hydrateReply(row: ReplyRow): StreamWeaverPersonaReplyV1 { const body = replyBody(JSON.parse(row.body) as StreamWeaverPersonaReplyV1); return { ...body, state: row.state, attempts: Number(row.attempts), availableAt: timestamp(row.availableAt, "availableAt"), ...(row.lastError ? { lastError: row.lastError } : {}), ...(row.providerMessageId ? { providerMessageId: row.providerMessageId } : {}), ...(row.completedAt ? { completedAt: timestamp(row.completedAt, "completedAt") } : {}) }; }
function replyBody(input: Omit<StreamWeaverPersonaReplyV1, "state" | "attempts" | "availableAt"> | StreamWeaverPersonaReplyV1) { return { schemaVersion: 1 as const, tenantId: required(input.tenantId, "tenantId"), deliveryId: required(input.deliveryId, "deliveryId"), jobId: required(input.jobId, "jobId"), displayName: label(input.displayName, "displayName"), provider: input.provider, connectionId: required(input.connectionId, "connectionId"), channelId: required(input.channelId, "channelId"), replyToMessageId: required(input.replyToMessageId, "replyToMessageId"), createdAt: timestamp(input.createdAt, "createdAt") }; }
function terminalReplyText(reply: StreamWeaverPersonaReplyV1, job: ExecutionJobV1) { if (job.state === "succeeded") { const text = typeof job.result?.text === "string" ? job.result.text.trim() : ""; if (job.result?.kind === "stellar-chat-result.v1" && text) return text.slice(0, 8_000); return `${reply.displayName} could not deliver a valid response.`; } if (job.state === "cancelled") return `${reply.displayName}'s response was cancelled.`; if (job.state === "dead-letter") return `${reply.displayName} could not complete that request after retries.`; return `${reply.displayName} could not complete that request.`; }
function required(value: string, name: string) { if (!value || value.trim() !== value || value.length > 500 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); return value; }
function label(value: string, name: string) { const normalized = value.trim(); if (!normalized || normalized.length > 120 || /[\r\n]/.test(normalized)) throw new Error(`${name} is invalid`); return normalized; }
function timestamp(value: string, name: string) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(`${name} is invalid`); return new Date(parsed).toISOString(); }
function safeError(value: string) { return value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").replace(/[\r\n]+/g, " ").slice(0, 1_000); }
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((resolve) => { if (signal.aborted) return resolve(); const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
