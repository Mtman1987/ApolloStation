export type HumanReferenceKindV1 = "user" | "guild" | "channel" | "message" | "unknown";

export interface HumanReferenceInputV1 {
  provider?: string;
  kind: HumanReferenceKindV1;
  id: string;
  guildId?: string;
  channelId?: string;
  labelHint?: string;
  textHint?: string;
}

export interface HumanReferenceV1 extends HumanReferenceInputV1 {
  schemaVersion: 1;
  label: string;
  resolved: boolean;
  secondary?: string;
  url?: string;
}

export interface HumanReferenceBatchV1 {
  schemaVersion: 1;
  references: HumanReferenceV1[];
}

const ID = /^[A-Za-z0-9:_-]{1,300}$/;
const PROVIDER = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const DISCORD_ID = /^\d{5,30}$/;

export function normalizeHumanReferenceInputs(value: unknown): HumanReferenceInputV1[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error("Reference batch must contain at most 200 items");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Reference ${index + 1} is invalid`);
    const raw = item as Record<string, unknown>;
    const kind = raw.kind;
    if (!(["user", "guild", "channel", "message", "unknown"] as const).includes(kind as HumanReferenceKindV1)) throw new Error(`Reference ${index + 1} kind is invalid`);
    const id = clean(raw.id, "id", 300);
    if (!ID.test(id)) throw new Error(`Reference ${index + 1} id is invalid`);
    const provider = optional(raw.provider, 64);
    if (provider && !PROVIDER.test(provider)) throw new Error(`Reference ${index + 1} provider is invalid`);
    const guildId = optional(raw.guildId, 300), channelId = optional(raw.channelId, 300);
    const labelHint = optional(raw.labelHint, 200), textHint = optional(raw.textHint, 500);
    return {
      kind: kind as HumanReferenceKindV1,
      id,
      ...(provider ? { provider: provider.toLowerCase() } : {}),
      ...(guildId ? { guildId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(labelHint ? { labelHint } : {}),
      ...(textHint ? { textHint } : {}),
    };
  });
}

/** Stable within a tenant-scoped response/cache. Tenant id belongs outside this portable key. */
export function humanReferenceKey(input: Pick<HumanReferenceInputV1, "provider" | "kind" | "id" | "guildId" | "channelId">): string {
  return [input.provider ?? "", input.kind, input.id, input.guildId ?? "", input.channelId ?? ""].join(":");
}

/**
 * Extract only context-labelled opaque identifiers. We intentionally do not turn every long
 * number into a Discord lookup: logs contain timestamps, counters, transaction ids and money.
 */
export function discoverHumanReferencesInText(text: string): HumanReferenceInputV1[] {
  if (!text) return [];
  const refs: HumanReferenceInputV1[] = [];
  const add = (kind: HumanReferenceKindV1, id: string, provider = "discord") => {
    if (DISCORD_ID.test(id)) refs.push({ provider, kind, id });
  };
  const patterns: Array<[HumanReferenceKindV1, RegExp]> = [
    ["guild", /\b(?:guild|server)(?:[\s_-]*id)?\b\s*["']?\s*[:=#-]?\s*["']?(\d{5,30})/gi],
    ["channel", /\b(?:channel|room)(?:[\s_-]*id)?\b\s*["']?\s*[:=#-]?\s*["']?(\d{5,30})/gi],
    ["message", /\b(?:message|msg)(?:[\s_-]*id)?\b\s*["']?\s*[:=#-]?\s*["']?(\d{5,30})/gi],
    ["user", /\b(?:provider[\s_-]*user|user|member|author|sender|recipient)(?:[\s_-]*id)?\b\s*["']?\s*[:=#-]?\s*["']?(\d{5,30})/gi],
  ];
  for (const [kind, pattern] of patterns) for (const match of text.matchAll(pattern)) if (match[1]) add(kind, match[1]);
  for (const match of text.matchAll(/<@!?(\d{5,30})>/g)) if (match[1]) add("user", match[1]);
  for (const match of text.matchAll(/<#(\d{5,30})>/g)) if (match[1]) add("channel", match[1]);

  const unique = [...new Map(refs.map((ref) => [humanReferenceKey(ref), ref])).values()];
  const channels = unique.filter((ref) => ref.kind === "channel");
  const guilds = unique.filter((ref) => ref.kind === "guild");
  const onlyChannel = channels.length === 1 ? channels[0]!.id : undefined;
  const onlyGuild = guilds.length === 1 ? guilds[0]!.id : undefined;
  return unique.map((ref) => ({
    ...ref,
    ...(onlyGuild && ref.kind !== "guild" && !ref.guildId ? { guildId: onlyGuild } : {}),
    ...(onlyChannel && (ref.kind === "message" || ref.kind === "user") && !ref.channelId ? { channelId: onlyChannel } : {}),
  }));
}

export function humanizeTextWithReferences(text: string, references: readonly HumanReferenceV1[]): string {
  let result = text;
  const byId = new Map<string, HumanReferenceV1>();
  for (const ref of references) {
    if (!ref.resolved) continue;
    const current = byId.get(ref.id);
    if (!current || (!current.resolved && ref.resolved)) byId.set(ref.id, ref);
  }
  for (const ref of [...byId.values()].sort((a, b) => b.id.length - a.id.length)) {
    const label = `${ref.label}${ref.secondary ? ` (${ref.secondary})` : ""}`;
    result = result.replace(new RegExp(escapeRegExp(ref.id), "g"), label);
  }
  return result;
}

function clean(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error(`Reference ${name} is invalid`);
  return value.trim();
}
function optional(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error("Reference text is invalid");
  return value.trim() || undefined;
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
