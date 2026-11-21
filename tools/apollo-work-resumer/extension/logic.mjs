import { decideResume } from "../guard.mjs";
export const INITIAL_PROMPT_SUFFIX = "\n\nMaintain a concise TODO/checkpoint and record each meaningful change. Continue making concrete progress between cycles. Only when every requirement is finished, output this exact task-specific marker on its own line: ";
export const CONTINUATION_PREFIX = "Continue working on the task above from your saved checkpoint. Review what remains in the TODO/checklist, do the next concrete step, update the checkpoint, and do not claim completion unless all requirements are finished. If finished, output the task-specific completion marker on its own line: ";
export function nextQueueItem(queue = []) { return queue.find(q => q.status === "active") || queue.find(q => q.status === "pending") || null; }
export function buildTaskPrompt(item) { return item.status === "active" ? CONTINUATION_PREFIX + item.completionToken : item.prompt + INITIAL_PROMPT_SUFFIX + item.completionToken; }
export function isTaskComplete(item, snapshot) { return item?.status === "active" && typeof item.completionToken === "string" && snapshot?.busy === false && typeof snapshot.assistantText === "string" && snapshot.assistantText.includes(item.completionToken); }
export function taskCycleLimitReached(item, maxCycles) { return (Number.isInteger(item?.cycles) ? item.cycles : 0) >= maxCycles; }

export function allQueueCompleted(queue = []) { return queue.length > 0 && queue.every(q => q.status === "completed"); }
export function isConversationUrl(value) { return typeof value === "string" && /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/.test(value); }

export function decideQueueItem({ item, prompt, snapshot, now = Date.now() }) {
  return decideResume({ state: { enabled: true, paused: false, completed: false, cycles: 0, maxCycles: 100,
    targetConversationUrl: item.targetUrl, pendingPrompt: prompt, pendingPromptHash: item.id + ":" + (item.cycles || 0),
    lastSubmittedPromptHash: null, lastSubmittedAt: null }, snapshot, now, cooldownMs: 0 });
}
