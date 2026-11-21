import test from "node:test";
import assert from "node:assert/strict";
import { decideResume } from "../tools/apollo-work-resumer/guard.mjs";

const base = {
  enabled: true, paused: false, completed: false, maxCycles: 4, cycles: 0,
  targetConversationUrl: "https://chatgpt.com/c/abc",
  pendingPrompt: "Resume the task", pendingPromptHash: "hash-1",
};
const ready = { url: base.targetConversationUrl, busy: false, stopControlVisible: false, sendControlVisible: true, composerReady: true };

test("submits only when all guards pass", () => {
  assert.deepEqual(decideResume({ state: base, snapshot: ready, now: 100_000 }), {
    action: "submit", reason: "all-guards-passed", prompt: "Resume the task",
  });
});
test("no-op while paused, busy, or ambiguous", () => {
  assert.equal(decideResume({ state: { ...base, paused: true }, snapshot: ready }).reason, "paused-or-disabled");
  assert.equal(decideResume({ state: base, snapshot: { ...ready, busy: true, stopControlVisible: true } }).reason, "chat-busy");
  assert.equal(decideResume({ state: base, snapshot: { ...ready, sendControlVisible: false } }).reason, "ambiguous-ui");
});
test("no-op for wrong conversation and missing prompt", () => {
  assert.equal(decideResume({ state: base, snapshot: { ...ready, url: "https://chatgpt.com/c/other" } }).reason, "conversation-mismatch");
  assert.equal(decideResume({ state: { ...base, pendingPrompt: "" }, snapshot: ready }).reason, "no-pending-prompt");
});
test("enforces cycle cap, duplicate hash, and cooldown", () => {
  assert.equal(decideResume({ state: { ...base, cycles: 4 }, snapshot: ready }).reason, "max-cycles-reached");
  assert.equal(decideResume({ state: { ...base, lastSubmittedPromptHash: "hash-1" }, snapshot: ready }).reason, "prompt-already-submitted");
  assert.equal(decideResume({ state: { ...base, lastSubmittedAt: 90_000 }, snapshot: ready, now: 100_000 }).reason, "submission-cooldown");
});
