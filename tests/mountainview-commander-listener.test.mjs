import assert from "node:assert/strict";
import test from "node:test";
import { MOUNTAINVIEW_COMMANDER_POLICY_V1, MountainViewCommanderTranscriptBuffer } from "../apps/mountainview/dist/index.js";

test("Commander MT policy uses ten-second cycles and a sixty-second transcript window", () => {
  assert.equal(MOUNTAINVIEW_COMMANDER_POLICY_V1.wakePhrase, "commander mt");
  assert.equal(MOUNTAINVIEW_COMMANDER_POLICY_V1.cycleMs, 10_000);
  assert.equal(MOUNTAINVIEW_COMMANDER_POLICY_V1.transcriptWindowMs, 60_000);
});

test("rolling transcript retains only the last sixty seconds", () => {
  const buffer = new MountainViewCommanderTranscriptBuffer(() => 60_000);
  for (let i = 0; i < 7; i += 1) buffer.append(`segment ${i}`, i * 10_000);
  const snapshot = buffer.snapshot(60_000);
  assert.equal(snapshot.segmentCount, 6);
  assert.equal(snapshot.text, "segment 1 segment 2 segment 3 segment 4 segment 5 segment 6");
});

test("wake phrase and command may span separate ten-second transcript segments", () => {
  const buffer = new MountainViewCommanderTranscriptBuffer(() => 20_000);
  buffer.append("background conversation", 0);
  buffer.append("Commander", 10_000);
  buffer.append("MT, switch OBS to Gameplay", 20_000);
  assert.deepEqual(buffer.takeCommand(20_000), {
    transcript: "switch OBS to Gameplay",
    wakePhrase: "commander mt",
    wakeAt: 10_000,
  });
});

test("a wake phrase is consumed once and later wake phrases remain actionable", () => {
  const buffer = new MountainViewCommanderTranscriptBuffer(() => 30_000);
  buffer.append("Commander MT, switch OBS to Gameplay", 10_000);
  assert.equal(buffer.takeCommand(10_000)?.transcript, "switch OBS to Gameplay");
  assert.equal(buffer.takeCommand(10_000), undefined);
  buffer.append("Commander MT, mute Companion", 20_000);
  assert.equal(buffer.takeCommand(20_000)?.transcript, "mute Companion");
});

test("transcript is bounded and blank or invalid timestamps do not add segments", () => {
  const buffer = new MountainViewCommanderTranscriptBuffer(() => 1_000);
  buffer.append("kept", 500);
  buffer.append("   ", 0);
  buffer.append("x".repeat(2_500), 1_000);
  buffer.append("ignored timestamp", Number.NaN);
  assert.equal(buffer.snapshot(1_000).text.length, 2_000);
  assert.equal(buffer.snapshot(1_000).text.startsWith("kept"), true);
  assert.equal(buffer.snapshot(1_000).segmentCount, 1);
  buffer.clear();
  assert.equal(buffer.snapshot(1_000).text, "");
});
