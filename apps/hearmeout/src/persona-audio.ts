export const HEARMEOUT_PERSONA_PCM_FORMAT = Object.freeze({ sampleRate: 48_000, channels: 1, samplesPerFrame: 960, bytesPerSample: 2, encoding: "s16le" as const });

/** Pads the final 20 ms frame with silence so synthesized speech is never truncated. */
export function frameHearMeOutPersonaPcm(value: Uint8Array): Uint8Array[] {
  const input = Uint8Array.from(value), bytesPerFrame = HEARMEOUT_PERSONA_PCM_FORMAT.samplesPerFrame * HEARMEOUT_PERSONA_PCM_FORMAT.channels * HEARMEOUT_PERSONA_PCM_FORMAT.bytesPerSample;
  if (!input.byteLength) return [];
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < input.byteLength; offset += bytesPerFrame) {
    const frame = new Uint8Array(bytesPerFrame);
    frame.set(input.subarray(offset, Math.min(input.byteLength, offset + bytesPerFrame)));
    frames.push(frame);
  }
  return frames;
}
