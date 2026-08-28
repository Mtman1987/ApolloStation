import type { HearMeOutVoiceAudioProfileV1, HearMeOutVoiceBridgeWorkerV1 } from "./voice-bridge.js";

export const HEARMEOUT_LIVEKIT_RECONNECT_BASE_MS = 1_500;
export const HEARMEOUT_LIVEKIT_RECONNECT_MAX_MS = 20_000;
export const HEARMEOUT_LIVEKIT_CONNECT_MAX_ATTEMPTS = 5;
export const HEARMEOUT_LIVEKIT_RATE_LIMIT_BASE_MS = 2_000;
export const HEARMEOUT_DISCORD_JOIN_COOLDOWN_MS = 60_000;

export interface HearMeOutVoiceBridgeResilienceOptionsV1 {
  nowMs?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  connectMaxAttempts?: number;
  rateLimitBaseMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  discordJoinCooldownMs?: number;
}

/**
 * Donor-compatible resilience around the concrete Discord/LiveKit bridge worker.
 * It owns no room/media state: it only suppresses duplicate starts, applies the
 * donor bounded 429 retry policy, and protects a channel from immediate rejoin
 * loops after the Discord bot is moved/kicked/disconnected.
 */
export class ResilientHearMeOutVoiceBridgeWorker implements HearMeOutVoiceBridgeWorkerV1 {
  private readonly starts = new Map<string, Promise<Record<string, unknown>>>();
  private readonly cooldowns = new Map<string, { until: number; reason: string }>();
  private readonly nowMs: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly connectMaxAttempts: number;
  private readonly rateLimitBaseMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly discordJoinCooldownMs: number;

  constructor(private readonly worker: HearMeOutVoiceBridgeWorkerV1, options: HearMeOutVoiceBridgeResilienceOptionsV1 = {}) {
    this.nowMs = options.nowMs ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.connectMaxAttempts = boundedInteger(options.connectMaxAttempts ?? HEARMEOUT_LIVEKIT_CONNECT_MAX_ATTEMPTS, 1, 10, "connectMaxAttempts");
    this.rateLimitBaseMs = boundedInteger(options.rateLimitBaseMs ?? HEARMEOUT_LIVEKIT_RATE_LIMIT_BASE_MS, 1, 60_000, "rateLimitBaseMs");
    this.reconnectBaseMs = boundedInteger(options.reconnectBaseMs ?? HEARMEOUT_LIVEKIT_RECONNECT_BASE_MS, 1, 60_000, "reconnectBaseMs");
    this.reconnectMaxMs = boundedInteger(options.reconnectMaxMs ?? HEARMEOUT_LIVEKIT_RECONNECT_MAX_MS, this.reconnectBaseMs, 300_000, "reconnectMaxMs");
    this.discordJoinCooldownMs = boundedInteger(options.discordJoinCooldownMs ?? HEARMEOUT_DISCORD_JOIN_COOLDOWN_MS, 1, 300_000, "discordJoinCooldownMs");
  }

  status(input: { tenantId: string; roomId: string }) {
    return this.worker.status(input);
  }

  start(input: { tenantId: string; roomId: string; guildId: string; voiceChannelId: string; audioProfile: HearMeOutVoiceAudioProfileV1; discordReceiveGain: number }) {
    const key = bridgeKey(input.tenantId, input.roomId);
    const existing = this.starts.get(key);
    if (existing) return existing;
    const cooldown = this.cooldowns.get(key);
    if (cooldown && cooldown.until > this.nowMs()) {
      const remainingMs = cooldown.until - this.nowMs();
      return Promise.reject(new Error(`Discord voice bridge rejoin cooldown is active for ${remainingMs}ms (${safeReason(cooldown.reason)})`));
    }
    if (cooldown) this.cooldowns.delete(key);
    const pending = this.startWithRateLimitRetry(input).finally(() => {
      if (this.starts.get(key) === pending) this.starts.delete(key);
    });
    this.starts.set(key, pending);
    return pending;
  }

  stop(input: { tenantId: string; roomId: string }) {
    return this.worker.stop(input);
  }

  setRoomOutbound(input: { tenantId: string; roomId: string; roomVoiceOutboundEnabled: boolean }) {
    return this.worker.setRoomOutbound(input);
  }

  setAudioProfile(input: { tenantId: string; roomId: string; audioProfile: HearMeOutVoiceAudioProfileV1 }) {
    return this.worker.setAudioProfile(input);
  }

  setDiscordReceiveGain(input: { tenantId: string; roomId: string; discordReceiveGain: number }) {
    if (!this.worker.setDiscordReceiveGain) return Promise.resolve({ running: false, discordReceiveGain: input.discordReceiveGain });
    return this.worker.setDiscordReceiveGain(input);
  }

  markDiscordDisconnect(input: { tenantId: string; roomId: string; reason: string }) {
    const key = bridgeKey(input.tenantId, input.roomId);
    const until = this.nowMs() + this.discordJoinCooldownMs;
    this.cooldowns.set(key, { until, reason: safeReason(input.reason) });
    return { until, retryAfterMs: this.discordJoinCooldownMs };
  }

  clearDiscordCooldown(tenantId: string, roomId: string) {
    return this.cooldowns.delete(bridgeKey(tenantId, roomId));
  }

  reconnectDelayMs(attemptInput: number) {
    const attempt = boundedInteger(attemptInput, 1, 100, "attempt");
    return Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** (attempt - 1)));
  }

  private async startWithRateLimitRetry(input: { tenantId: string; roomId: string; guildId: string; voiceChannelId: string; audioProfile: HearMeOutVoiceAudioProfileV1; discordReceiveGain: number }) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.connectMaxAttempts; attempt += 1) {
      try {
        return await this.worker.start(input);
      } catch (error) {
        lastError = error;
        if (!isHearMeOutLiveKitRateLimitError(error) || attempt === this.connectMaxAttempts) throw error;
        const delayMs = this.rateLimitBaseMs * (2 ** (attempt - 1));
        await this.sleep(delayMs);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("HearMeOut voice bridge failed to start");
  }
}

export function isHearMeOutLiveKitRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b429\b|too many requests|rate[ -]?limit/i.test(message);
}

function bridgeKey(tenantId: string, roomId: string) {
  return `${cleanId(tenantId, "tenantId")}:${cleanId(roomId, "roomId")}`;
}
function cleanId(value: string, name: string) {
  const clean = String(value ?? "").trim();
  if (!clean || clean.length > 160 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`);
  return clean;
}
function boundedInteger(value: number, min: number, max: number, name: string) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be from ${min} through ${max}`);
  return parsed;
}
function safeReason(value: string) {
  return String(value ?? "disconnected").replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/[\r\n\0]/g, " ").slice(0, 160);
}
