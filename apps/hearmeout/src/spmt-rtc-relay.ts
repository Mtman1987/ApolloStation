export type SpmtRtcRelayParticipantRoleV1 = "browser" | "discord-bridge" | "persona" | "music";

export interface SpmtRtcRelayParticipantV1 {
  participantId: string;
  role: SpmtRtcRelayParticipantRoleV1;
  send(frame: Uint8Array): boolean | void;
  close?(code: number, reason: string): void;
}

export interface SpmtRtcRelayRoomOptionsV1 {
  maxParticipants?: number;
  maxFrameBytes?: number;
  maxFramesPerSecond?: number;
  idleRoomMs?: number;
  now?: () => number;
}

type ParticipantState = {
  participant: SpmtRtcRelayParticipantV1;
  windowStartedAt: number;
  framesInWindow: number;
  droppedFrames: number;
};

/**
 * Transport-neutral core for the final SPMT RTC WSS fallback.
 *
 * A thin WebSocket adapter can feed binary Opus/PCM frames into this class. The
 * relay does not decode media and has no provider dependency. It only enforces
 * bounded room membership, frame size/rate limits, echo avoidance, and
 * backpressure before forwarding frames to the other participants.
 */
export class SpmtRtcRelayRoomV1 {
  readonly roomKey: string;
  private readonly participants = new Map<string, ParticipantState>();
  private readonly maxParticipants: number;
  private readonly maxFrameBytes: number;
  private readonly maxFramesPerSecond: number;
  private readonly idleRoomMs: number;
  private readonly now: () => number;
  private lastActivityAt: number;

  constructor(roomKey: string, options: SpmtRtcRelayRoomOptionsV1 = {}) {
    this.roomKey = cleanId(roomKey, "roomKey");
    this.maxParticipants = boundedInteger(options.maxParticipants ?? 32, 2, 256, "maxParticipants");
    this.maxFrameBytes = boundedInteger(options.maxFrameBytes ?? 64 * 1024, 256, 1024 * 1024, "maxFrameBytes");
    this.maxFramesPerSecond = boundedInteger(options.maxFramesPerSecond ?? 100, 10, 500, "maxFramesPerSecond");
    this.idleRoomMs = boundedInteger(options.idleRoomMs ?? 60_000, 5_000, 60 * 60_000, "idleRoomMs");
    this.now = options.now ?? (() => Date.now());
    this.lastActivityAt = this.now();
  }

  join(participant: SpmtRtcRelayParticipantV1) {
    const participantId = cleanId(participant?.participantId, "participantId");
    if (!isRole(participant?.role)) throw new Error("SPMT RTC relay participant role is invalid");
    if (typeof participant.send !== "function") throw new Error("SPMT RTC relay participant send function is required");
    if (!this.participants.has(participantId) && this.participants.size >= this.maxParticipants) throw new Error("SPMT RTC relay room is full");
    const prior = this.participants.get(participantId);
    if (prior && prior.participant !== participant) prior.participant.close?.(4001, "replaced by newer SPMT RTC relay connection");
    this.participants.set(participantId, { participant: { ...participant, participantId }, windowStartedAt: this.now(), framesInWindow: 0, droppedFrames: 0 });
    this.lastActivityAt = this.now();
    return this.snapshot();
  }

  leave(participantId: string) {
    const clean = cleanId(participantId, "participantId");
    const removed = this.participants.delete(clean);
    if (removed) this.lastActivityAt = this.now();
    return removed;
  }

  publish(participantId: string, frame: Uint8Array) {
    const sender = this.participants.get(cleanId(participantId, "participantId"));
    if (!sender) throw new Error("SPMT RTC relay participant is not joined");
    if (!(frame instanceof Uint8Array)) throw new Error("SPMT RTC relay frame must be binary");
    if (!frame.byteLength || frame.byteLength > this.maxFrameBytes) throw new Error("SPMT RTC relay frame size is invalid");

    const now = this.now();
    if (now - sender.windowStartedAt >= 1_000) {
      sender.windowStartedAt = now;
      sender.framesInWindow = 0;
    }
    sender.framesInWindow += 1;
    if (sender.framesInWindow > this.maxFramesPerSecond) {
      sender.droppedFrames += 1;
      return { accepted: false, delivered: 0, dropped: 1, reason: "rate-limit" as const };
    }

    let delivered = 0;
    let dropped = 0;
    for (const [targetId, target] of this.participants) {
      if (targetId === participantId) continue;
      try {
        const accepted = target.participant.send(frame);
        if (accepted === false) {
          target.droppedFrames += 1;
          dropped += 1;
        } else delivered += 1;
      } catch {
        target.droppedFrames += 1;
        dropped += 1;
      }
    }
    this.lastActivityAt = now;
    return { accepted: true, delivered, dropped };
  }

  isIdle() {
    return this.participants.size === 0 && this.now() - this.lastActivityAt >= this.idleRoomMs;
  }

  snapshot() {
    return {
      roomKey: this.roomKey,
      participantCount: this.participants.size,
      participants: [...this.participants.values()].map((state) => ({ participantId: state.participant.participantId, role: state.participant.role, droppedFrames: state.droppedFrames })).sort((a, b) => a.participantId.localeCompare(b.participantId)),
      lastActivityAt: this.lastActivityAt,
    };
  }
}

export class SpmtRtcRelayHubV1 {
  private readonly rooms = new Map<string, SpmtRtcRelayRoomV1>();
  constructor(private readonly roomOptions: SpmtRtcRelayRoomOptionsV1 = {}) {}

  room(roomKey: string) {
    const clean = cleanId(roomKey, "roomKey");
    let room = this.rooms.get(clean);
    if (!room) {
      room = new SpmtRtcRelayRoomV1(clean, this.roomOptions);
      this.rooms.set(clean, room);
    }
    return room;
  }

  pruneIdle() {
    let removed = 0;
    for (const [key, room] of this.rooms) {
      if (!room.isIdle()) continue;
      this.rooms.delete(key);
      removed += 1;
    }
    return removed;
  }

  snapshot() {
    return [...this.rooms.values()].map((room) => room.snapshot()).sort((a, b) => a.roomKey.localeCompare(b.roomKey));
  }
}

function isRole(value: unknown): value is SpmtRtcRelayParticipantRoleV1 { return value === "browser" || value === "discord-bridge" || value === "persona" || value === "music"; }
function cleanId(value: unknown, name: string) { const clean = String(value ?? "").trim(); if (!clean || clean.length > 200 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`); return clean; }
function boundedInteger(value: number, min: number, max: number, name: string) { const parsed = Math.trunc(Number(value)); if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be from ${min} through ${max}`); return parsed; }
