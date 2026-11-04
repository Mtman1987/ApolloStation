import type { HearMeOutVoiceAudioProfileV1, HearMeOutVoiceBridgeWorkerV1 } from "./voice-bridge.js";
import { clampHearMeOutDiscordReceiveGain } from "./discord-receive-audio.js";
import { hearMeOutProviderRoomName } from "./room-identity.js";
import {personaWorkerId,type HearMeOutPersonaPublisher,type PersonaRoomScope,type RoomSpeechPersona} from './room-persona-speech.js';

export interface HttpHearMeOutVoiceBridgeWorkerOptionsV1 {
  workerOrigin: string;
  getAuthorization: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  allowedTenantIds?: string[];
}

/**
 * Migration-era execution adapter for the current authenticated HearMeOut DJ
 * worker. The worker is an execution target only: canonical room, queue,
 * playback and desired bridge state remain in Apollo's HearMeOut SQLite
 * authority.
 *
 * This adapter intentionally exposes the donor worker's bounded voice bridge API and the
 * persona subclass's room-audio endpoints. It never receives provider tokens, never puts credentials in a
 * URL, never follows redirects, and never persists the worker authorization
 * value. The adapter can therefore be removed once the concrete bridge worker
 * is fully native to Apollo without changing the room/voice authority model.
 */
export class HttpHearMeOutVoiceBridgeWorker implements HearMeOutVoiceBridgeWorkerV1 {
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpHearMeOutVoiceBridgeWorkerOptionsV1) {
    const origin = new URL(options.workerOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || (origin.pathname !== "/" && origin.pathname !== "")) {
      throw new Error("HearMeOut worker origin must be credential-free HTTPS with no path");
    }
    if (typeof options.getAuthorization !== "function") throw new Error("HearMeOut worker authorization source is required");
    this.origin = origin.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 20_000, 1_000, 60_000, "timeoutMs");
  }

  status(input: { tenantId: string; roomId: string }) {
    this.requireTenant(input.tenantId);
    cleanId(input.tenantId, "tenantId");
    const roomId = hearMeOutProviderRoomName(input.tenantId, cleanId(input.roomId, "roomId"));
    return this.request("/voice-bridge", { query: { roomId } });
  }

  start(input: { tenantId: string; roomId: string; guildId: string; voiceChannelId: string; audioProfile: HearMeOutVoiceAudioProfileV1; discordReceiveGain: number }) {
    this.requireTenant(input.tenantId);
    cleanId(input.tenantId, "tenantId");
    const roomId = hearMeOutProviderRoomName(input.tenantId, cleanId(input.roomId, "roomId"));
    const guildId = snowflake(input.guildId, "guildId");
    const voiceChannelId = snowflake(input.voiceChannelId, "voiceChannelId");
    const audioProfile = profile(input.audioProfile);
    const discordReceiveGain = clampHearMeOutDiscordReceiveGain(finiteNumber(input.discordReceiveGain, "discordReceiveGain"));
    return this.request("/voice-bridge", {
      method: "POST",
      body: { action: "start", roomId, guildId, voiceChannelId, audioProfile, discordReceiveGain },
    }).then(async (result) => {
      try { return confirmGain(result, discordReceiveGain); }
      catch (error) {
        // A worker may have started before revealing its older contract.
        // Do not leave an untracked bridge running after Apollo rejects it.
        await this.stop({ tenantId: input.tenantId, roomId: input.roomId }).catch(() => undefined);
        throw error;
      }
    });
  }

  stop(input: { tenantId: string; roomId: string }) {
    this.requireTenant(input.tenantId);
    cleanId(input.tenantId, "tenantId");
    const roomId = hearMeOutProviderRoomName(input.tenantId, cleanId(input.roomId, "roomId"));
    return this.request("/voice-bridge", { method: "POST", body: { action: "stop", roomId } });
  }

  setRoomOutbound(input: { tenantId: string; roomId: string; roomVoiceOutboundEnabled: boolean }) {
    this.requireTenant(input.tenantId);
    cleanId(input.tenantId, "tenantId");
    const roomId = hearMeOutProviderRoomName(input.tenantId, cleanId(input.roomId, "roomId"));
    if (typeof input.roomVoiceOutboundEnabled !== "boolean") throw new Error("roomVoiceOutboundEnabled must be boolean");
    return this.request("/voice-bridge/gate", {
      method: "POST",
      body: { roomId, roomVoiceOutboundEnabled: input.roomVoiceOutboundEnabled },
    });
  }

  setAudioProfile(input: { tenantId: string; roomId: string; audioProfile: HearMeOutVoiceAudioProfileV1 }) {
    this.requireTenant(input.tenantId);
    cleanId(input.tenantId, "tenantId");
    const roomId = hearMeOutProviderRoomName(input.tenantId, cleanId(input.roomId, "roomId"));
    const audioProfile = profile(input.audioProfile);
    return this.request("/voice-bridge/audio-profile", { method: "POST", body: { roomId, audioProfile } });
  }

  setDiscordReceiveGain(input: { tenantId: string; roomId: string; discordReceiveGain: number }) {
    this.requireTenant(input.tenantId);
    cleanId(input.tenantId, "tenantId");
    const roomId = hearMeOutProviderRoomName(input.tenantId, cleanId(input.roomId, "roomId"));
    const discordReceiveGain = clampHearMeOutDiscordReceiveGain(finiteNumber(input.discordReceiveGain, "discordReceiveGain"));
    return this.request("/voice-bridge/receive-gain", { method: "POST", body: { roomId, discordReceiveGain } })
      .then((result) => confirmGain(result, discordReceiveGain));
  }

  protected requireTenant(tenantId: string) {
    if (this.options.allowedTenantIds && !this.options.allowedTenantIds.includes(tenantId)) throw new Error("Discord voice is not enabled for this workspace");
  }

  protected async request(path: string, options: { method?: string; body?: unknown; query?: Record<string, string>; timeoutMs?:number } = {}): Promise<Record<string, unknown>> {
    const authorization = String(await this.options.getAuthorization()).trim();
    if (!/^Bearer [^\r\n]{16,}$/.test(authorization)) throw new Error("HearMeOut worker authorization is unavailable");
    const url = new URL(path, `${this.origin}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: {
          authorization,
          accept: "application/json",
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs??this.timeoutMs),
      });
    } catch {
      throw new Error("HearMeOut worker request failed before a response was received");
    }
    if (response.status >= 300 && response.status < 400) throw new Error("HearMeOut worker redirect refused");
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = {}; }
    }
    if (!response.ok) throw new HttpHearMeOutVoiceBridgeWorkerError(response.status, safeProviderMessage(payload));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    if ((payload as Record<string, unknown>).success === false) throw new HttpHearMeOutVoiceBridgeWorkerError(response.status, safeProviderMessage(payload) ?? "Worker did not apply the request");
    return payload as Record<string, unknown>;
  }
}

/** Reuses hearmeout-main's authenticated persona PCM publisher. The caller
 * owns bridge-dependent admission/lifetime; adding a persona alone never calls join. */
export class HttpHearMeOutPersonaPublisher extends HttpHearMeOutVoiceBridgeWorker implements HearMeOutPersonaPublisher {
 private providerRoom(scope:PersonaRoomScope){this.requireTenant(scope.tenantId);return hearMeOutProviderRoomName(scope.tenantId,cleanId(scope.roomId,'roomId'))}
 async join(scope:PersonaRoomScope,persona:RoomSpeechPersona){
  const result=await this.request('/persona',{method:'POST',body:{action:'join',roomId:this.providerRoom(scope),personaId:personaWorkerId(persona.personaId),displayName:persona.displayName,ownerTenantId:persona.targetTenantId||scope.tenantId,serviceSession:true,research:false,wakeNames:persona.wakeNames||[],voice:persona.voice||'',avatar:persona.avatarUrl||'',idleAvatar:persona.idleAvatarUrl||persona.avatarUrl||'',talkingAvatar:persona.talkingAvatarUrl||persona.idleAvatarUrl||persona.avatarUrl||''}});
  if(result.transportHealthy!==true)throw Error('Persona LiveKit publisher did not become ready');
 }
 async leave(scope:PersonaRoomScope,personaId:string){await this.request('/persona',{method:'POST',body:{action:'leave',roomId:this.providerRoom(scope),personaId:personaWorkerId(personaId)}})}
 async speak(scope:PersonaRoomScope,personaId:string,audio:Buffer,duration:number){
  const result=await this.request('/persona/speak',{method:'POST',timeoutMs:Math.min(190000,Math.max(20000,duration*1000+10000)),body:{roomId:this.providerRoom(scope),personaId:personaWorkerId(personaId),audioDataUri:'data:audio/wav;base64,'+audio.toString('base64')}});
  if(result.transportHealthy!==true)throw Error('Persona LiveKit speech failed');
 }
}

function confirmGain(result: Record<string, unknown>, expected: number) {
  const status = result.status && typeof result.status === "object" ? result.status as Record<string, unknown> : result;
  if (status.discordReceiveGain !== expected) throw new Error("HearMeOut worker did not confirm the requested Discord receive gain; update the worker gain API before cutover");
  return result;
}

export class HttpHearMeOutVoiceBridgeWorkerError extends Error {
  constructor(readonly status: number, detail?: string) {
    super(detail ? `HearMeOut worker request failed (${status}): ${detail}` : `HearMeOut worker request failed (${status})`);
    this.name = "HttpHearMeOutVoiceBridgeWorkerError";
  }
}

function cleanId(value: string, name: string) {
  const clean = String(value ?? "").trim();
  if (!clean || clean.length > 160 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`);
  return clean;
}
function snowflake(value: string, name: string) {
  const clean = String(value ?? "").trim();
  if (!/^\d{5,30}$/.test(clean)) throw new Error(`${name} must be a Discord snowflake`);
  return clean;
}
function profile(value: HearMeOutVoiceAudioProfileV1) {
  if (value !== "low-latency" && value !== "balanced" && value !== "resilient" && value !== "clean") throw new Error("Invalid HearMeOut voice audio profile");
  return value;
}
function finiteNumber(value: number, name: string) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}
function boundedInteger(value: number, min: number, max: number, name: string) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be from ${min} through ${max}`);
  return parsed;
}
function safeProviderMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload as Record<string, unknown>;
  const raw = typeof value.message === "string" ? value.message : typeof value.error === "string" ? value.error : "";
  const clean = raw
    .replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]")
    .replace(/[\r\n\0]/g, " ")
    .trim()
    .slice(0, 240);
  return clean || undefined;
}
