export type SpmtRtcTransportKindV1 = "livekit-cloud" | "livekit-self-hosted" | "peer-webrtc" | "wss-relay";

export type SpmtRtcFailureClassV1 =
  | "rate-limited"
  | "quota-exhausted"
  | "unavailable"
  | "auth"
  | "network"
  | "unsupported"
  | "unknown";

export interface SpmtRtcTransportContextV1 {
  tenantId: string;
  roomId: string;
  userId?: string;
  purpose: "human-voice" | "discord-bridge" | "persona-audio" | "music";
}

export interface SpmtRtcTransportSessionV1 {
  transport: SpmtRtcTransportKindV1;
  roomKey: string;
  connectedAt: string;
  close(): Promise<void> | void;
}

export interface SpmtRtcTransportV1 {
  readonly kind: SpmtRtcTransportKindV1;
  readonly priority: number;
  supports(context: SpmtRtcTransportContextV1): boolean;
  connect(context: SpmtRtcTransportContextV1): Promise<SpmtRtcTransportSessionV1>;
}

export interface SpmtRtcAttemptV1 {
  transport: SpmtRtcTransportKindV1;
  outcome: "connected" | "skipped-unsupported" | "skipped-cooldown" | "failed";
  failureClass?: SpmtRtcFailureClassV1;
  message?: string;
}

export interface SpmtRtcConnectResultV1 {
  session: SpmtRtcTransportSessionV1;
  attempts: SpmtRtcAttemptV1[];
  failedOver: boolean;
}

export interface SpmtRtcBrokerOptionsV1 {
  now?: () => number;
  rateLimitCooldownMs?: number;
  quotaCooldownMs?: number;
  unavailableCooldownMs?: number;
  roomStickinessMs?: number;
}

type FailureState = { until: number; failureClass: SpmtRtcFailureClassV1; message?: string };
type RoomPreference = { kind: SpmtRtcTransportKindV1; until: number };

/**
 * Provider-independent realtime transport broker for HearMeOut.
 *
 * The broker owns selection only; media implementations remain adapters. A
 * provider failure therefore cannot become room authority. Selection is
 * deterministic, room-wide, and fail-closed: a transport is only returned
 * after its adapter proves a successful connection.
 */
export class SpmtRtcBrokerV1 {
  private readonly transports: SpmtRtcTransportV1[];
  private readonly failures = new Map<string, FailureState>();
  private readonly roomPreferences = new Map<string, RoomPreference>();
  private readonly now: () => number;
  private readonly rateLimitCooldownMs: number;
  private readonly quotaCooldownMs: number;
  private readonly unavailableCooldownMs: number;
  private readonly roomStickinessMs: number;

  constructor(transports: SpmtRtcTransportV1[], options: SpmtRtcBrokerOptionsV1 = {}) {
    const seen = new Set<SpmtRtcTransportKindV1>();
    for (const transport of transports) {
      if (!transport || seen.has(transport.kind)) throw new Error("SPMT RTC transports must have unique kinds");
      if (!Number.isFinite(transport.priority)) throw new Error(`SPMT RTC transport ${transport.kind} priority must be finite`);
      seen.add(transport.kind);
    }
    if (!transports.length) throw new Error("SPMT RTC requires at least one transport");
    this.transports = [...transports].sort((a, b) => a.priority - b.priority || a.kind.localeCompare(b.kind));
    this.now = options.now ?? (() => Date.now());
    this.rateLimitCooldownMs = boundedMs(options.rateLimitCooldownMs ?? 5 * 60_000, "rateLimitCooldownMs");
    this.quotaCooldownMs = boundedMs(options.quotaCooldownMs ?? 30 * 60_000, "quotaCooldownMs");
    this.unavailableCooldownMs = boundedMs(options.unavailableCooldownMs ?? 60_000, "unavailableCooldownMs");
    this.roomStickinessMs = boundedMs(options.roomStickinessMs ?? 5 * 60_000, "roomStickinessMs");
  }

  async connect(context: SpmtRtcTransportContextV1): Promise<SpmtRtcConnectResultV1> {
    const normalized = normalizeContext(context);
    const roomKey = `${normalized.tenantId}:${normalized.roomId}:${normalized.purpose}`;
    const attempts: SpmtRtcAttemptV1[] = [];
    const ordered = this.orderedForRoom(roomKey);

    for (const transport of ordered) {
      if (!transport.supports(normalized)) {
        attempts.push({ transport: transport.kind, outcome: "skipped-unsupported" });
        continue;
      }
      const failureKey = `${roomKey}:${transport.kind}`;
      const failure = this.failures.get(failureKey);
      if (failure && failure.until > this.now()) {
        attempts.push({ transport: transport.kind, outcome: "skipped-cooldown", failureClass: failure.failureClass, ...(failure.message ? { message: failure.message } : {}) });
        continue;
      }
      this.failures.delete(failureKey);
      try {
        const session = await transport.connect(normalized);
        if (!session || session.transport !== transport.kind || !session.roomKey) throw new Error("transport returned an invalid session");
        attempts.push({ transport: transport.kind, outcome: "connected" });
        this.roomPreferences.set(roomKey, { kind: transport.kind, until: this.now() + this.roomStickinessMs });
        return { session, attempts, failedOver: attempts.some((attempt) => attempt.transport !== transport.kind && attempt.outcome !== "skipped-unsupported") };
      } catch (error) {
        const failureClass = classifySpmtRtcFailure(error);
        const message = safeRtcError(error);
        attempts.push({ transport: transport.kind, outcome: "failed", failureClass, message });
        this.failures.set(failureKey, { until: this.now() + this.cooldownFor(failureClass), failureClass, message });
      }
    }

    const error = new SpmtRtcUnavailableError("No SPMT RTC transport could connect", attempts);
    throw error;
  }

  clearRoomPreference(context: Pick<SpmtRtcTransportContextV1, "tenantId" | "roomId" | "purpose">) {
    const value = normalizeContext({ ...context, purpose: context.purpose });
    this.roomPreferences.delete(`${value.tenantId}:${value.roomId}:${value.purpose}`);
  }

  clearTransportCooldown(kind: SpmtRtcTransportKindV1) {
    for (const key of this.failures.keys()) if (key.endsWith(`:${kind}`)) this.failures.delete(key);
  }

  private orderedForRoom(roomKey: string) {
    const preference = this.roomPreferences.get(roomKey);
    if (!preference || preference.until <= this.now()) {
      if (preference) this.roomPreferences.delete(roomKey);
      return this.transports;
    }
    const preferred = this.transports.find((transport) => transport.kind === preference.kind);
    if (!preferred) return this.transports;
    return [preferred, ...this.transports.filter((transport) => transport !== preferred)];
  }

  private cooldownFor(failureClass: SpmtRtcFailureClassV1) {
    if (failureClass === "rate-limited") return this.rateLimitCooldownMs;
    if (failureClass === "quota-exhausted") return this.quotaCooldownMs;
    if (failureClass === "auth") return this.quotaCooldownMs;
    return this.unavailableCooldownMs;
  }
}

export class SpmtRtcUnavailableError extends Error {
  constructor(message: string, readonly attempts: SpmtRtcAttemptV1[]) {
    super(message);
    this.name = "SpmtRtcUnavailableError";
  }
}

export function classifySpmtRtcFailure(error: unknown): SpmtRtcFailureClassV1 {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  if (/\b429\b|too many requests|rate[ -]?limit/i.test(text)) return "rate-limited";
  if (/quota|capacity|limit exceeded|resource exhausted/i.test(text)) return "quota-exhausted";
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid token|bad token/i.test(text)) return "auth";
  if (/unsupported|not implemented|not supported/i.test(text)) return "unsupported";
  if (/timeout|timed out|fetch failed|network|socket|websocket|ws failure|ice failed|connection refused|econn/i.test(text)) return "network";
  if (/unavailable|offline|503|502|504/i.test(text)) return "unavailable";
  return "unknown";
}

function normalizeContext(context: SpmtRtcTransportContextV1): SpmtRtcTransportContextV1 {
  const tenantId = cleanId(context?.tenantId, "tenantId");
  const roomId = cleanId(context?.roomId, "roomId");
  const purpose = context?.purpose;
  if (purpose !== "human-voice" && purpose !== "discord-bridge" && purpose !== "persona-audio" && purpose !== "music") throw new Error("SPMT RTC purpose is invalid");
  return { tenantId, roomId, purpose, ...(context.userId ? { userId: cleanId(context.userId, "userId") } : {}) };
}
function cleanId(value: unknown, name: string) { const clean = String(value ?? "").trim(); if (!clean || clean.length > 160 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`); return clean; }
function boundedMs(value: number, name: string) { const parsed = Math.trunc(Number(value)); if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 24 * 60 * 60_000) throw new Error(`${name} must be between 1000 and 86400000`); return parsed; }
function safeRtcError(error: unknown) { const text = error instanceof Error ? error.message : String(error ?? "RTC transport failed"); return text.replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").replace(/[\r\n\0]/g, " ").slice(0, 300); }
