import {
  allQueueCompleted,
  enqueueQueueItem,
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
} from "./logic.mjs";

const ALARM = "apollo-bulletin-hourly";
const DEFAULTS = {
  enabled: true,
  paused: false,
  maxCycles: 3,
  cycles: 0,
  cooldownMs: 60_000,
  queue: [],
  activity: []
};
let running = false;

async function getState() {
  const { state } = await chrome.storage.local.get("state");
  return { ...DEFAULTS, ...(state || {}) };
}

async function notifyCompletion(allDone) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.svg"),
      title: "Apollo Bulletin",
      message: allDone
        ? "All queued tasks are complete. The hourly resumer stopped."
        : "A queued task is complete. The remaining queue will continue."
    });
  } catch {}
}

async function notifyLimitReached() {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.svg"),
      title: "Apollo Bulletin",
      message: "A task reached its cycle limit. You can resume it or mark it complete in the queue."
    });
  } catch {}
}

async function save(state, event) {
  state.activity = [...(state.activity || []), { at: Date.now(), event }].slice(-200);
  await chrome.storage.local.set({ state });
  return state;
}

async function ensureAlarm() {
  const state = await getState();
  const next = nextQueueItem(state.queue);
  const runnable = next && (next.status === "active" || next.status === "pending");
  if (state.enabled && !state.paused && runnable) {
    chrome.alarms.create(ALARM, { periodInMinutes: 60 });
  } else {
    await chrome.alarms.clear(ALARM);
  }
}

async function targetTab(url) {
  const [matches, activeTabs] = await Promise.all([
    chrome.tabs.query({ url }),
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
  ]);
  return isUniqueActiveTarget(matches, activeTabs, url) ? matches[0] : null;
}

async function runOnce(manual = false) {
  if (running) return getState();
  running = true;
  let allowPausedManual = false;
  try {
    let state = await getState();
    allowPausedManual = manual && state.paused === true;
    if (!state.enabled || (state.paused && !manual)) {
      return save(state, "tick-skipped-paused");
    }

    const item = nextQueueItem(state.queue);
    if (!item) {
      await ensureAlarm();
      return save(state, "tick-skipped-empty-queue");
    }
    if (item.status === "attempted") {
      const saved = await save(state, "tick-skipped-uncertain-send-no-retry");
      await ensureAlarm();
      return saved;
    }

    const tab = await targetTab(item.targetUrl);
    if (!tab?.id || tab.url !== item.targetUrl) {
      return save(state, "tick-skipped-target-tab-missing-or-not-active");
    }

    let snapshot;
    try {
      snapshot = await chrome.tabs.sendMessage(tab.id, { type: "APOLLO_SNAPSHOT" });
    } catch {
      return save(state, "tick-skipped-content-script-unavailable");
    }
    if (!snapshot || snapshot.url !== item.targetUrl || snapshot.pageVisible !== true) {
      return save(state, "tick-skipped-conversation-mismatch-or-hidden-page");
    }

    if (isTaskComplete(item, snapshot)) {
      state.queue = state.queue.map(q => q.id === item.id
        ? { ...q, status: "completed", completedAt: Date.now(), completionDetected: true }
        : q);
      state.completed = allQueueCompleted(state.queue);
      if (state.completed) {
        state.enabled = false;
        state.paused = true;
      }
      const saved = await save(state, "task-completion-marker-detected");
      await notifyCompletion(state.completed);
      await ensureAlarm();
      return saved;
    }

    if (taskCycleLimitReached(item, state.maxCycles)) {
      if (item.status === "active") {
        state.queue = state.queue.map(q => q.id === item.id
          ? { ...q, status: "limit-reached", limitReachedAt: Date.now() }
          : q);
        const saved = await save(state, "task-cycle-limit-reached");
        await notifyLimitReached();
        await ensureAlarm();
        return saved;
      }
      return save(state, "tick-skipped-task-cycle-cap");
    }

    if (state.lastAttemptAt && Date.now() - state.lastAttemptAt < state.cooldownMs) {
      return save(state, "tick-skipped-cooldown");
    }

    if (snapshot.composerEmpty !== true) {
      return save(state, "tick-skipped-composer-has-existing-draft");
    }

    const prompt = buildTaskPrompt(item);
    const decision = decideQueueItem({ item, prompt, snapshot, now: Date.now() });
    if (decision.action !== "submit") {
      return save(state, "tick-skipped-guard:" + decision.reason);
    }

    // Re-check focus after the snapshot so a tab switch during inspection cannot receive a send.
    const stillActive = await targetTab(item.targetUrl);
    if (!stillActive || stillActive.id !== tab.id) {
      return save(state, "tick-skipped-target-tab-lost-focus-before-send");
    }

    // Re-read state before persisting intent so Pause/Stop/Complete actions made
    // during tab inspection are not overwritten by this tick's stale snapshot.
    state = await getState();
    const latestItem = state.queue.find(q => q.id === item.id);
    if (!state.enabled || (state.paused && !allowPausedManual) || latestItem?.status !== item.status) {
      return save(state, "tick-skipped-queue-state-changed-before-send");
    }

    const attemptAt = Date.now();
    state.queue = state.queue.map(q => q.id === item.id
      ? markQueueAttempted(q, prompt, attemptAt)
      : q);
    state.lastAttemptAt = attemptAt;
    state.lastAttemptId = item.id;
    state = await save(state, manual ? "manual-send-intent" : "scheduled-send-intent");

    // If the user paused, stopped, or completed the item while the intent was
    // being persisted, restore the prior phase before any browser click occurs.
    const beforeClick = await getState();
    const attemptedItem = beforeClick.queue.find(q => q.id === item.id);
    if (!beforeClick.enabled
        || (beforeClick.paused && !allowPausedManual)
        || attemptedItem?.status !== "attempted"
        || attemptedItem.attemptedAt !== attemptAt) {
      if (attemptedItem?.status === "attempted" && attemptedItem.attemptedAt === attemptAt) {
        beforeClick.queue = beforeClick.queue.map(q => q.id === item.id
          ? {
              ...q,
              status: q.resumeStatus === "active" ? "active" : "pending",
              resumeStatus: null,
              attemptedAt: null,
              attemptedPrompt: null
            }
          : q);
      }
      const saved = await save(beforeClick, "send-cancelled-before-click-state-changed");
      await ensureAlarm();
      return saved;
    }

    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "APOLLO_SUBMIT",
        prompt,
        targetUrl: item.targetUrl
      });
      state = await getState();
      const currentItem = state.queue.find(q => q.id === item.id);
      if (currentItem?.status !== "attempted" || currentItem.attemptedAt !== attemptAt) {
        const saved = await save(state, "send-result-ignored-queue-state-changed");
        await ensureAlarm();
        return saved;
      }
      state.queue = state.queue.map(q => q.id === item.id
        ? recordQueueAttempt(q, result?.clicked === true, Date.now())
        : q);
      if (result?.clicked === true) state.cycles = (state.cycles || 0) + 1;
      const saved = await save(state, result?.clicked === true
        ? "send-click-issued-task-active-not-delivery-confirmed"
        : "send-unconfirmed-no-retry");
      await ensureAlarm();
      return saved;
    } catch {
      const currentState = await getState();
      const saved = await save(currentState, "send-error-no-auto-retry");
      await ensureAlarm();
      return saved;
    }
  } finally {
    running = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ state: await getState() });
  await ensureAlarm();
});
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void runOnce(false);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message?.type === "APOLLO_GET_STATE") return getState();

    if (message?.type === "APOLLO_ENQUEUE") {
      const state = await getState();
      if (typeof message.prompt !== "string" || !message.prompt.trim()
          || !isConversationUrl(message.targetUrl)) {
        throw new Error("Prompt and exact conversation URL required");
      }
      const id = crypto.randomUUID();
      const token = "APOLLO_TASK_COMPLETE:" + id;
      const item = {
        id,
        prompt: message.prompt.trim(),
        targetUrl: message.targetUrl,
        completionToken: token,
        status: "pending",
        cycles: 0,
        createdAt: Date.now()
      };
      const saved = await save(enqueueQueueItem(state, item), "queue-item-added");
      await ensureAlarm();
      return saved;
    }

    if (message?.type === "APOLLO_PAUSE") {
      const state = await getState();
      const result = await save({ ...state, paused: true }, "paused");
      await ensureAlarm();
      return result;
    }

    if (message?.type === "APOLLO_RESUME") {
      const state = await getState();
      const result = await save({ ...state, paused: false, enabled: true }, "resumed");
      await ensureAlarm();
      return result;
    }

    if (message?.type === "APOLLO_STOP") {
      const state = await getState();
      const result = await save({ ...state, enabled: false, paused: true }, "stopped");
      await ensureAlarm();
      return result;
    }

    if (message?.type === "APOLLO_SET_MAX_CYCLES") {
      const maxCycles = Number(message.maxCycles);
      if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100) {
        throw new Error("Max cycles must be 1–100");
      }
      return save({ ...await getState(), maxCycles }, "max-cycles-updated");
    }

    if (message?.type === "APOLLO_RUN_NOW") return runOnce(true);

    if (message?.type === "APOLLO_REQUEUE") {
      const state = await getState();
      let event = "queue-item-retry-noop";
      state.queue = state.queue.map(q => {
        if (q.id !== message.id) return q;
        if (q.status === "attempted") {
          event = "uncertain-send-retry-explicitly-authorized";
          return retryAttemptedItem(q);
        }
        if (q.status === "limit-reached") {
          event = "cycle-limit-resume-with-fresh-budget";
          return resumeLimitedItem(q);
        }
        return q;
      });
      const saved = await save(state, event);
      await ensureAlarm();
      return saved;
    }

    if (message?.type === "APOLLO_COMPLETE") {
      const state = await getState();
      state.queue = state.queue.map(q => q.id === message.id
        ? { ...q, status: "completed", completedAt: Date.now(), completionDetected: false }
        : q);
      state.completed = allQueueCompleted(state.queue);
      if (state.completed) {
        state.enabled = false;
        state.paused = true;
      }
      const saved = await save(state, "queue-item-completed");
      await notifyCompletion(state.completed);
      await ensureAlarm();
      return saved;
    }
  })().then(respond).catch(error => respond({ error: error.message || "Action failed" }));
  return true;
});
