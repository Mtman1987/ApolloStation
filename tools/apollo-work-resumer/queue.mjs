import { createHash, randomUUID } from "node:crypto";
import { appendActivity } from "./state-store.mjs";

export function promptHash(prompt) {
  return createHash("sha256").update(String(prompt).trim()).digest("hex");
}

export function enqueue(state, { prompt, targetConversationUrl, id = randomUUID() }, now = Date.now()) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Queue prompt must be non-empty");
  if (typeof targetConversationUrl !== "string" || !targetConversationUrl.startsWith("https://chatgpt.com/c/")) {
    throw new Error("Queue target must be an exact ChatGPT conversation URL");
  }
  const item = { id, prompt: prompt.trim(), promptHash: promptHash(prompt), targetConversationUrl, status: "pending", createdAt: now, completedAt: null };
  return appendActivity({ ...state, completed: false, queue: [...(state.queue ?? []), item] }, "queue-item-added", now);
}

export function completeQueueItem(state, id, now = Date.now()) {
  let found = false;
  const queue = (state.queue ?? []).map(item => {
    if (item.id !== id) return item;
    found = true;
    return { ...item, status: "completed", completedAt: now };
  });
  if (!found) throw new Error("Queue item not found");
  const completed = queue.every(item => item.status === "completed");
  return appendActivity({ ...state, queue, completed }, "queue-item-completed", now);
}

export function nextPending(state) {
  return (state.queue ?? []).find(item => item.status === "pending") ?? null;
}
