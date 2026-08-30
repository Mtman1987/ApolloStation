import type { HearMeOutVoiceAudioProfileV1, HearMeOutVoiceBridgeWorkerV1 } from "./voice-bridge.js";

export interface HttpHearMeOutVoiceBridgeWorkerOptionsV1 {
  workerOrigin: string;
  getAuthorization: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Migration-era execution adapter for the current authenticated HearMeOut DJ
 * worker. The worker is an execution target only: canonical room, queue,
 * playback and desired bridge state remain in Apollo's HearMeOut SQLite
 * authority.
 *
 * This adapter intentionally exposes only the donor worker's bounded voice
 * bridge API. It never receives provider tokens, never puts credentials in a
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
    cleanId(input.tenantId, "tenantId");
    const roomId = cleanId(input.roomId, "roomId");
    return this.request("/voice-bridge", { query: { roomId } });
  }

  start(input: { tenantId: string; roomId: string; guildId: string; voiceChannelId: string; audioProfile: HearMeOutVoiceAudioProfileV1; discordReceiveGain: number }) {
    cleanId(input.tenantId, "tenantId");
    const roomId = cleanId(input.roomId, "roomId");
    const guildId = snowflake(input.guildId, "guildId");
    const voiceChannelId = snowflake(input.voiceChannelId, "voiceChannelId");
    const audioProfile = profile(input.audioProfile);
    finiteNumber(input.discordReceiveGain, "discordReceiveGain");
    return this.request("/voice-bridge", {
      method: "POST",
      body: { action: "start", roomId, guildId, voiceChannelId, audioProfile },
    });
  }

  stop(input: { tenantId: string; roomId: string }) {
    cleanId(input.tenantId, "tenantId");
    const roomId = cleanId(input.roomId, "roomId");
    return this.request("/voice-bridge", { method: "POST", body: { action: "stop", roomId } });
  }

  setRoomOutbound(input: { tenantId: string; roomId: string; roomVoiceOutboundEnabled: boolean }) {
    cleanId(input.tenantId, "tenantId");
    const roomId = cleanId(input.roomId, "roomId");
    if (typeof input.roomVoiceOutboundEnabled !== "boolean") throw new Error("roomVoiceOutboundEnabled must be boolean");
    return this.request("/voice-bridge/gate", {
      method: "POST",
      body: { roomId, roomVoiceOutboundEnabled: input.roomVoiceOutboundEnabled },
    });
  }

  setAudioProfile(input: { tenantId: string; roomId: string; audioProfile: HearMeOutVoiceAudioProfileV1 }) {
    cleanId(input.tenantId, "tenantId");
    const roomId = cleanId(input.roomId, "roomId");
    const audioProfile = profile(input.audioProfile);
    return this.request("/voice-bridge/audio-profile", { method: "POST", body: { roomId, audioProfile } });
  }

  private async request(path: string, options: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<Record<string, unknown>> {
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
        signal: AbortSignal.timeout(this.timeoutMs),
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
    return payload as Record<string, unknown>;
  }
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
