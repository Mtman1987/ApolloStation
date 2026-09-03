export type StreamWeaverCardPackGameV1 = "pokemon" | "quackverse";
export interface StreamWeaverCardPackCardV1 { id?: string; number?: string; name: string; rarity?: string; setCode?: string; imageUrl: string; }
export interface StreamWeaverCardPackOpenedEventV1 { schemaVersion: 1; eventId: string; type: "card-pack-opened"; game: StreamWeaverCardPackGameV1; username: string; setName: string; cards: StreamWeaverCardPackCardV1[]; featureCard?: StreamWeaverCardPackCardV1; openedAt: string; }
export const STREAMWEAVER_CARD_PACK_OPENED = "streamweaver.card-pack.opened.v1";
export const STREAMWEAVER_CARD_PACK_RENDER_CAPABILITY = "dsh.card-pack.render.v1";

export function normalizeStreamWeaverCardPackEvent(input: unknown, now: () => string = () => new Date().toISOString()): StreamWeaverCardPackOpenedEventV1 {
  const value = record(input), game: StreamWeaverCardPackGameV1 = String(value.game ?? value.source ?? "").toLowerCase().includes("quack") ? "quackverse" : "pokemon";
  const rawCards = Array.isArray(value.cards) ? value.cards : Array.isArray(value.pack) ? value.pack : [];
  const cards = rawCards.map(card).filter((item): item is StreamWeaverCardPackCardV1 => Boolean(item)).slice(0, 12);
  const featureCard = cards.length ? [...cards].sort((left, right) => rarityScore(right.rarity) - rarityScore(left.rarity))[0] : undefined;
  const openedAt = timestamp(value.openedAt ?? value.at ?? now());
  const fallbackId = `${game}-${openedAt.replace(/[^0-9]/g, "")}`;
  return { schemaVersion: 1, eventId: identifier(value.eventId ?? value.packId ?? fallbackId), type: "card-pack-opened", game, username: text(value.username ?? value.twitchUsername, "player", 80), setName: text(value.setName, game === "quackverse" ? "Quackverse" : "Pokemon", 100), cards, ...(featureCard ? { featureCard } : {}), openedAt };
}

export function encodeStreamWeaverCardPackEvent(event: StreamWeaverCardPackOpenedEventV1) { return Buffer.from(JSON.stringify(normalizeStreamWeaverCardPackEvent(event)), "utf8").toString("base64url"); }
export function decodeStreamWeaverCardPackEvent(encoded: string) { if (!encoded || encoded.length > 32_000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Card-pack overlay payload is invalid"); return normalizeStreamWeaverCardPackEvent(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))); }
export function buildStreamWeaverCardPackRenderUrl(origin: string, event: StreamWeaverCardPackOpenedEventV1) { const url = new URL("/overlay/card-pack", safeOrigin(origin)); url.searchParams.set("event", encodeStreamWeaverCardPackEvent(event)); url.searchParams.set("capture", "1"); return url.toString(); }

export interface StreamWeaverCardPackClientV1 { publishEvent(tenantId: string, type: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<unknown>; createExecutionJob(tenantId: string, input: Record<string, unknown>, idempotencyKey: string, correlationId?: string): Promise<{ job: unknown; duplicate: boolean }>; }
export class StreamWeaverCardPackCoordinator {
  constructor(private readonly client: StreamWeaverCardPackClientV1, private readonly rendererOrigin: string) {}
  async open(tenantId: string, userId: string, input: unknown) { const event = normalizeStreamWeaverCardPackEvent(input); const renderUrl = buildStreamWeaverCardPackRenderUrl(this.rendererOrigin, event); await this.client.publishEvent(tenantId, STREAMWEAVER_CARD_PACK_OPENED, event as unknown as Record<string, unknown>, `streamweaver-card-pack:${event.eventId}`); const render = await this.client.createExecutionJob(tenantId, { ownerAppId: "streamweaver", capabilityId: STREAMWEAVER_CARD_PACK_RENDER_CAPABILITY, executionOwner: "discord-stream-hub", billedUserId: userId, meteredResource: "hosted-worker-minutes", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", input: { schemaVersion: 1, eventId: event.eventId, source: event.game, renderUrl, event } }, `streamweaver-card-pack-render:${event.eventId}`, event.eventId); return { event, renderUrl, renderJob: render.job, duplicate: render.duplicate }; }
}

function card(input: unknown): StreamWeaverCardPackCardV1 | undefined { const value = record(input), imageUrl = mediaUrl(value.imageUrl ?? value.cardImageUrl); if (!imageUrl) return undefined; const id = optionalText(value.id, 80), number = optionalText(value.number, 40), rarity = optionalText(value.rarity, 60), setCode = optionalText(value.setCode, 40); return { ...(id ? { id } : {}), ...(number ? { number } : {}), name: text(value.name, "Unknown Card", 100), ...(rarity ? { rarity } : {}), ...(setCode ? { setCode } : {}), imageUrl }; }
function rarityScore(value: unknown) { const rarity = String(value ?? "").toLowerCase(); return rarity.includes("secret") || rarity.includes("legendary") ? 7 : rarity.includes("hyper") ? 6 : rarity.includes("ultra") || rarity.includes("epic") ? 5 : rarity.includes("holo") ? 4 : rarity.includes("rare") ? 3 : rarity.includes("uncommon") ? 2 : 1; }
function record(input: unknown): Record<string, unknown> { if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Card-pack event is invalid"); return input as Record<string, unknown>; }
function text(value: unknown, fallback: string, max: number) { const output = String(value ?? fallback).replace(/\s+/g, " ").trim().slice(0, max); return output || fallback; }
function optionalText(value: unknown, max: number) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function identifier(value: unknown) { const output = text(value, "", 120).replace(/[^A-Za-z0-9._:-]+/g, "-"); if (!output) throw new Error("Card-pack event ID is invalid"); return output; }
function timestamp(value: unknown) { const ms = Date.parse(String(value ?? "")); if (!Number.isFinite(ms)) throw new Error("Card-pack timestamp is invalid"); return new Date(ms).toISOString(); }
function mediaUrl(value: unknown) { try { const url = new URL(String(value ?? "")); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : ""; } catch { return ""; } }
function safeOrigin(value: string) { const url = new URL(value); if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("StreamWeaver renderer origin must use HTTPS"); url.pathname = "/"; url.search = ""; url.hash = ""; url.username = ""; url.password = ""; return url; }
