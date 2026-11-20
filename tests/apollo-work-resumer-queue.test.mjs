import test from "node:test";
import assert from "node:assert/strict";
import { enqueue, completeQueueItem, nextPending, promptHash } from "../tools/apollo-work-resumer/queue.mjs";

test("queue validates target and persists hashed pending items", () => {
  const state = { queue: [], activityLog: [] };
  const next = enqueue(state, { id: "q1", prompt: " work ", targetConversationUrl: "https://chatgpt.com/c/abc" }, 1);
  assert.equal(nextPending(next).prompt, "work");
  assert.equal(nextPending(next).promptHash, promptHash("work"));
  assert.throws(() => enqueue(state, { prompt: "x", targetConversationUrl: "https://evil.example" }), /exact ChatGPT/);
});
test("completion marks item and queue completion", () => {
  const state = enqueue({ queue: [], activityLog: [] }, { id: "q1", prompt: "work", targetConversationUrl: "https://chatgpt.com/c/abc" });
  const done = completeQueueItem(state, "q1", 5);
  assert.equal(done.queue[0].status, "completed");
  assert.equal(done.completed, true);
});
