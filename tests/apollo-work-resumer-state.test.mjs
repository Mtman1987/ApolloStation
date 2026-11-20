import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, markSubmitted, appendActivity } from "../tools/apollo-work-resumer/state-store.mjs";

test("load returns default state for absent checkpoint and persists state atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apollo-resumer-"));
  try {
    const file = join(dir, "state.json");
    const initial = await loadState(file);
    assert.equal(initial.enabled, true);
    const changed = appendActivity({ ...initial, pendingPrompt: "Resume" }, "manual-run", 10);
    await saveState(file, changed);
    assert.equal((await loadState(file)).pendingPrompt, "Resume");
    assert.ok((await readFile(file, "utf8")).includes("manual-run"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("markSubmitted increments cycle and stores duplicate guard metadata", () => {
  const result = markSubmitted({ cycles: 1, activityLog: [] }, "abc", 42);
  assert.equal(result.cycles, 2);
  assert.equal(result.lastSubmittedPromptHash, "abc");
  assert.equal(result.lastSubmittedAt, 42);
  assert.equal(result.activityLog.at(-1).event, "prompt-submitted");
});
