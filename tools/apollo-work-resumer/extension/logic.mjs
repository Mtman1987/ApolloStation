import { decideResume } from "../guard.mjs";

export const INITIAL_PROMPT_SUFFIX = "\n\nMaintain a concise TODO/checkpoint and record each meaningful change. Continue making concrete progress between cycles. Only when every requirement is finished, output this exact task-specific marker on its own line: ";
export const CONTINUATION_PREFIX = "Continue working on the task above from your saved checkpoint. Review what remains in the TODO/checklist, do the next concrete step, update the checkpoint, and do not claim completion unless all requirements are finished. If finished, output the task-specific completion marker on its own line: ";

export function nextQueueItem(queue = []) {
  return queue.find(q => q.status === "attempted")
    || queue.find(q => q.status === "active")
    || queue.find(q => q.status === "pending")
    || null;
}

export function buildTaskPrompt(item) {
  return item.status === "active"
    ? CONTINUATION_PREFIX + item.completionToken
    : item.prompt + INITIAL_PROMPT_SUFFIX + item.completionToken;
}

export function isTaskComplete(item, snapshot) {
  return item?.status === "active"
    && typeof item.completionToken === "string"
    && snapshot?.busy === false
    && typeof snapshot.assistantText === "string"
    && snapshot.assistantText.split(/\r?\n/).some(line => line.trim() === item.completionToken);
}

export function taskCycleLimitReached(item, maxCycles) {
  return (Number.isInteger(item?.cycles) ? item.cycles : 0) >= maxCycles;
}

export function allQueueCompleted(queue = []) {
  return queue.length > 0 && queue.every(q => q.status === "completed");
}

export function enqueueQueueItem(state, item) {
  const reactivatingCompletedQueue = state?.completed === true;
  return {
    ...state,
    ...(reactivatingCompletedQueue ? { enabled: true, paused: false } : {}),
    completed: false,
    queue: [...(state?.queue || []), item]
  };
}

export function isConversationUrl(value) {
  return typeof value === "string"
    && /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/.test(value);
}

export function isUniqueActiveTarget(matches = [], activeTabs = [], expectedUrl) {
  if (!Array.isArray(matches) || !Array.isArray(activeTabs)
      || matches.length !== 1 || activeTabs.length !== 1) return false;
  const target = matches[0];
  const active = activeTabs[0];
  return Number.isInteger(target?.id)
    && target.id === active?.id
    && target.url === expectedUrl
    && active.url === expectedUrl;
}

export function markQueueAttempted(item, prompt, now = Date.now()) {
  return {
    ...item,
    status: "attempted",
    resumeStatus: item.status === "active" ? "active" : "pending",
    attemptedAt: now,
    attemptedPrompt: prompt
  };
}

export function recordQueueAttempt(item, clicked, now = Date.now()) {
  if (clicked === true) {
    return {
      ...item,
      status: "active",
      clickResult: "click-issued",
      cycles: (item.cycles || 0) + 1,
      lastAttemptAt: now,
      resumeStatus: null,
      attemptedAt: null,
      attemptedPrompt: null
    };
  }
  return {
    ...item,
    status: "attempted",
    clickResult: "unconfirmed",
    lastAttemptAt: now
  };
}

export function retryAttemptedItem(item, now = Date.now()) {
  if (item?.status !== "attempted") return item;
  return {
    ...item,
    status: item.resumeStatus === "active" ? "active" : "pending",
    lastUncertainAttemptAt: item.attemptedAt ?? item.lastUncertainAttemptAt,
    manualRetryAt: now,
    clickResult: "manual-retry-authorized",
    resumeStatus: null,
    attemptedAt: null,
    attemptedPrompt: null
  };
}

export function resumeLimitedItem(item, now = Date.now()) {
  if (item?.status !== "limit-reached") return item;
  return {
    ...item,
    status: "active",
    priorCycles: (item.priorCycles || 0) + (item.cycles || 0),
    cycles: 0,
    resumedAt: now
  };
}

export function decideQueueItem({ item, prompt, snapshot, now = Date.now() }) {
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
      lastSubmittedAt: null
    },
    snapshot,
    now,
    cooldownMs: 0
  });
}
