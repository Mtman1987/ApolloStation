import assert from "node:assert/strict";
import test from "node:test";
import {
  HEARMEOUT_DISCORD_BYTES_PER_FRAME,
  HEARMEOUT_DISCORD_RECEIVE_PROFILES,
  HearMeOutDiscordPcmJitterSource,
  clampHearMeOutDiscordReceiveGain,
  mixHearMeOutDiscordReceiveFrames,
} from "../apps/hearmeout/dist/index.js";

function pcmFrame(sample = 10_000) {
  const frame = Buffer.alloc(HEARMEOUT_DISCORD_BYTES_PER_FRAME);
  for (let offset = 0; offset < frame.length; offset += 2) frame.writeInt16LE(sample, offset);
  return frame;
}

function isSilence(frame) {
  for (const byte of frame) if (byte !== 0) return false;
  return true;
}

test("clean Discord receive profile holds about one second of playout headroom", () => {
  assert.equal(HEARMEOUT_DISCORD_RECEIVE_PROFILES.clean.targetFrames, 50);
  assert.equal(HEARMEOUT_DISCORD_RECEIVE_PROFILES.clean.maxStartupWaitMs, 1_000);
  assert.equal(HEARMEOUT_DISCORD_RECEIVE_PROFILES.clean.maxFrames, 100);

  const source = new HearMeOutDiscordPcmJitterSource("clean");
  const start = 10_000;
  for (let index = 0; index < 20; index += 1) source.push(pcmFrame(), start + index * 20);
  assert.equal(isSilence(source.pullFrame(start + 500)), true, "clean receive must not prematurely drain a short Discord burst");
  const first = source.pullFrame(start + 1_000);
  assert.equal(first.length, HEARMEOUT_DISCORD_BYTES_PER_FRAME);
  assert.equal(isSilence(first), false, "startup timeout eventually releases buffered speech even below the target");
});

test("Discord jitter recovery emits silence instead of repeating speech edges", () => {
  const source = new HearMeOutDiscordPcmJitterSource("low-latency");
  const start = 20_000;
  for (let index = 0; index < 4; index += 1) source.push(pcmFrame(12_000), start + index * 20);
  const speech = source.pullFrame(start + 80);
  assert.equal(isSilence(speech), false);
  source.pullFrame(start + 100);
  source.pullFrame(start + 120);
  source.pullFrame(start + 140);
  const missingA = source.pullFrame(start + 160);
  const missingB = source.pullFrame(start + 180);
  assert.equal(isSilence(missingA), true);
  assert.equal(isSilence(missingB), true);
  const metrics = source.snapshot();
  assert.equal(metrics.underruns, 1);
  assert.equal(metrics.rebuffers, 1);
  assert.equal(metrics.targetFrames, 6, "adaptive target rises after a real underrun");
});

test("Discord receive gain is bounded and mixed speech is softly limited", () => {
  assert.equal(clampHearMeOutDiscordReceiveGain(0), 0.25);
  assert.equal(clampHearMeOutDiscordReceiveGain(5), 2);
  assert.equal(clampHearMeOutDiscordReceiveGain("bad"), 1);
  const loud = pcmFrame(30_000);
  const result = mixHearMeOutDiscordReceiveFrames([loud, loud], { receiveGain: 1.5 });
  assert.equal(result.frame.length, HEARMEOUT_DISCORD_BYTES_PER_FRAME);
  assert.ok(result.metrics.limitedSamples > 0);
  assert.ok(result.metrics.clippedSamples > 0);
  for (let offset = 0; offset < result.frame.length; offset += 2) {
    const sample = result.frame.readInt16LE(offset);
    assert.ok(sample >= -32_768 && sample <= 32_767);
  }
});
