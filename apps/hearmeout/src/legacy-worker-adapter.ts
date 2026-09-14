import type { HearMeOutDiscordGuildV1, HearMeOutDiscordVoiceDirectoryV1, HearMeOutVoiceAudioProfileV1, HearMeOutVoiceBridgeWorkerV1 } from "./voice-bridge.js";
import { clampHearMeOutDiscordReceiveGain } from "./discord-receive-audio.js";
import { hearMeOutProviderRoomName } from "./room-identity.js";

export interface HttpHearMeOutVoiceBridgeWorkerOptionsV1 {
  workerOrigin: string;
  getAuthorization: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  allowedTenantIds?: string[];
}

/** Migration-era execution adapter for the authenticated HearMeOut worker. */
export class HttpHearMeOutVoiceBridgeWorker implements HearMeOutVoiceBridgeWorkerV1 {
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpHearMeOutVoiceBridgeWorkerOptionsV1) {
    const origin = new URL(options.workerOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || (origin.pathname !== "/" && origin.pathname !== "")) throw new Error("HearMeOut worker origin must be credential-free HTTPS with no path");
    if (typeof options.getAuthorization !== "function") throw new Error("HearMeOut worker authorization source is required");
    this.origin = origin.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 20_000, 1_000, 60_000, "timeoutMs");
  }

  status(input: { tenantId: string; roomId: string }) {
    this.requireTenant(input.tenantId);
    const roomId = this.room(input.tenantId, input.roomId);
    return this.request("/voice-bridge", { query: { roomId } });
  }

  start(input: { tenantId: string; roomId: string; guildId: string; voiceChannelId: string; audioProfile: HearMeOutVoiceAudioProfileV1; discordReceiveGain: number }) {
    this.requireTenant(input.tenantId);
    const roomId = this.room(input.tenantId, input.roomId), guildId = snowflake(input.guildId, "guildId"), voiceChannelId = snowflake(input.voiceChannelId, "voiceChannelId"), audioProfile = profile(input.audioProfile), discordReceiveGain = clampHearMeOutDiscordReceiveGain(finiteNumber(input.discordReceiveGain, "discordReceiveGain"));
    return this.request("/voice-bridge", { method: "POST", body: { action: "start", roomId, guildId, voiceChannelId, audioProfile, discordReceiveGain } }).then(async result => {
      try { return confirmGain(result, discordReceiveGain); }
      catch (error) { await this.stop({ tenantId: input.tenantId, roomId: input.roomId }).catch(() => undefined); throw error; }
    });
  }

  stop(input: { tenantId: string; roomId: string }) {
    this.requireTenant(input.tenantId);
    return this.request("/voice-bridge", { method: "POST", body: { action: "stop", roomId: this.room(input.tenantId, input.roomId) } });
  }

  setRoomOutbound(input: { tenantId: string; roomId: string; roomVoiceOutboundEnabled: boolean }) {
    this.requireTenant(input.tenantId);
    if (typeof input.roomVoiceOutboundEnabled !== "boolean") throw new Error("roomVoiceOutboundEnabled must be boolean");
    return this.request("/voice-bridge/gate", { method: "POST", body: { roomId: this.room(input.tenantId, input.roomId), roomVoiceOutboundEnabled: input.roomVoiceOutboundEnabled } });
  }

  setAudioProfile(input: { tenantId: string; roomId: string; audioProfile: HearMeOutVoiceAudioProfileV1 }) {
    this.requireTenant(input.tenantId);
    return this.request("/voice-bridge/audio-profile", { method: "POST", body: { roomId: this.room(input.tenantId, input.roomId), audioProfile: profile(input.audioProfile) } });
  }

  setDiscordReceiveGain(input: { tenantId: string; roomId: string; discordReceiveGain: number }) {
    this.requireTenant(input.tenantId);
    const discordReceiveGain = clampHearMeOutDiscordReceiveGain(finiteNumber(input.discordReceiveGain, "discordReceiveGain"));
    return this.request("/voice-bridge/receive-gain", { method: "POST", body: { roomId: this.room(input.tenantId, input.roomId), discordReceiveGain } }).then(result => confirmGain(result, discordReceiveGain));
  }

  async discordDirectory(input: { tenantId: string }): Promise<HearMeOutDiscordVoiceDirectoryV1> {
    this.requireTenant(input.tenantId); cleanId(input.tenantId, "tenantId");
    const result = await this.request("/discord/directory"), values = Array.isArray(result.guilds) ? result.guilds : [];
    const guilds: HearMeOutDiscordGuildV1[] = values.slice(0, 100).map((value) => {
      const item = record(value, "Discord guild"), id = snowflake(String(item.id ?? ""), "guildId"), name = label(item.name, "guild name", 120), channels = Array.isArray(item.channels) ? item.channels : [];
      return { id, name, ...(typeof item.icon === "string" && item.icon ? { icon: item.icon.slice(0, 200) } : {}), channels: channels.slice(0, 500).map(channel => { const entry = record(channel, "Discord voice channel"), type = Number(entry.type); if (type !== 2 && type !== 13) throw new Error("Discord directory returned a non-voice channel"); return { id: snowflake(String(entry.id ?? ""), "voiceChannelId"), name: label(entry.name, "channel name", 120), type, ...(Number.isFinite(Number(entry.position)) ? { position: Number(entry.position) } : {}), ...(typeof entry.parentId === "string" && /^\d{5,30}$/.test(entry.parentId) ? { parentId: entry.parentId } : {}) }; }) };
    });
    return { guilds };
  }

  joinPersona(input: { tenantId: string; roomId: string; personaId: string; displayName: string; ownerTenantId?: string; wakeNames?: string[]; voice?: string; avatar?: string; idleAvatar?: string; talkingAvatar?: string }) {
    this.requireTenant(input.tenantId);
    const body = {
      action: "join", roomId: this.room(input.tenantId, input.roomId), personaId: personaId(input.personaId), displayName: label(input.displayName, "displayName", 64), serviceSession: true,
      ownerTenantId: cleanId(input.ownerTenantId ?? input.tenantId, "ownerTenantId"),
      wakeNames: [...new Set((input.wakeNames ?? []).map(value => label(value, "wakeName", 96)))].slice(0, 50),
      ...(input.voice ? { voice: label(input.voice, "voice", 128) } : {}),
      ...(input.avatar ? { avatar: httpsUrl(input.avatar, "avatar") } : {}),
      ...(input.idleAvatar ? { idleAvatar: httpsUrl(input.idleAvatar, "idleAvatar") } : {}),
      ...(input.talkingAvatar ? { talkingAvatar: httpsUrl(input.talkingAvatar, "talkingAvatar") } : {}),
    };
    return this.request("/persona", { method: "POST", body });
  }

  leavePersona(input: { tenantId: string; roomId: string; personaId: string; displayName?: string }) {
    this.requireTenant(input.tenantId);
    return this.request("/persona", { method: "POST", body: { action: "leave", roomId: this.room(input.tenantId, input.roomId), personaId: personaId(input.personaId), ...(input.displayName ? { displayName: label(input.displayName, "displayName", 64) } : {}) } });
  }

  async personaStatus(input: { tenantId: string; roomId: string; personaId?: string }) {
    this.requireTenant(input.tenantId);
    const result = await this.request("/persona"), roomId = this.room(input.tenantId, input.roomId), requested = input.personaId ? personaId(input.personaId) : undefined, instances = Array.isArray(result.instances) ? result.instances.filter(value => { const item = value && typeof value === "object" ? value as Record<string, unknown> : {}; return item.roomId === roomId && (!requested || item.personaId === requested); }) : [];
    return { instances };
  }

  speakPersona(input: { tenantId: string; roomId: string; personaId: string; audioDataUri: string }) {
    this.requireTenant(input.tenantId);
    const audioDataUri = String(input.audioDataUri ?? "").trim();
    if (!/^data:audio\/[A-Za-z0-9.+-]+(?:;[^,\r\n]*)?;base64,[A-Za-z0-9+/]+={0,2}$/.test(audioDataUri) || audioDataUri.length > 30_000_000) throw new Error("Persona speech audio is invalid or too large");
    return this.request("/persona/speak", { method: "POST", body: { roomId: this.room(input.tenantId, input.roomId), personaId: personaId(input.personaId), audioDataUri } });
  }

  private room(tenantId: string, roomId: string) { cleanId(tenantId, "tenantId"); return hearMeOutProviderRoomName(tenantId, cleanId(roomId, "roomId")); }
  private requireTenant(tenantId: string) { if (this.options.allowedTenantIds && !this.options.allowedTenantIds.includes(tenantId)) throw new Error("Discord voice is not enabled for this workspace"); }

  private async request(path: string, options: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<Record<string, unknown>> {
    const authorization = String(await this.options.getAuthorization()).trim();
    if (!/^Bearer [^\r\n]{16,}$/.test(authorization)) throw new Error("HearMeOut worker authorization is unavailable");
    const url = new URL(path, `${this.origin}/`); for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try { response = await this.fetchImpl(url, { method: options.method ?? "GET", headers: { authorization, accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch { throw new Error("HearMeOut worker request failed before a response was received"); }
    if (response.status >= 300 && response.status < 400) throw new Error("HearMeOut worker redirect refused");
    const text = await response.text(); let payload: unknown = {}; if (text) { try { payload = JSON.parse(text); } catch { payload = {}; } }
    if (!response.ok) throw new HttpHearMeOutVoiceBridgeWorkerError(response.status, safeProviderMessage(payload));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    if ((payload as Record<string, unknown>).success === false) throw new HttpHearMeOutVoiceBridgeWorkerError(response.status, safeProviderMessage(payload) ?? "Worker did not apply the request");
    return payload as Record<string, unknown>;
  }
}

function confirmGain(result: Record<string, unknown>, expected: number) { const status = result.status && typeof result.status === "object" ? result.status as Record<string, unknown> : result; if (status.discordReceiveGain !== expected) throw new Error("HearMeOut worker did not confirm the requested Discord receive gain; update the worker gain API before cutover"); return result; }
export class HttpHearMeOutVoiceBridgeWorkerError extends Error { constructor(readonly status: number, detail?: string) { super(detail ? `HearMeOut worker request failed (${status}): ${detail}` : `HearMeOut worker request failed (${status})`); this.name = "HttpHearMeOutVoiceBridgeWorkerError"; } }
function cleanId(value: string, name: string) { const clean = String(value ?? "").trim(); if (!clean || clean.length > 160 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`); return clean; }
function snowflake(value: string, name: string) { const clean = String(value ?? "").trim(); if (!/^\d{5,30}$/.test(clean)) throw new Error(`${name} must be a Discord snowflake`); return clean; }
function personaId(value: string) { const clean = String(value ?? "").trim(); if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(clean)) throw new Error("personaId is invalid"); return clean; }
function label(value: unknown, name: string, max: number) { const clean = String(value ?? "").trim(); if (!clean || clean.length > max || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`); return clean; }
function httpsUrl(value: string, name: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.href.length > 1000) throw new Error(`${name} must be a credential-free HTTPS URL`); return url.href; }
function record(value: unknown, name: string) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} is invalid`); return value as Record<string, unknown>; }
function profile(value: HearMeOutVoiceAudioProfileV1) { if (value !== "low-latency" && value !== "balanced" && value !== "resilient" && value !== "clean") throw new Error("Invalid HearMeOut voice audio profile"); return value; }
function finiteNumber(value: number, name: string) { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); return value; }
function boundedInteger(value: number, min: number, max: number, name: string) { const parsed = Math.trunc(Number(value)); if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be from ${min} through ${max}`); return parsed; }
function safeProviderMessage(payload: unknown) { if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined; const value = payload as Record<string, unknown>, raw = typeof value.message === "string" ? value.message : typeof value.error === "string" ? value.error : "", clean = raw.replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]").replace(/[\r\n\0]/g, " ").trim().slice(0, 240); return clean || undefined; }
