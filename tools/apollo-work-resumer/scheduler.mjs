import { decideResume } from "./guard.mjs";
import { appendActivity, markSubmitted, saveState } from "./state-store.mjs";
import { nextPending } from "./queue.mjs";

export class WorkResumerScheduler {
  constructor({ state, statePath, adapter, intervalMs = 60 * 60 * 1000, now = () => Date.now() }) {
    if (!statePath || !adapter?.snapshot || !adapter?.submit) throw new Error("statePath and browser adapter are required");
    this.state = state;
    this.statePath = statePath;
    this.adapter = adapter;
    this.intervalMs = intervalMs;
    this.now = now;
    this.timer = null;
    this.running = false;
  }
  async persist(event) {
    this.state = appendActivity(this.state, event, this.now());
    await saveState(this.statePath, this.state);
  }
  async tick({ manual = false } = {}) {
    if (this.running) return { action: "noop", reason: "tick-already-running" };
    this.running = true;
    try {
      const item = nextPending(this.state);
      if (!item) {
        this.state = { ...this.state, completed: (this.state.queue ?? []).length > 0 };
        await this.persist("queue-empty");
        return { action: "noop", reason: "queue-empty" };
      }
      const snapshot = await this.adapter.snapshot();
      const derived = { ...this.state, pendingPrompt: item.prompt, pendingPromptHash: item.promptHash, targetConversationUrl: item.targetConversationUrl };
      const decision = decideResume({ state: derived, snapshot, now: this.now(), cooldownMs: this.state.cooldownMs });
      if (decision.action !== "submit") {
        await this.persist(`tick-skipped:${decision.reason}`);
        return decision;
      }
      // Persist intent before interacting; if the process crashes, it will not blindly resend.
      this.state = appendActivity({ ...this.state, lastAttemptPromptHash: item.promptHash, lastAttemptAt: this.now() }, manual ? "manual-submit-intent" : "scheduled-submit-intent", this.now());
      await saveState(this.statePath, this.state);
      const result = await this.adapter.submit({ prompt: item.prompt, conversationUrl: item.targetConversationUrl, queueItemId: item.id });
      if (result?.submitted !== true) {
        await this.persist("submit-not-confirmed");
        return { action: "noop", reason: "submit-not-confirmed" };
      }
      this.state = markSubmitted(this.state, item.promptHash, this.now());
      this.state = { ...this.state, queue: this.state.queue.map(q => q.id === item.id ? { ...q, status: "submitted", submittedAt: this.now() } : q) };
      await saveState(this.statePath, this.state);
      return { action: "submit", reason: "submitted-confirmed", queueItemId: item.id };
    } finally {
      this.running = false;
    }
  }
  start() {
    if (this.timer || this.state.paused || this.state.enabled === false) return false;
    this.timer = setInterval(() => { void this.tick().catch(async () => { await this.persist("scheduler-error"); }); }, this.intervalMs);
    return true;
  }
  async pause() {
    this.state = { ...this.state, paused: true };
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.persist("scheduler-paused");
  }
  async resume() {
    this.state = { ...this.state, paused: false, enabled: true };
    await this.persist("scheduler-resumed");
    this.start();
  }
  async stop() {
    this.state = { ...this.state, enabled: false, paused: true };
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.persist("scheduler-stopped");
  }
}
