import test from "node:test";
import assert from "node:assert/strict";
import {
  allQueueCompleted,
  buildTaskPrompt,
  decideQueueItem,
  isConversationUrl,
  isTaskComplete,
  isUniqueActiveTarget,
  markQueueAttempted,
  nextQueueItem,
  recordQueueAttempt,
  resumeLimitedItem,
  retryAttemptedItem,
  taskCycleLimitReached
} from "../tools/apollo-work-resumer/extension/logic.mjs";

const item = {
  id: "q1",
  status: "pending",
  prompt: "Finish task",
  targetUrl: "https://chatgpt.com/c/abc",
  completionToken: "APOLLO_TASK_COMPLETE:q1",
  cycles: 0
};

test("conversation URL validator accepts only exact ChatGPT conversation URLs", () => {
  assert.equal(isConversationUrl("https://chatgpt.com/c/abc-123"), true);
  assert.equal(isConversationUrl("https://evil.example/c/abc"), false);
  assert.equal(isConversationUrl("https://chatgpt.com/c/abc?x=1"), false);
  assert.equal(isConversationUrl("https://chatgpt.com/"), false);
});

test("active task wins, then an uncertain attempt blocks later pending work", () => {
  const pending = { ...item, status: "pending" };
  const attempted = { ...item, id: "q2", status: "attempted" };
  const active = { ...item, id: "q3", status: "active" };
  assert.equal(nextQueueItem([pending, attempted, active]).id, "q3");
  assert.equal(nextQueueItem([attempted, pending]).id, "q2");
  assert.equal(nextQueueItem([pending]).id, "q1");
});

test("only the unique exact target in the last-focused active tab is eligible", () => {
  const target = { id: 7, url: item.targetUrl };
  assert.equal(isUniqueActiveTarget([target], [target], item.targetUrl), true);
  assert.equal(isUniqueActiveTarget([target], [{ id: 8, url: item.targetUrl }], item.targetUrl), false);
  assert.equal(isUniqueActiveTarget([target, { id: 9, url: item.targetUrl }], [target], item.targetUrl), false);
  assert.equal(isUniqueActiveTarget([target], [target], "https://chatgpt.com/c/other"), false);
  assert.equal(isUniqueActiveTarget([target], [], item.targetUrl), false);
});

test("initial and continuation prompts carry the task-specific completion token", () => {
  assert.match(buildTaskPrompt(item), /Finish task/);
  assert.match(buildTaskPrompt(item), /TODO\/checkpoint/);
  assert.match(buildTaskPrompt(item), /APOLLO_TASK_COMPLETE:q1/);
  assert.match(buildTaskPrompt({ ...item, status: "active" }), /Continue working/);
});

test("completion marker requires an idle response for the active task", () => {
  assert.equal(isTaskComplete({ ...item, status: "active" }, { busy: false, assistantText: "APOLLO_TASK_COMPLETE:q1" }), true);
  assert.equal(isTaskComplete({ ...item, status: "active" }, { busy: true, assistantText: "APOLLO_TASK_COMPLETE:q1" }), false);
  assert.equal(isTaskComplete(item, { busy: false, assistantText: "APOLLO_TASK_COMPLETE:q1" }), false);
});

test("queue completion helper requires every item completed", () => {
  assert.equal(allQueueCompleted([{ status: "completed" }, { status: "completed" }]), true);
  assert.equal(allQueueCompleted([{ status: "completed" }, { status: "active" }]), false);
  assert.equal(allQueueCompleted([]), false);
});

test("cycle cap is per queue item", () => {
  assert.equal(taskCycleLimitReached({ ...item, cycles: 3 }, 3), true);
  assert.equal(taskCycleLimitReached(item, 3), false);
});

test("uncertain continuation retry restores active state, not the original prompt", () => {
  const active = { ...item, status: "active", cycles: 1 };
  const attempted = markQueueAttempted(active, "Continue working", 100);
  assert.equal(attempted.status, "attempted");
  assert.equal(attempted.resumeStatus, "active");
  const uncertain = recordQueueAttempt(attempted, false, 101);
  assert.equal(uncertain.status, "attempted");
  const retried = retryAttemptedItem(uncertain, 102);
  assert.equal(retried.status, "active");
  assert.equal(retried.cycles, 1);
  assert.equal(retried.attemptedPrompt, null);
});

test("explicit retry of an uncertain initial send returns to pending", () => {
  const attempted = markQueueAttempted(item, "initial prompt", 100);
  const retried = retryAttemptedItem(recordQueueAttempt(attempted, false, 101), 102);
  assert.equal(retried.status, "pending");
  assert.equal(retried.lastUncertainAttemptAt, 100);
});

test("resuming a cycle-limited task starts a fresh cycle budget", () => {
  const limited = { ...item, status: "limit-reached", cycles: 3, priorCycles: 2 };
  const resumed = resumeLimitedItem(limited, 200);
  assert.equal(resumed.status, "active");
  assert.equal(resumed.cycles, 0);
  assert.equal(resumed.priorCycles, 5);
});

test("queue submission decision reuses the fail-closed guard", () => {
  const prompt = buildTaskPrompt(item);
  assert.equal(decideQueueItem({
    item,
    prompt,
    snapshot: { url: item.targetUrl, busy: false, stopControlVisible: false, sendControlVisible: true, composerReady: true },
  }).action, "submit");
  assert.equal(decideQueueItem({
    item,
    prompt,
    snapshot: { url: item.targetUrl, busy: null, stopControlVisible: false, sendControlVisible: false, composerReady: true },
  }).reason, "ambiguous-ui");
});
