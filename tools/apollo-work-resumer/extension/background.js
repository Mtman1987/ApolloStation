import { allQueueCompleted, buildTaskPrompt, decideQueueItem, isConversationUrl, isTaskComplete, nextQueueItem, taskCycleLimitReached } from "./logic.mjs";
const ALARM = "apollo-bulletin-hourly";
const GITHUB_BRIDGE_URL = "https://github.com/Mtman1987/ApolloStation/pull/553";
const GITHUB_BRIDGE_PATTERN = GITHUB_BRIDGE_URL + "*";
const DEFAULTS = { enabled: true, paused: false, maxCycles: 3, cycles: 0, cooldownMs: 60_000, queue: [], activity: [], processedCommandIds: [] };
let running = false;

async function getState() {
  const { state } = await chrome.storage.local.get("state");
  return { ...DEFAULTS, ...(state || {}) };
}
async function notifyCompletion(allDone) {
  try { await chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icon.svg"), title: "Apollo Bulletin", message: allDone ? "All queued tasks are complete. The hourly resumer stopped." : "A queued task is complete. The remaining queue will continue." }); } catch {}
}
async function notifyLimitReached() {
  try { await chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icon.svg"), title: "Apollo Bulletin", message: "A task reached its cycle limit. You can resume it or mark it complete in the queue." }); } catch {}
}
async function save(state, event) {
  state.activity = [...(state.activity || []), { at: Date.now(), event }].slice(-200);
  await chrome.storage.local.set({ state });
  return state;
}
async function ensureAlarm() {
  const state = await getState();
  if (state.enabled && !state.paused) chrome.alarms.create(ALARM, { periodInMinutes: 60 });
  else await chrome.alarms.clear(ALARM);
}
async function ensureGitHubBridgeTab({ reloadExisting = false } = {}) {
  const matches = await chrome.tabs.query({ url: GITHUB_BRIDGE_PATTERN });
  if (!matches.length) await chrome.tabs.create({ url: GITHUB_BRIDGE_URL, active: false });
  else if (reloadExisting && matches[0].id) await chrome.tabs.reload(matches[0].id);
}
async function targetTab(url) {
  const matches = await chrome.tabs.query({ url });
  return matches.length === 1 ? matches[0] : null;
}

async function runOnce(manual = false) {
  if (running) return save(await getState(), "tick-skipped-already-running");
  running = true;
  try {
    let state = await getState();
    if (!state.enabled || (state.paused && !manual)) return save(state, "tick-skipped-paused");
    const item = nextQueueItem(state.queue);
    if (!item) return save(state, "tick-skipped-empty-queue");
    if (item.status === "attempted") return save(state, "tick-skipped-uncertain-send-no-retry");

    const tab = await targetTab(item.targetUrl);
    if (!tab?.id || tab.url !== item.targetUrl) return save(state, "tick-skipped-target-tab-missing-or-ambiguous");
    let snapshot;
    try { snapshot = await chrome.tabs.sendMessage(tab.id, { type: "APOLLO_SNAPSHOT" }); }
    catch { return save(state, "tick-skipped-content-script-unavailable"); }
    if (!snapshot || snapshot.url !== item.targetUrl) return save(state, "tick-skipped-conversation-mismatch");

    if (isTaskComplete(item, snapshot)) {
      state.queue = state.queue.map(q => q.id === item.id
        ? { ...q, status: "completed", completedAt: Date.now(), completionDetected: true }
        : q);
      state.completed = allQueueCompleted(state.queue);
      if (state.completed) { state.enabled = false; state.paused = true; }
      const saved = await save(state, "task-completion-marker-detected");
      await notifyCompletion(state.completed);
      if (state.completed) await ensureAlarm();
      return saved;
    }
    if (taskCycleLimitReached(item, state.maxCycles)) {
      if (item.status === "active") {
        state.queue = state.queue.map(q => q.id === item.id ? { ...q, status: "limit-reached", limitReachedAt: Date.now() } : q);
        const saved = await save(state, "task-cycle-limit-reached");
        await notifyLimitReached();
        return saved;
      }
      return save(state, "tick-skipped-task-cycle-cap");
    }
    if (state.lastAttemptAt && Date.now() - state.lastAttemptAt < state.cooldownMs) {
      return save(state, "tick-skipped-cooldown");
    }

    const prompt = buildTaskPrompt(item);
    const decision = decideQueueItem({ item, prompt, snapshot, now: Date.now() });
    if (decision.action !== "submit") return save(state, "tick-skipped-guard:" + decision.reason);
    state.queue = state.queue.map(q => q.id === item.id ? { ...q, status: "attempted", attemptedAt: Date.now() } : q);
    state.lastAttemptAt = Date.now();
    state.lastAttemptId = item.id;
    state = await save(state, manual ? "manual-send-intent" : "scheduled-send-intent");

    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: "APOLLO_SUBMIT", prompt, targetUrl: item.targetUrl });
      state = await getState();
      state.queue = state.queue.map(q => q.id === item.id ? {
        ...q,
        status: result?.clicked === true ? "active" : "attempted",
        clickResult: result?.clicked === true ? "click-issued" : "unconfirmed",
        cycles: (q.cycles || 0) + (result?.clicked === true ? 1 : 0),
        lastAttemptAt: Date.now(),
      } : q);
      if (result?.clicked === true) state.cycles = (state.cycles || 0) + 1;
      return save(state, result?.clicked === true
        ? "send-click-issued-task-active-not-delivery-confirmed"
        : "send-unconfirmed-no-retry");
    } catch {
      return save(await getState(), "send-error-no-auto-retry");
    }
  } finally {
    running = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ state: await getState() });
  await ensureAlarm();
  await ensureGitHubBridgeTab({ reloadExisting: true });
});
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); void ensureGitHubBridgeTab(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void runOnce(false); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message?.type === "APOLLO_GET_STATE") return getState();
    if (message?.type === "APOLLO_GITHUB_COMMAND") {
      if (!sender.url?.startsWith(GITHUB_BRIDGE_URL)) throw new Error("GitHub command source is not trusted");
      const command = message.command || {};
      if (typeof command.id !== "string" || command.id.length > 100 ||
          typeof command.prompt !== "string" || !command.prompt.trim() || command.prompt.length > 6000 ||
          !isConversationUrl(command.conversationUrl)) {
        throw new Error("GitHub command is malformed or targets a non-conversation URL");
      }
      const state = await getState();
      if (state.processedCommandIds.includes(command.id)) return { duplicate: true };
      if (state.queue.some(q => ["pending", "active", "attempted", "limit-reached"].includes(q.status))) {
        throw new Error("Local queue is not empty; clear or complete the existing task before dispatching another proof command");
      }
      const item = {
        id: "github-" + command.id,
        prompt: command.prompt.trim(),
        targetUrl: command.conversationUrl,
        completionToken: "APOLLO_TASK_COMPLETE:github-" + command.id,
        status: "pending",
        cycles: 0,
        createdAt: Date.now(),
        source: "github-actions",
      };
      state.processedCommandIds = [...state.processedCommandIds, command.id].slice(-100);
      state.completed = false;
      state.queue = [...state.queue, item];
      await save(state, "github-actions-command-received");
      await runOnce(true);
      return { queued: true, id: item.id };
    }
    if (message?.type === "APOLLO_ENQUEUE") {
      const state = await getState();
      if (typeof message.prompt !== "string" || !message.prompt.trim() ||
          !isConversationUrl(message.targetUrl)) {
        throw new Error("Prompt and exact conversation URL required");
      }
      const id = crypto.randomUUID();
      const token = "APOLLO_TASK_COMPLETE:" + id;
      const item = { id, prompt: message.prompt.trim(), targetUrl: message.targetUrl,
        completionToken: token, status: "pending", cycles: 0, createdAt: Date.now() };
      return save({ ...state, completed: false, queue: [...state.queue, item] }, "queue-item-added");
    }
    if (message?.type === "APOLLO_PAUSE") {
      const state = await getState(), result = await save({ ...state, paused: true }, "paused");
      await ensureAlarm(); return result;
    }
    if (message?.type === "APOLLO_RESUME") {
      const state = await getState(), result = await save({ ...state, paused: false, enabled: true }, "resumed");
      await ensureAlarm(); return result;
    }
    if (message?.type === "APOLLO_STOP") {
      const state = await getState(), result = await save({ ...state, enabled: false, paused: true }, "stopped");
      await ensureAlarm(); return result;
    }
    if (message?.type === "APOLLO_SET_MAX_CYCLES") {
      const maxCycles = Number(message.maxCycles);
      if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100) throw new Error("Max cycles must be 1–100");
      return save({ ...await getState(), maxCycles }, "max-cycles-updated");
    }
    if (message?.type === "APOLLO_RUN_NOW") return runOnce(true);
    if (message?.type === "APOLLO_REQUEUE") {
      const state = await getState();
      state.queue = state.queue.map(q => q.id === message.id && q.status === "limit-reached" ? { ...q, status: "active", resumedAt: Date.now() } : q);
      state.queue = state.queue.map(q => q.id === message.id && q.status === "attempted" ? { ...q, status: "pending", manualRetryAt: Date.now(), attemptedAt: null } : q);
      return save(state, "task-resumed-after-cycle-limit");
    }
    if (message?.type === "APOLLO_COMPLETE") {
      const state = await getState();
      state.queue = state.queue.map(q => q.id === message.id
        ? { ...q, status: "completed", completedAt: Date.now(), completionDetected: false }
        : q);
      state.completed = allQueueCompleted(state.queue);
      if (state.completed) { state.enabled = false; state.paused = true; }
      const saved = await save(state, "queue-item-completed");
      await notifyCompletion(state.completed);
      if (state.completed) await ensureAlarm();
      return saved;
    }
  })().then(respond).catch(error => respond({ error: error.message || "Action failed" }));
  return true;
});
