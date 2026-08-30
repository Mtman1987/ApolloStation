import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";

export type StreamWeaverBotActorRoleV1 = "guest" | "member" | "moderator" | "admin" | "owner";
export type StreamWeaverBotActionRiskV1 = "read" | "write" | "broadcast";
export const STREAMWEAVER_BOT_ACTION_CATALOG = Object.freeze([
  descriptor("dsh.shoutouts.active.read", "read", "member"), descriptor("dsh.shoutouts.live.read", "read", "member"), descriptor("dsh.shoutouts.post", "broadcast", "moderator"),
  descriptor("dsh.calendar.read", "read", "member"), descriptor("dsh.calendar.captain.read", "read", "member"), descriptor("dsh.calendar.captain.create", "write", "member"), descriptor("dsh.calendar.event.create", "write", "admin"), descriptor("dsh.calendar.deploy", "broadcast", "admin"), descriptor("dsh.calendar.refresh", "write", "admin"),
  descriptor("dsh.applications.read", "read", "admin"), descriptor("dsh.applications.deploy", "broadcast", "admin"), descriptor("dsh.applications.decide", "write", "owner"),
  descriptor("hmo.rooms.read", "read", "member"), descriptor("hmo.media.state.read", "read", "member"), descriptor("hmo.media.request", "write", "member"), descriptor("hmo.media.control", "write", "moderator"), descriptor("hmo.bot.control", "write", "member"), descriptor("hmo.voice.bridge.state", "read", "member"), descriptor("hmo.voice.bridge.control", "write", "member"),
  descriptor("sw.image.generate", "write", "member"),
] as const);
export type StreamWeaverBotActionIdV1 = typeof STREAMWEAVER_BOT_ACTION_CATALOG[number]["id"];
export interface StreamWeaverBotActionRequestV1 { action: StreamWeaverBotActionIdV1; args: Record<string, string>; detection: "explicit" | "ai-read-only"; }
export interface StreamWeaverBotActionContextV1 { tenantId: string; source: NormalizedChatMessageV1["provider"]; channelId: string; requestId: string; actor: { userId?: string; username: string; role: StreamWeaverBotActorRoleV1 }; }
export interface StreamWeaverBotActionExecutorV1 { execute(request: StreamWeaverBotActionRequestV1, context: StreamWeaverBotActionContextV1): Promise<{ response: string; result?: Record<string, unknown> }>; }
export interface StreamWeaverBotActionEgressV1 { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>; }

export class StreamWeaverSuiteBotActionExecutor implements StreamWeaverBotActionExecutorV1 {
  constructor(private readonly ports: { dsh?: StreamWeaverBotActionExecutorV1; hearmeout?: StreamWeaverBotActionExecutorV1; image?: StreamWeaverBotActionExecutorV1 }) {}
  execute(request: StreamWeaverBotActionRequestV1, context: StreamWeaverBotActionContextV1) {
    const port = request.action.startsWith("dsh.") ? this.ports.dsh : request.action.startsWith("hmo.") ? this.ports.hearmeout : this.ports.image;
    if (!port) throw new Error(`The ${request.action.split(".")[0]} bot-action adapter is unavailable`);
    return port.execute(request, context);
  }
}

export function detectStreamWeaverBotAction(message: string, now = new Date()): StreamWeaverBotActionRequestV1 | undefined {
  const value = normalized(message);
  const channel = clean(message.match(/(?:to|in|into|on)\s+#([a-z0-9_-]{1,100})\b/i)?.[1]);
  const roomId = clean(message.match(/\b(?:room|chat)\s+(?:called|named)?\s*["“]?([a-z0-9][a-z0-9 _-]{0,159}?)["”]?(?:\s+(?:please|now)|[,.!?]|$)/i)?.[1]);
  const image = clean(message.match(/\b(?:generate|make|create|draw)\s+(?:me\s+)?(?:an?\s+)?(?:ai\s+)?(?:image|picture|photo|artwork|illustration)\s*(?:of|showing|for)?\s+(.+?)\s*$/i)?.[1], 3_000).replace(/\s+please$/i, "");
  if (image) return request("sw.image.generate", { prompt: image });
  if (/\b(?:which|what|show|list|read)\b.*\b(?:hearmeout|hear\s+me\s+out)\b.*\brooms?\b|\blist\s+(?:my\s+)?(?:hearmeout|hear\s+me\s+out)\s+rooms?\b/.test(value)) return request("hmo.rooms.read", {});
  if (/\b(?:tell|invite|add|bring|remove|send|take)\b.*\b(?:join|enter|leave|exit|to|from|out of)\b.*\b(?:hearmeout|hear\s+me\s+out)\b/.test(value)) {
    const bot = clean(message.match(/\btell\s+(.+?)\s+to\s+(?:join|enter|leave|exit)\b/i)?.[1]).replace(/^(?:the|my)\s+bot\s+/i, "").replace(/^@/, "");
    return request("hmo.bot.control", { control: /\b(?:leave|exit|remove|send|take)\b/.test(value) ? "leave" : "join", bot, roomId });
  }
  if (/\b(?:what|which|where|is|show|read|check)\b.*\b(?:discord\s+)?(?:voice\s+bridge|bridged|vc)\b/.test(value)) return request("hmo.voice.bridge.state", { roomId });
  if (/\b(?:bridge|connect|start|stop|disconnect|listen[- ]only|two[- ]way|low[- ]latency|balanced|resilient)\b.*\b(?:discord|voice\s+bridge|vc|hearmeout|hear\s+me\s+out)\b/.test(value)) {
    const control = /\b(?:stop|disconnect)\b/.test(value) ? "stop" : /\blisten[- ]only\b/.test(value) ? "listen-only" : /\btwo[- ]way\b/.test(value) ? "two-way" : /\b(?:low[- ]latency|balanced|resilient)\b/.test(value) ? "profile" : "start";
    const audioProfile = /\blow[- ]latency\b/.test(value) ? "low-latency" : /\bresilient\b/.test(value) ? "resilient" : /\bbalanced\b/.test(value) ? "balanced" : "";
    const voiceChannelId = clean(message.match(/<#(\d{5,30})>/)?.[1] ?? message.match(/\b(?:vc|voice\s+channel)\s+#?["“]?([a-z0-9][a-z0-9 _-]{0,119}?)["”]?(?:\s+(?:in|for|with|please|now)\b|[,.!?]|$)/i)?.[1]);
    return request("hmo.voice.bridge.control", { control, audioProfile, voiceChannelId, roomId });
  }
  if (/\b(?:clear|empty)\b.*\b(?:hearmeout|hear\s+me\s+out|music)?\s*queue\b/.test(value)) return request("hmo.media.control", { control: "clear", roomId });
  if (/\b(?:skip|next)\b.*\b(?:song|track|story|audio|hearmeout|hear\s+me\s+out)\b|\b(?:hearmeout|hear\s+me\s+out)\b.*\b(?:skip|next)\b/.test(value)) return request("hmo.media.control", { control: "next", roomId });
  if (/\bpause\b.*\b(?:music|song|track|story|audio|hearmeout|hear\s+me\s+out)\b/.test(value)) return request("hmo.media.control", { control: "pause", roomId });
  if (/\b(?:resume|continue)\b.*\b(?:music|song|track|story|audio|hearmeout|hear\s+me\s+out)\b/.test(value)) return request("hmo.media.control", { control: "play", roomId });
  if (/\b(?:play|queue|request|put\s+on|add)\b.*\b(?:song|track|music|story|audiobook|audio|hearmeout|hear\s+me\s+out)\b/.test(value)) {
    const query = clean(message.match(/["“]([^"”]{1,500})["”]/)?.[1] ?? message.match(/\b(?:play|queue|request|put\s+on|add)\s+(?:(?:the|a|an)\s+)?(?:(?:song|track|music|story|audiobook|audio)\s+)?(?:(?:called|named|titled)\s+)?(.+?)\s*$/i)?.[1]);
    return request("hmo.media.request", { query: query.replace(/\s+(?:on|in|through)\s+(?:hearmeout|hear\s+me\s+out)\b.*$/i, ""), roomId });
  }
  if (/\b(?:what(?:'s| is)|read|show|list|check)\b.*\b(?:playing|queued?|hearmeout|hear\s+me\s+out)\b/.test(value)) return request("hmo.media.state.read", { roomId });
  if (/\b(?:add|create|schedule)\b.*\bevent\b.*\b(?:admin\s+)?calendar\b/.test(value)) {
    const missionName = clean(message.match(/\b(?:title|titled|called|named)\s+["“]([^"”]{1,160})["”]/i)?.[1]);
    const missionDescription = clean(message.match(/\bdescription\s+["“]([^"”]{1,1000})["”]/i)?.[1], 1_000);
    const missionDate = extractDate(message, now);
    const clock = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(utc|gmt|[a-z]{2,5})?\b/i);
    let hour = Number(clock?.[1] ?? -1); const minute = Number(clock?.[2] ?? 0); const meridiem = clock?.[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12; if (meridiem === "am" && hour === 12) hour = 0;
    const missionTime = hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : "";
    return request("dsh.calendar.event.create", { missionName, missionDescription, missionDate, missionTime, missionTimeZone: clean(clock?.[4] ?? "UTC").toUpperCase() });
  }
  if (/\b(?:approve|accept|reject|deny|decline)\b.*\bapplication\b/.test(value)) {
    const decision = /\b(?:approve|accept)\b/.test(value) ? "approved" : "rejected";
    const type = /\b(?:moderator|moderation|modship|mod)\b/.test(value) ? "mod" : /\b(?:partner|partnership)\b/.test(value) ? "partner" : /\b(?:developer|development|sdk|dev)\b/.test(value) ? "dev" : "";
    const application = clean(message.match(/\b(?:approve|accept|reject|deny|decline)\s+(?:the\s+)?(.+?)'?s?\s+(?:(?:moderator|moderation|modship|mod|partner|partnership|developer|development|sdk|dev)\s+)?application\b/i)?.[1]).replace(/["“”']/g, "");
    return request("dsh.applications.decide", { decision, type, application });
  }
  if (/\b(?:post|send|publish)\b.*\b(?:dsh|discord\s*stream\s*hubs?)?\s*shoutout\b/.test(value)) return request("dsh.shoutouts.post", { target: clean(message.match(/\bshoutout\s+(?:for|to)\s+@?([a-z0-9_]{2,40})\b/i)?.[1]), channel });
  if (/\b(?:deploy|post|publish|send)\b.*\b(?:mod(?:erator)?|partner|dev(?:eloper|elopment)?)\b.*\bapplications?\b/.test(value)) return request("dsh.applications.deploy", { channel });
  if (/\b(?:deploy|post|publish|send)\b.*\b(?:admin\s+)?calendar\b/.test(value)) return request("dsh.calendar.deploy", { channel });
  if (/\b(?:refresh|update|regenerate)\b.*\b(?:deployed\s+)?(?:admin\s+)?calendar\b/.test(value)) return request("dsh.calendar.refresh", {});
  if (/\b(?:claim|schedule|set|put|add|sign)\b.*\bcaptain'?s?\s+log\b/.test(value)) return request("dsh.calendar.captain.create", { selectedDate: extractDate(message, now) });
  if (/\b(?:who|read|show|list|check|what)\b.*\bcaptain'?s?\s+log\b/.test(value)) return request("dsh.calendar.captain.read", {});
  if (/\b(?:read|show|list|check|what(?:'s| is))\b.*\b(?:dsh|discord\s*stream\s*hubs?|admin)\b.*\bcalendar\b/.test(value)) return request("dsh.calendar.read", {});
  if (/\b(?:who|show|list|read|which)\b.*\blive\b.*\b(?:dsh|shoutouts?)\b/.test(value)) return request("dsh.shoutouts.live.read", {});
  if (/\b(?:show|list|read|which)\b.*\b(?:active\s+)?shoutouts?\b/.test(value)) return request("dsh.shoutouts.active.read", {});
  if (/\b(?:show|list|read)\b.*\bapplications?\b/.test(value)) return request("dsh.applications.read", { status: /\bpending\b/.test(value) ? "pending" : "" });
  return undefined;
}

export class StreamWeaverBotActionConsumer {
  readonly id = "streamweaver.bot-actions" as const;
  constructor(private readonly executor: StreamWeaverBotActionExecutorV1, private readonly egress: StreamWeaverBotActionEgressV1) {}
  accepts(message: NormalizedChatMessageV1): boolean { return !message.actor.isBot && this.willHandle(message); }
  willHandle(message: NormalizedChatMessageV1): boolean { return Boolean(detectStreamWeaverBotAction(message.text, new Date(message.occurredAt))); }
  async deliver(delivery: NormalizedChatDeliveryV1): Promise<void> {
    const request = detectStreamWeaverBotAction(delivery.message.text, new Date(delivery.message.occurredAt));
    if (!request) return;
    const role = providerRole(delivery.message);
    const descriptor = STREAMWEAVER_BOT_ACTION_CATALOG.find((item) => item.id === request.action)!;
    const response = roleLevel(role) < roleLevel(descriptor.minimumRole)
      ? `That ${descriptor.risk} action requires ${descriptor.minimumRole} access.`
      : (await this.executor.execute(request, { tenantId: delivery.message.tenantId, source: delivery.message.provider, channelId: delivery.message.channelId, requestId: delivery.deliveryId, actor: { ...(delivery.message.actor.canonicalUserId ? { userId: delivery.message.actor.canonicalUserId } : {}), username: delivery.message.actor.username, role } })).response;
    await this.egress.send({ schemaVersion: 1, tenantId: delivery.message.tenantId, provider: delivery.message.provider, connectionId: delivery.message.connectionId, channelId: delivery.message.channelId, text: response.slice(0, 8_000), idempotencyKey: `streamweaver-bot-action:${delivery.deliveryId}`, replyToMessageId: delivery.message.messageId });
  }
}

function descriptor<const I extends string>(id: I, risk: StreamWeaverBotActionRiskV1, minimumRole: StreamWeaverBotActorRoleV1) { return { id, risk, minimumRole }; }
function request(action: StreamWeaverBotActionIdV1, args: Record<string, string>): StreamWeaverBotActionRequestV1 { return { action, args, detection: "explicit" }; }
function providerRole(message: NormalizedChatMessageV1): StreamWeaverBotActorRoleV1 { return message.actor.roles.includes("broadcaster") ? "owner" : message.actor.roles.includes("moderator") ? "moderator" : message.actor.roles.includes("member") ? "member" : "guest"; }
function roleLevel(role: StreamWeaverBotActorRoleV1): number { return { guest: 0, member: 1, moderator: 2, admin: 3, owner: 4 }[role]; }
function normalized(value: string): string { return clean(value, 5_000).toLowerCase().replace(/[’]/g, "'"); }
function clean(value: unknown, max = 500): string { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function extractDate(message: string, now: Date): string { const explicit = message.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0]; if (explicit) return explicit; const offset = /\btomorrow\b/i.test(message) ? 1 : /\btoday\b/i.test(message) ? 0 : undefined; if (offset !== undefined) { const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)); return date.toISOString().slice(0, 10); } const months: Record<string, number> = { january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11 }; const match = message.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept?|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i); if (!match) return ""; return new Date(Date.UTC(Number(match[3]), months[match[1]!.toLowerCase()]!, Number(match[2]))).toISOString().slice(0, 10); }
