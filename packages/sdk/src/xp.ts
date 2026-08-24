export const SPMT_XP_LEDGER_SCHEMA_VERSION = 1 as const;

export const SPMT_XP_EVENT_MAP_V1 = {
  "chat-tag.tag": { sourceApp: "chat-tag", eventType: "chat-tag-tag", defaultDelta: 100 },
  "chat-tag.pass": { sourceApp: "chat-tag", eventType: "chat-tag-pass", defaultDelta: 200 },
  "chat-tag.bingo.square": { sourceApp: "chat-tag", eventType: "chat-tag-bingo-square", defaultDelta: 10 },
  "chat-tag.bingo.win": { sourceApp: "chat-tag", eventType: "chat-tag-bingo-win", defaultDelta: 250 },
  "dsh.discord.message": { sourceApp: "discord-stream-hub", eventType: "dsh-discord-message", defaultDelta: 1 },
  "dsh.twitch.message": { sourceApp: "discord-stream-hub", eventType: "dsh-twitch-message", defaultDelta: 10 },
  "dsh.twitch.follow": { sourceApp: "discord-stream-hub", eventType: "dsh-twitch-follow", defaultDelta: 25 },
  "dsh.twitch.raid": { sourceApp: "discord-stream-hub", eventType: "dsh-twitch-raid", defaultDelta: 50 },
  "dsh.twitch.sub": { sourceApp: "discord-stream-hub", eventType: "dsh-twitch-sub", defaultDelta: 100 },
  "spacemountain.tool.trigger": { sourceApp: "spacemountain", eventType: "spacemountain-tool-trigger", defaultDelta: 5 },
  "spacemountain.arena.kill": { sourceApp: "spacemountain", eventType: "spacemountain-arena-kill", defaultDelta: 1 },
} as const;

export type XpMappedEventTypeV1 = keyof typeof SPMT_XP_EVENT_MAP_V1;

export type XpLedgerMetadataV1 = {
  schemaVersion?: 1;
  tenantId?: string;
  sourceId?: string;
  sourceName?: string;
  channelId?: string;
  channelName?: string;
  upstreamEventId?: string;
  reason?: string;
  summary?: string;
  [key: string]: unknown;
};

export type XpAwardInput = {
  userId: string;
  eventType: string;
  idempotencyKey: string;
  delta: number;
  sourceApp?: string;
  metadata?: XpLedgerMetadataV1;
};

export type XpAwardValidationResult =
  | { ok: true; award: XpAwardInput }
  | { ok: false; errors: string[] };

/** Production-compatible idempotency key used by donor SPMT/DSH producers. */
export function buildXpIdempotencyKey(parts: {
  sourceApp: string;
  eventType: string;
  upstreamEventId: string;
  userId: string;
}): string {
  return [
    cleanXpKeyPart(parts.sourceApp),
    cleanXpKeyPart(parts.eventType),
    cleanXpKeyPart(parts.upstreamEventId),
    cleanXpKeyPart(parts.userId),
  ].join(":").slice(0, 200);
}

export function mappedXpAwardV1(input: {
  userId: string;
  mappedEventType: XpMappedEventTypeV1;
  upstreamEventId: string;
  deltaOverride?: number;
  metadata?: XpLedgerMetadataV1;
}): XpAwardInput {
  const mapping = SPMT_XP_EVENT_MAP_V1[input.mappedEventType];
  return {
    userId: input.userId,
    sourceApp: mapping.sourceApp,
    eventType: mapping.eventType,
    idempotencyKey: buildXpIdempotencyKey({
      sourceApp: mapping.sourceApp,
      eventType: mapping.eventType,
      upstreamEventId: input.upstreamEventId,
      userId: input.userId,
    }),
    delta: input.deltaOverride ?? mapping.defaultDelta,
    metadata: { schemaVersion: SPMT_XP_LEDGER_SCHEMA_VERSION, upstreamEventId: input.upstreamEventId, ...input.metadata },
  };
}

export function validateXpAwardV1(input: unknown): XpAwardValidationResult {
  const errors: string[] = [];
  const award = input as Partial<XpAwardInput> | null | undefined;
  if (!award || typeof award !== "object") return { ok: false, errors: ["award must be an object"] };
  requireString(award.userId, "userId", errors);
  requireString(award.eventType, "eventType", errors);
  requireString(award.idempotencyKey, "idempotencyKey", errors);
  if (isNonEmptyString(award.idempotencyKey) && award.idempotencyKey.length > 200) errors.push("idempotencyKey must be 200 characters or fewer");
  if (!Number.isInteger(award.delta) || Math.abs(Number(award.delta)) > 10000) errors.push("delta must be an integer from -10000 to 10000");
  if (award.sourceApp !== undefined) requireString(award.sourceApp, "sourceApp", errors);
  if (award.metadata !== undefined && (!award.metadata || typeof award.metadata !== "object" || Array.isArray(award.metadata))) errors.push("metadata must be an object");
  return errors.length ? { ok: false, errors } : { ok: true, award: award as XpAwardInput };
}

function cleanXpKeyPart(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function requireString(value: unknown, field: string, errors: string[]) { if (!isNonEmptyString(value)) errors.push(`${field} is required`); }
