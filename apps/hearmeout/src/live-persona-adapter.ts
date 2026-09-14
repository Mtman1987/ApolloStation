import type { HearMeOutPersonaConversationPortsV1, HearMeOutPublicPersonaV1 } from "./persona-conversation.js";
import { hearMeOutProviderRoomName } from "./room-identity.js";

export interface LiveHearMeOutPersonaPortsOptionsV1 {
  tenantId: string;
  workerOrigin: string;
  getWorkerAuthorization: () => string | Promise<string>;
  donorOrigin?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin server-side bridge to the already-proven live HearMeOut persona path.
 * Browsers never receive the worker secret and never call StreamWeaver directly.
 */
export class LiveHearMeOutPersonaPorts implements HearMeOutPersonaConversationPortsV1 {
  private readonly workerOrigin: string;
  private readonly donorOrigin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LiveHearMeOutPersonaPortsOptionsV1) {
    this.workerOrigin = origin(options.workerOrigin, "HearMeOut worker");
    this.donorOrigin = origin(options.donorOrigin ?? "https://hearmeout-main.fly.dev", "HearMeOut donor");
    this.fetchImpl = options.fetchImpl ?? fetch;
    id(options.tenantId, "tenantId");
  }

  async listPublicPersonas(): Promise<HearMeOutPublicPersonaV1[]> {
    const payload = await this.publicJson("/api/bots");
    const root = object(payload), data = objectOr(root.data, root), values = Array.isArray(data.bots) ? data.bots : [];
    return values.slice(0, 200).flatMap(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const bot = value as Record<string, unknown>;
      const personaId = text(bot.id ?? bot.personaId ?? bot.ownerTenantId, 200), targetTenantId = text(bot.ownerTenantId ?? bot.targetTenantId ?? bot.id, 200), displayName = label(bot.name ?? bot.displayName ?? personaId, 120);
      if (!personaId || !targetTenantId || !displayName) return [];
      const aliases = strings(bot.aliases, 96), wakeNames = strings(bot.wakeNames, 96), interests = strings(bot.interests, 96);
      return [{
        personaId, targetTenantId, displayName,
        wakeNames: [...new Set([displayName, ...wakeNames, ...aliases])].slice(0, 50),
        aliases, interests,
        canInvite: bot.canInvite !== false,
        canTalk: bot.canTalk !== false,
        transportHealthy: true,
        ...(labelOptional(bot.ownerName, 100) ? { ownerName: labelOptional(bot.ownerName, 100) } : {}),
        ...(labelOptional(bot.voice, 128) ? { voice: labelOptional(bot.voice, 128) } : {}),
        ...(labelOptional(bot.livekitTtsDescriptor, 128) ? { livekitTtsDescriptor: labelOptional(bot.livekitTtsDescriptor, 128) } : {}),
        ...(httpsOptional(bot.avatar ?? bot.avatarUrl) ? { avatarUrl: httpsOptional(bot.avatar ?? bot.avatarUrl) } : {}),
        ...(httpsOptional(bot.idleAvatar ?? bot.idleAvatarUrl ?? bot.avatar ?? bot.avatarUrl) ? { idleAvatarUrl: httpsOptional(bot.idleAvatar ?? bot.idleAvatarUrl ?? bot.avatar ?? bot.avatarUrl) } : {}),
        ...(httpsOptional(bot.talkingAvatar ?? bot.talkingAvatarUrl ?? bot.idleAvatar ?? bot.idleAvatarUrl ?? bot.avatar ?? bot.avatarUrl) ? { talkingAvatarUrl: httpsOptional(bot.talkingAvatar ?? bot.talkingAvatarUrl ?? bot.idleAvatar ?? bot.idleAvatarUrl ?? bot.avatar ?? bot.avatarUrl) } : {}),
        ...(labelOptional(bot.blockedReason, 300) ? { blockedReason: labelOptional(bot.blockedReason, 300) } : {}),
      }];
    });
  }

  async inspectWorkerPersona(roomId: string, targetTenantId: string) {
    const payload = await this.workerJson("/persona"), instances = Array.isArray(payload.instances) ? payload.instances : [], providerRoom = this.room(roomId), requested = id(targetTenantId, "targetTenantId");
    const match = instances.find(value => value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).roomId === providerRoom && (value as Record<string, unknown>).personaId === requested) as Record<string, unknown> | undefined;
    const runtime = match?.runtime && typeof match.runtime === "object" && !Array.isArray(match.runtime) ? match.runtime as Record<string, unknown> : undefined;
    return { active: Boolean(match), transportHealthy: match?.transportHealthy === true, ...(labelOptional(runtime?.displayName, 120) ? { displayName: labelOptional(runtime?.displayName, 120) } : {}) };
  }

  async transcribe(input: { base64Audio: string }) {
    const payload = await this.publicJson("/api/internal/persona-transcribe", { method: "POST", body: { base64Audio: input.base64Audio } });
    const root = object(payload), data = objectOr(root.data, root);
    return { transcription: String(data.transcription ?? root.transcription ?? "").trim() };
  }

  async invoke(input: { roomId: string; targetTenantId: string; command: string; actorUserId?: string; actorUsername: string; actorDisplayName: string; voice?: string; speak: true }) {
    const payload = await this.publicJson("/api/bot/commands", { method: "POST", body: { command: input.command, roomId: this.room(input.roomId), targetTenantId: input.targetTenantId, actorIdentity: input.actorUserId, actorUsername: input.actorUsername, actorDisplayName: input.actorDisplayName, voice: input.voice, speak: false } });
    const root = object(payload), data = objectOr(root.data, root), bot = objectOr(data.bot, objectOr(root.bot, {})), tts = objectOr(data.tts, objectOr(root.tts, {}));
    return {
      response: String(data.response ?? root.response ?? "").trim(),
      bot: { tenantId: String(bot.tenantId ?? input.targetTenantId), name: String(bot.name ?? input.targetTenantId) },
      ...(typeof tts.audioDataUri === "string" ? { tts: { audioDataUri: tts.audioDataUri, ...(typeof tts.voice === "string" ? { voice: tts.voice } : {}) } } : {}),
    };
  }

  async speak(input: { roomId: string; personaId: string; audioDataUri: string }) {
    const payload = await this.workerJson("/persona/speak", { method: "POST", body: { roomId: this.room(input.roomId), personaId: id(input.personaId, "personaId"), audioDataUri: input.audioDataUri } });
    return { ...(Number.isFinite(Number(payload.bytes)) ? { bytes: Number(payload.bytes) } : {}), transportHealthy: payload.transportHealthy === true };
  }

  async controlPersona(input: { action: "join" | "leave"; roomId: string; persona: HearMeOutPublicPersonaV1; serviceSession: boolean }) {
    const persona = input.persona;
    const payload = await this.workerJson("/persona", { method: "POST", body: {
      action: input.action,
      roomId: this.room(input.roomId),
      personaId: id(persona.targetTenantId || persona.personaId, "personaId"),
      displayName: label(persona.displayName, 64),
      ownerTenantId: id(persona.targetTenantId || persona.personaId, "ownerTenantId"),
      ownerName: persona.ownerName ?? "",
      wakeNames: persona.wakeNames,
      aliases: persona.aliases ?? [],
      interests: persona.interests ?? [],
      voice: persona.voice ?? "",
      livekitTtsDescriptor: persona.livekitTtsDescriptor ?? "",
      avatar: persona.avatarUrl ?? "",
      idleAvatar: persona.idleAvatarUrl ?? persona.avatarUrl ?? "",
      talkingAvatar: persona.talkingAvatarUrl ?? persona.idleAvatarUrl ?? persona.avatarUrl ?? "",
      serviceSession: input.serviceSession,
    } });
    return { ...payload, transportHealthy: payload.transportHealthy !== false };
  }

  async clearStalePresence(roomId: string, personaId: string) {
    await this.workerJson("/persona", { method: "POST", body: { action: "leave", roomId: this.room(roomId), personaId: id(personaId, "personaId") } }).catch(() => undefined);
  }

  private room(roomId: string) { return hearMeOutProviderRoomName(this.options.tenantId, id(roomId, "roomId")); }

  private async workerJson(path: string, options: { method?: string; body?: unknown } = {}) {
    const authorization = String(await this.options.getWorkerAuthorization()).trim();
    if (!/^Bearer [^\r\n]{16,}$/.test(authorization)) throw new Error("HearMeOut persona worker authorization is unavailable");
    return this.json(new URL(path, `${this.workerOrigin}/`), { ...options, authorization });
  }

  private publicJson(path: string, options: { method?: string; body?: unknown } = {}) { return this.json(new URL(path, `${this.donorOrigin}/`), options); }

  private async json(url: URL, options: { method?: string; body?: unknown; authorization?: string }) {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: options.method ?? "GET", headers: { accept: "application/json", ...(options.authorization ? { authorization: options.authorization } : {}), ...(options.body === undefined ? {} : { "content-type": "application/json" }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), redirect: "manual", signal: AbortSignal.timeout(65_000) });
    } catch { throw new Error("HearMeOut live persona service is unavailable"); }
    if (response.status >= 300 && response.status < 400) throw new Error("HearMeOut live persona redirect refused");
    const raw = await response.text(); let payload: unknown = {}; try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    if (!response.ok) throw new Error(safeError(payload, response.status));
    return object(payload);
  }
}

function origin(value: string, name: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error(`${name} origin must be credential-free HTTPS`); return url.origin; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function objectOr(value: unknown, fallback: Record<string, unknown>) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fallback; }
function id(value: unknown, name: string) { const result = String(value ?? "").trim(); if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(result)) throw new Error(`${name} is invalid`); return result; }
function text(value: unknown, max: number) { const result = String(value ?? "").trim(); return result && result.length <= max && !/[\r\n\0]/.test(result) ? result : ""; }
function label(value: unknown, max: number) { const result = text(value, max); if (!result) throw new Error("HearMeOut persona label is invalid"); return result; }
function labelOptional(value: unknown, max: number) { return text(value, max); }
function strings(value: unknown, max: number) { return Array.isArray(value) ? [...new Set(value.map(item => text(item, max)).filter(Boolean))].slice(0, 50) : []; }
function httpsOptional(value: unknown) { const raw = String(value ?? "").trim(); if (!raw) return ""; try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 1000 ? url.href : ""; } catch { return ""; } }
function safeError(payload: unknown, status: number) { const value = object(payload), raw = String(value.error ?? value.message ?? `HearMeOut live persona request failed (${status})`); return raw.replace(/((?:token|authorization|secret|password|cookie))\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").slice(0, 400); }
