export const MOUNTAINVIEW_COMMANDER_POLICY_V1 = Object.freeze({
  wakePhrase: "commander mt",
  cycleMs: 10_000,
  transcriptWindowMs: 60_000,
  maximumTranscriptChars: 2_000,
});

export interface MountainViewCommanderTranscriptSnapshotV1 {
  text: string;
  segmentCount: number;
  windowMs: number;
}
export interface MountainViewCommanderCommandV1 {
  transcript: string;
  wakePhrase: "commander mt";
  wakeAt: number;
}

/** Bounded rolling transcript buffer; it never records or retains microphone audio. */
export class MountainViewCommanderTranscriptBuffer {
  private segments: Array<{ at: number; text: string }> = [];
  private lastConsumedWakeAt = -1;

  constructor(private readonly nowMs: () => number = Date.now) {}

  append(value: string, at = this.nowMs()) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1_000);
    if (!Number.isFinite(at)) return this.snapshot(this.nowMs());
    if (!text) return this.snapshot(at);
    this.segments.push({ at, text });
    this.prune(at);
    while (this.segments.length > 12) this.segments.shift();
    return this.snapshot(at);
  }

  snapshot(at = this.nowMs()): MountainViewCommanderTranscriptSnapshotV1 {
    const now = Number.isFinite(at) ? at : this.nowMs();
    this.prune(now);
    const text = this.segments.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
    return {
      text: text.slice(-MOUNTAINVIEW_COMMANDER_POLICY_V1.maximumTranscriptChars),
      segmentCount: this.segments.length,
      windowMs: MOUNTAINVIEW_COMMANDER_POLICY_V1.transcriptWindowMs,
    };
  }

  takeCommand(at = this.nowMs()): MountainViewCommanderCommandV1 | undefined {
    const now = Number.isFinite(at) ? at : this.nowMs();
    this.prune(now);
    const combined = this.segments.map((item) => item.text).join(" ");
    const matcher = /\bcommander\s+mt\b[:,]?\s*/ig;
    let match: RegExpExecArray | null;
    let latest: RegExpExecArray | undefined;
    while ((match = matcher.exec(combined))) latest = match;
    if (!latest) return undefined;
    const transcript = combined.slice(latest.index + latest[0].length).replace(/\s+/g, " ").trim();
    if (!transcript || transcript.length > MOUNTAINVIEW_COMMANDER_POLICY_V1.maximumTranscriptChars) return undefined;
    let offset = 0;
    let wakeAt = this.segments[this.segments.length - 1]?.at ?? at;
    for (const segment of this.segments) {
      const end = offset + segment.text.length;
      if (latest.index >= offset && latest.index < end) { wakeAt = segment.at; break; }
      offset = end + 1;
    }
    if (wakeAt <= this.lastConsumedWakeAt) return undefined;
    this.lastConsumedWakeAt = wakeAt;
    return { transcript, wakePhrase: "commander mt", wakeAt };
  }

  clear() { this.segments = []; this.lastConsumedWakeAt = -1; }

  private prune(at: number) {
    const cutoff = at - MOUNTAINVIEW_COMMANDER_POLICY_V1.transcriptWindowMs;
    this.segments = this.segments.filter((item) => item.at > cutoff && item.at <= at + 5_000);
    if (this.segments.length === 0) this.lastConsumedWakeAt = -1;
  }
}
