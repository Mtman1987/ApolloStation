import test from "node:test";
import assert from "node:assert/strict";
import { ApolloChatGptBrowserWorker } from "../tools/apollo-bulletin/browser-worker.mjs";

test("a missing browser page before dispatch does not strand the worker busy lock", async () => {
  const worker = new ApolloChatGptBrowserWorker();
  const task = { prompt:"Continue the saved task", conversationUrl:"https://chatgpt.com/c/lock-recovery" };
  const first = await worker.sendTask(task);
  assert.equal(first.submitted,false);
  assert.match(first.reason,/^browser-dispatch-blocked: Dedicated ChatGPT browser is not started/);
  assert.equal(worker.busy,false);
  const second = await worker.sendTask(task);
  assert.equal(second.submitted,false);
  assert.equal(worker.busy,false);
});
