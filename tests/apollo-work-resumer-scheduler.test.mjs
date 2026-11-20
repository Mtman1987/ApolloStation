import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkResumerScheduler } from "../tools/apollo-work-resumer/scheduler.mjs";
import { enqueue } from "../tools/apollo-work-resumer/queue.mjs";
import { DEFAULT_STATE, loadState } from "../tools/apollo-work-resumer/state-store.mjs";

test("manual tick submits pending queue only after adapter confirms and persists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apollo-scheduler-"));
  try {
    const file = join(dir, "state.json");
    const state = enqueue({ ...structuredClone(DEFAULT_STATE), queue: [], activityLog: [] }, { id: "q1", prompt: "Do work", targetConversationUrl: "https://chatgpt.com/c/abc" }, 1);
    const scheduler = new WorkResumerScheduler({ state, statePath: file, now: () => 100_000, adapter: {
      snapshot: async () => ({ url: "https://chatgpt.com/c/abc", busy: false, stopControlVisible: false, sendControlVisible: true, composerReady: true }),
      submit: async () => ({ submitted: true }),
    }});
    const result = await scheduler.tick({ manual: true });
    assert.equal(result.reason, "submitted-confirmed");
    const saved = await loadState(file);
    assert.equal(saved.queue[0].status, "submitted");
    assert.equal(saved.cycles, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("scheduler never submits if UI snapshot is ambiguous", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apollo-scheduler-"));
  try {
    const file = join(dir, "state.json");
    const state = enqueue({ ...structuredClone(DEFAULT_STATE), queue: [], activityLog: [] }, { id: "q1", prompt: "Do work", targetConversationUrl: "https://chatgpt.com/c/abc" }, 1);
    let submits = 0;
    const scheduler = new WorkResumerScheduler({ state, statePath: file, adapter: {
      snapshot: async () => ({ url: "https://chatgpt.com/c/abc", busy: null, stopControlVisible: false, sendControlVisible: false, composerReady: true }),
      submit: async () => { submits++; return { submitted: true }; },
    }});
    const result = await scheduler.tick();
    assert.equal(result.action, "noop");
    assert.equal(submits, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
