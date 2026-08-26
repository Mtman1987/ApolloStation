export const HEARMEOUT_DISCORD_SAMPLE_RATE = 48_000;
export const HEARMEOUT_DISCORD_CHANNELS = 2;
export const HEARMEOUT_DISCORD_FRAME_MS = 20;
export const HEARMEOUT_DISCORD_SAMPLES_PER_FRAME = 960;
export const HEARMEOUT_DISCORD_BYTES_PER_SAMPLE = 2;
export const HEARMEOUT_DISCORD_BYTES_PER_FRAME = HEARMEOUT_DISCORD_SAMPLES_PER_FRAME * HEARMEOUT_DISCORD_CHANNELS * HEARMEOUT_DISCORD_BYTES_PER_SAMPLE;

export type HearMeOutDiscordReceiveProfileV1 = "low-latency" | "balanced" | "resilient" | "clean";

export interface HearMeOutDiscordReceiveProfileConfigV1 {
  targetFrames: number;
  maxFrames: number;
  adaptiveMaxFrames: number;
  maxStartupWaitMs: number;
  fadeSamples: number;
}

export interface HearMeOutDiscordReceiveMetricsV1 {
  starts: number;
  speechEnds: number;
  underruns: number;
  rebuffers: number;
  lateFrames: number;
  droppedFrames: number;
  concealedFrames: number;
  currentBufferedFrames: number;
  targetFrames: number;
  arrivalJitterMs: number;
}

export interface HearMeOutDiscordMixMetricsV1 {
  limitedSamples: number;
  clippedSamples: number;
  receiveGain: number;
}

export const HEARMEOUT_DISCORD_RECEIVE_PROFILES: Readonly<Record<HearMeOutDiscordReceiveProfileV1, HearMeOutDiscordReceiveProfileConfigV1>> = Object.freeze({
  "low-latency": Object.freeze({ targetFrames: 4, maxFrames: 20, adaptiveMaxFrames: 10, maxStartupWaitMs: 100, fadeSamples: 120 }),
  balanced: Object.freeze({ targetFrames: 8, maxFrames: 32, adaptiveMaxFrames: 18, maxStartupWaitMs: 180, fadeSamples: 144 }),
  resilient: Object.freeze({ targetFrames: 14, maxFrames: 48, adaptiveMaxFrames: 28, maxStartupWaitMs: 320, fadeSamples: 192 }),
  // Clean is the default Discord -> HearMeOut profile. It deliberately trades about one second of
  // incoming latency for enough playout headroom to absorb Discord burst jitter before LiveKit sees it.
  clean: Object.freeze({ targetFrames: 50, maxFrames: 100, adaptiveMaxFrames: 75, maxStartupWaitMs: 1_000, fadeSamples: 480 }),
});

export function normalizeHearMeOutDiscordReceiveProfile(value: unknown): HearMeOutDiscordReceiveProfileV1 {
  return value === "low-latency" || value === "balanced" || value === "resilient" || value === "clean" ? value : "clean";
}

export function clampHearMeOutDiscordReceiveGain(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0.25, Math.min(2, numeric));
}

export class HearMeOutDiscordPcmJitterSource {
  private readonly profile: HearMeOutDiscordReceiveProfileV1;
  private readonly config: HearMeOutDiscordReceiveProfileConfigV1;
  private buffer = Buffer.alloc(0);
  private started = false;
  private starved = false;
  private emptyPulls = 0;
  private needsAttack = false;
  private firstQueuedAt: number | undefined;
  private lastArrivalAt: number | undefined;
  private stableFrames = 0;
  private targetFrames: number;
  private metrics: HearMeOutDiscordReceiveMetricsV1;

  constructor(profile: HearMeOutDiscordReceiveProfileV1 = "clean") {
    this.profile = normalizeHearMeOutDiscordReceiveProfile(profile);
    this.config = HEARMEOUT_DISCORD_RECEIVE_PROFILES[this.profile];
    this.targetFrames = this.config.targetFrames;
    this.metrics = {
      starts: 0,
      speechEnds: 0,
      underruns: 0,
      rebuffers: 0,
      lateFrames: 0,
      droppedFrames: 0,
      concealedFrames: 0,
      currentBufferedFrames: 0,
      targetFrames: this.targetFrames,
      arrivalJitterMs: 0,
    };
  }

  push(chunk: Buffer | Uint8Array, now = Date.now()): void {
    const incoming = Buffer.from(chunk);
    if (incoming.length === 0) return;
    const evenLength = incoming.length - (incoming.length % HEARMEOUT_DISCORD_BYTES_PER_SAMPLE);
    if (evenLength <= 0) return;
    if (this.lastArrivalAt !== undefined) {
      const delta = Math.max(0, now - this.lastArrivalAt);
      const error = Math.abs(delta - HEARMEOUT_DISCORD_FRAME_MS);
      this.metrics.arrivalJitterMs = this.metrics.arrivalJitterMs === 0 ? error : (this.metrics.arrivalJitterMs * 0.9) + (error * 0.1);
    }
    this.lastArrivalAt = now;
    if (this.firstQueuedAt === undefined) this.firstQueuedAt = now;
    if (this.starved && this.started) {
      this.metrics.lateFrames += Math.max(1, Math.floor(evenLength / HEARMEOUT_DISCORD_BYTES_PER_FRAME));
      this.needsAttack = true;
    }
    this.buffer = Buffer.concat([this.buffer, incoming.subarray(0, evenLength)]);
    const maxBytes = this.config.maxFrames * HEARMEOUT_DISCORD_BYTES_PER_FRAME;
    if (this.buffer.length > maxBytes) {
      const excess = this.buffer.length - maxBytes;
      const wholeFrames = Math.ceil(excess / HEARMEOUT_DISCORD_BYTES_PER_FRAME);
      const dropBytes = Math.min(this.buffer.length, wholeFrames * HEARMEOUT_DISCORD_BYTES_PER_FRAME);
      this.buffer = this.buffer.subarray(dropBytes);
      this.metrics.droppedFrames += wholeFrames;
    }
    this.updateBufferedMetric();
  }

  pullFrame(now = Date.now()): Buffer {
    if (!this.started) {
      const bufferedFrames = this.bufferedFrames();
      const waitedMs = this.firstQueuedAt === undefined ? 0 : Math.max(0, now - this.firstQueuedAt);
      if (bufferedFrames < this.targetFrames && waitedMs < this.config.maxStartupWaitMs) return this.silence();
      if (bufferedFrames === 0) return this.silence();
      this.started = true;
      this.starved = false;
      this.emptyPulls = 0;
      this.needsAttack = true;
      this.metrics.starts += 1;
    }

    if (this.buffer.length < HEARMEOUT_DISCORD_BYTES_PER_FRAME) {
      this.emptyPulls += 1;
      this.metrics.concealedFrames += 1;
      this.starved = true;
      if (this.emptyPulls >= 2) {
        this.started = false;
        this.emptyPulls = 0;
        this.firstQueuedAt = undefined;
        this.metrics.underruns += 1;
        this.metrics.rebuffers += 1;
        this.targetFrames = Math.min(this.config.adaptiveMaxFrames, this.targetFrames + 2);
        this.metrics.targetFrames = this.targetFrames;
        this.needsAttack = true;
        this.stableFrames = 0;
      }
      return this.silence();
    }

    let frame = Buffer.from(this.buffer.subarray(0, HEARMEOUT_DISCORD_BYTES_PER_FRAME));
    this.buffer = this.buffer.subarray(HEARMEOUT_DISCORD_BYTES_PER_FRAME);
    this.emptyPulls = 0;
    this.starved = false;
    if (this.needsAttack) {
      frame = fadePcm16Edge(frame, this.config.fadeSamples, "in");
      this.needsAttack = false;
    }
    if (this.buffer.length < HEARMEOUT_DISCORD_BYTES_PER_FRAME) {
      frame = fadePcm16Edge(frame, this.config.fadeSamples, "out");
      this.metrics.speechEnds += 1;
    }
    this.stableFrames += 1;
    if (this.stableFrames >= 1_500 && this.targetFrames > this.config.targetFrames) {
      this.targetFrames -= 1;
      this.metrics.targetFrames = this.targetFrames;
      this.stableFrames = 0;
    }
    this.updateBufferedMetric();
    return frame;
  }

  snapshot(): HearMeOutDiscordReceiveMetricsV1 {
    this.updateBufferedMetric();
    return { ...this.metrics, arrivalJitterMs: Math.round(this.metrics.arrivalJitterMs * 100) / 100 };
  }

  bufferedFrames(): number {
    return Math.floor(this.buffer.length / HEARMEOUT_DISCORD_BYTES_PER_FRAME);
  }

  private silence(): Buffer {
    this.updateBufferedMetric();
    return Buffer.alloc(HEARMEOUT_DISCORD_BYTES_PER_FRAME);
  }

  private updateBufferedMetric() {
    this.metrics.currentBufferedFrames = this.bufferedFrames();
  }
}

export function mixHearMeOutDiscordReceiveFrames(
  frames: readonly (Buffer | Uint8Array)[],
  options: { receiveGain?: number; limiterThreshold?: number } = {},
): { frame: Buffer; metrics: HearMeOutDiscordMixMetricsV1 } {
  const gain = clampHearMeOutDiscordReceiveGain(options.receiveGain ?? 1);
  const thresholdRatio = Number.isFinite(options.limiterThreshold) ? Math.max(0.5, Math.min(0.98, Number(options.limiterThreshold))) : 0.9;
  const threshold = 32_767 * thresholdRatio;
  const output = Buffer.alloc(HEARMEOUT_DISCORD_BYTES_PER_FRAME);
  let limitedSamples = 0;
  let clippedSamples = 0;
  const valid = frames.map((frame) => Buffer.from(frame)).filter((frame) => frame.length >= HEARMEOUT_DISCORD_BYTES_PER_FRAME);
  if (valid.length === 0) return { frame: output, metrics: { limitedSamples, clippedSamples, receiveGain: gain } };

  for (let offset = 0; offset < HEARMEOUT_DISCORD_BYTES_PER_FRAME; offset += 2) {
    let mixed = 0;
    for (const frame of valid) mixed += frame.readInt16LE(offset);
    mixed *= gain;
    if (Math.abs(mixed) > 32_767) clippedSamples += 1;
    if (Math.abs(mixed) > threshold) {
      limitedSamples += 1;
      const sign = mixed < 0 ? -1 : 1;
      const magnitude = Math.abs(mixed);
      const headroom = Math.max(1, 32_767 - threshold);
      mixed = sign * (threshold + headroom * (1 - Math.exp(-(magnitude - threshold) / headroom)));
    }
    output.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round(mixed))), offset);
  }
  return { frame: output, metrics: { limitedSamples, clippedSamples, receiveGain: gain } };
}

export function fadePcm16Edge(frame: Buffer | Uint8Array, fadeSamples: number, direction: "in" | "out"): Buffer {
  const output = Buffer.from(frame);
  const totalSamples = Math.floor(output.length / 2);
  const stereoFrames = Math.floor(totalSamples / HEARMEOUT_DISCORD_CHANNELS);
  const fadeFrames = Math.max(1, Math.min(stereoFrames, Math.trunc(fadeSamples)));
  for (let index = 0; index < fadeFrames; index += 1) {
    const ratio = direction === "in" ? (index + 1) / fadeFrames : (fadeFrames - index - 1) / fadeFrames;
    for (let channel = 0; channel < HEARMEOUT_DISCORD_CHANNELS; channel += 1) {
      const sampleIndex = direction === "in" ? (index * HEARMEOUT_DISCORD_CHANNELS) + channel : ((stereoFrames - fadeFrames + index) * HEARMEOUT_DISCORD_CHANNELS) + channel;
      const offset = sampleIndex * 2;
      output.writeInt16LE(Math.round(output.readInt16LE(offset) * ratio), offset);
    }
  }
  return output;
}
