import { decideResume } from "../guard.mjs";

export const INITIAL_PROMPT_SUFFIX = "\n\nMaintain a concise TODO/checkpoint and record each meaningful change. Continue making concrete progress between cycles. Only when every requirement is finished, output this exact task-specific marker on its own line: ";
export const CONTINUATION_PREFIX = "Continue working on the task above from your saved checkpoint. Review what remains in the TODO/checklist, do the next concrete step, update the checkpoint, and do not claim completion unless all requirements are finished. If finished, output the task-specific completion marker on its own line: ";

export function nextQueueItem(queue = []) {
  if (!Array.isArray(queue)) return null;
  // An uncertain send blocks the whole queue until the owner explicitly retries or completes it.
  if (queue.some(item => item?.status === "attempted")) return null;

  const active = queue.filter(item => item?.status === "active");
  if (active.length > 1) return null;
  if (active.length === 1) return active[0];

  // An owner-confirmed retry takes priority over ordinary pending work.
  return queue.find(item => item?.status === "pending" && Number.isFinite(item.manualRetryAt))
    || queue.find(item => item?.status === "pending")
    || null;
}

export function buildTaskPrompt(item) {
  return item.status === "active"
    ? CONTINUATION_PREFIX + item.completionToken
    : item.prompt + INITIAL_PROMPT_SUFFIX + item.completionToken;
}

export function isTaskComplete(item, snapshot) {
  if (item?.status !== "active" || typeof item.completionToken !== "string" ||
      snapshot?.busy !== false || typeof snapshot.assistantText !== "string") return false;
  const marker = item.completionToken.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
  return new RegExp("(?:^|\\r?\\n)" + marker + "(?:\\r?\\n|$)").test(snapshot.assistantText);
}

export function taskCycleLimitReached(item, maxCycles) {
  return (Number.isInteger(item?.cycles) ? item.cycles : 0) >= maxCycles;
}

export function allQueueCompleted(queue = []) {
  return Array.isArray(queue) && queue.length > 0 && queue.every(item => item.status === "completed");
}

export function isConversationUrl(value) {
  return typeof value === "string" && /^https:\/\/chatgpt\\.com\/c\/[A-Za-z0-9-]+$/.test(value);
}

export function selectUniqueActiveTab(matches, expectedUrl) {
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const tab = matches[0];
  return tab?.active === true && tab.url === expectedUrl ? tab : null;
}

export function createSerialRunner() {
  let running = false;
  return async function runExclusive(operation) {
    if (running) return { skipped: true, reason: "already-running" };
    running = true;
    try {
      return await operation();
    } finally {
      running = false;
    }
  };
}

export function decideQueueItem({ item, prompt, snapshot, now = Date.now() }) {
  if (snapshot?.composerEmpty !== true) return { action: "noop", reason: "composer-not-empty" };
  // Before filling, ChatGPT normally disables Send because the composer is empty.
  // Require a visible Send control to exist here; content.js verifies it is enabled after fill.
  const preflightSnapshot = {
    ...snapshot,
    sendControlVisible: snapshot.sendControlPresent === true,
  };
  return decideResume({
    state: {
      enabled: true,
      paused: false,
      completed: false,
      cycles: 0,
      maxCycles: 100,
      targetConversationUrl: item.targetUrl,
      pendingPrompt: prompt,
      pendingPromptHash: item.id + ":" + (item.cycles || 0),
      lastSubmittedPromptHash: null,
      lastSubmittedAt: null,
    },
    snapshot: preflightSnapshot,
    now,
    cooldownMs: 0,
  });
}
