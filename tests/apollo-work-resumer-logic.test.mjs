import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTaskPrompt,
  nextQueueItem,
  isTaskComplete,
  taskCycleLimitReached,
  allQueueCompleted,
  isConversationUrl,
  decideQueueItem,
  selectUniqueActiveTab,
  createSerialRunner,
  prepareManualRetry,
  resumeCycleLimitedItem,
} from "../tools/apollo-work-resumer/extension/logic.mjs";

const item = {
  id: "q1",
  status: "pending",
  prompt: "Finish task",
  completionToken: "APOLLO_TASK_COMPLETE:q1",
  cycles: 0,
};

test("conversation URL validator accepts only exact live ChatGPT conversation URLs", () => {
  assert.equal(isConversationUrl("https://chatgpt.com/c/abc-123"), true);
  assert.equal(isConversationUrl("https://evil.example/c/abc"), false);
  assert.equal(isConversationUrl("https://chatgpt.com.evil/c/abc"), false);
  assert.equal(isConversationUrl("https://chatgpt.com/c/abc?x=1"), false);
  assert.equal(isConversationUrl("https://chatgpt.com/c/abc/"), false);
  assert.equal(isConversationUrl("https://user@chatgpt.com/c/abc"), false);
  assert.equal(isConversationUrl("https://chatgpt.com/"), false);
});

test("active queue item has priority over pending work", () => {
  assert.equal(nextQueueItem([
    { ...item, status: "pending" },
    { ...item, id: "q2", status: "active" },
  ]).id, "q2");
});

test("uncertain sends block the queue until explicit owner action", () => {
  assert.equal(nextQueueItem([
    { ...item, status: "attempted" },
    { ...item, id: "q2", status: "pending" },
  ]), null);
  assert.equal(nextQueueItem([
    { ...item, status: "active" },
    { ...item, id: "q2", status: "active" },
  ]), null);
});

test("an explicitly confirmed retry is prioritized over ordinary pending work", () => {
  const retry = { ...item, id: "retry", status: "pending", manualRetryAt: 100 };
  const ordinary = { ...item, id: "ordinary", status: "pending" };
  assert.equal(nextQueueItem([ordinary, retry]).id, "retry");
});

test("initial and continuation prompts carry the unique completion marker", () => {
  assert.match(buildTaskPrompt(item), /Finish task/);
  assert.match(buildTaskPrompt(item), /TODO\/checkpoint/);
  assert.match(buildTaskPrompt(item), /APOLLO_TASK_COMPLETE:q1/);
  assert.match(buildTaskPrompt({ ...item, status: "active" }), /Continue working/);
});

test("completion marker must occupy its own line in the idle latest assistant response", () => {
  const active = { ...item, status: "active" };
  assert.equal(isTaskComplete(active, { busy: false, assistantText: "Done\nAPOLLO_TASK_COMPLETE:q1\n" }), true);
  assert.equal(isTaskComplete(active, { busy: false, assistantText: "I saw APOLLO_TASK_COMPLETE:q1 in the prompt" }), false);
  assert.equal(isTaskComplete(active, { busy: true, assistantText: "APOLLO_TASK_COMPLETE:q1" }), false);
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

test("cycle-limit resume starts a fresh cycle window and retains the previous count", () => {
  const limited = { ...item, status: "limit-reached", cycles: 3, previousCycleCount: 2 };
  const resumed = resumeCycleLimitedItem(limited, 500);
  assert.equal(resumed.status, "active");
  assert.equal(resumed.cycles, 0);
  assert.equal(resumed.previousCycleCount, 5);
  assert.equal(resumed.resumedAt, 500);
  assert.equal(taskCycleLimitReached(resumed, 3), false);
  assert.equal(resumeCycleLimitedItem(item), null);
});

test("manual retry preserves the uncertain timestamp and becomes queue-priority work", () => {
  const uncertain = { ...item, status: "attempted", attemptedAt: 123 };
  const retry = prepareManualRetry(uncertain, 456);
  assert.equal(retry.status, "pending");
  assert.equal(retry.attemptedAt, null);
  assert.equal(retry.lastUncertainAttemptAt, 123);
  assert.equal(retry.manualRetryAt, 456);
  assert.equal(prepareManualRetry(item), null);
});

test("only one exact matching active ChatGPT tab is accepted", () => {
  const target = { id: 7, url: "https://chatgpt.com/c/abc", active: true };
  const focusedWindow = { id: 7, focused: true };
  assert.equal(selectUniqueActiveTab([target], target.url, focusedWindow), target);
  assert.equal(selectUniqueActiveTab([target], target.url, { id: 7, focused: false }), null);
  assert.equal(selectUniqueActiveTab([target], target.url, { id: 8, focused: true }), null);
  assert.equal(selectUniqueActiveTab([{ ...target, active: false }], target.url, focusedWindow), null);
  assert.equal(selectUniqueActiveTab([{ ...target, url: target.url + "?x=1" }], target.url, focusedWindow), null);
  assert.equal(selectUniqueActiveTab([target, { ...target, id: 8 }], target.url, focusedWindow), null);
});

test("queue preflight accepts a present disabled Send control only with an empty composer", () => {
  const task = { ...item, targetUrl: "https://chatgpt.com/c/abc" };
  const snapshot = {
    url: task.targetUrl,
    busy: false,
    stopControlVisible: false,
    sendControlPresent: true,
    sendControlVisible: false,
    composerReady: true,
    composerEmpty: true,
  };
  assert.equal(decideQueueItem({ item: task, prompt: buildTaskPrompt(task), snapshot }).action, "submit");
  assert.equal(decideQueueItem({
    item: task,
    prompt: buildTaskPrompt(task),
    snapshot: { ...snapshot, sendControlPresent: false },
  }).reason, "ambiguous-ui");
  assert.equal(decideQueueItem({
    item: task,
    prompt: buildTaskPrompt(task),
    snapshot: { ...snapshot, composerEmpty: false },
  }).reason, "composer-not-empty");
  assert.equal(decideQueueItem({
    item: task,
    prompt: buildTaskPrompt(task),
    snapshot: { ...snapshot, busy: null },
  }).reason, "ambiguous-ui");
});

test("serial runner rejects overlapping ticks and releases after completion", async () => {
  const runExclusive = createSerialRunner();
  let release;
  let active = 0;
  let maximumActive = 0;
  const first = runExclusive(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => { release = resolve; });
    active -= 1;
    return "first-finished";
  });
  const overlapping = await runExclusive(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    active -= 1;
    return "should-not-run";
  });
  assert.equal(overlapping.skipped, true);
  assert.equal(overlapping.reason, "already-running");
  release();
  assert.equal(await first, "first-finished");
  assert.equal(maximumActive, 1);
  assert.equal(await runExclusive(async () => "next-tick"), "next-tick");
});
