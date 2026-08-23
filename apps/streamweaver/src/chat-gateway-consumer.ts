import { DatabaseSync } from "node:sqlite";
import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";

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
  }
  close(): void { this.db.close(); }
  get(tenantId: string, provider: string, channelId: string, personaId: string): { expiresAt: string } | undefined {
    return this.db.prepare("SELECT expires_at AS expiresAt FROM persona_summons WHERE tenant_id=? AND provider=? AND channel_id=? AND persona_id=?").get(tenantId, provider, channelId, personaId) as { expiresAt: string } | undefined;
  }
  open(input: { tenantId: string; provider: string; channelId: string; personaId: string; openedByUserId: string; expiresAt: string }): void {
    this.db.prepare("INSERT INTO persona_summons(tenant_id,provider,channel_id,persona_id,opened_by_user_id,expires_at,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,provider,channel_id,persona_id) DO UPDATE SET opened_by_user_id=excluded.opened_by_user_id,expires_at=excluded.expires_at,body=excluded.body").run(input.tenantId, input.provider, input.channelId, input.personaId, input.openedByUserId, input.expiresAt, JSON.stringify(input));
  }
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
    if (result.status === "accepted") return;
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
