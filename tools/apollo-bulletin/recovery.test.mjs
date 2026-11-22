import test from "node:test";
import assert from "node:assert/strict";
import { createBulletinServer } from "./server.mjs";

test("restart converts persisted dispatching tasks to uncertain and never auto-resends", async () => {
  const previousCron = process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;
  const previousBrowser = process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  const previousRequireTurso = process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  let persisted = {
    tasks: [{
      id: "crash-window-task", name: "Crash-window task", prompt: "Never resend this",
      destination: "chatgpt", status: "dispatching", nextRunAt: null, lastDispatchAt: Date.now(),
      schedule: { type: "manual" },
    }],
    activity: [],
  };
  let dispatchCalls = 0;
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ port: 0, store, dispatch: async () => { dispatchCalls++; return { submitted: true, receipt: { reply: "sent" } }; } });
  try {
    const address = await app.listen(), origin = "http://127.0.0.1:" + address.port;
    const data = await (await fetch(origin + "/api/tasks")).json();
    assert.equal(data.tasks[0].status, "dispatch-uncertain");
    assert.equal(data.tasks[0].nextRunAt, null);
    assert.match(data.tasks[0].lastEvent, /outcome is unknown/);
    assert.ok(data.activity.some(item => item.event === "dispatch-interrupted-restart-no-retry" && item.taskId === "crash-window-task"));
    assert.equal(persisted.tasks[0].status, "dispatch-uncertain");
    const run = await fetch(origin + "/api/tasks/crash-window-task/run", { method: "POST" });
    assert.equal(run.status, 409);
    await run.text();
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(dispatchCalls, 0);
  } finally {
    await app.close();
    if (previousCron === undefined) delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON; else process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = previousCron;
    if (previousBrowser === undefined) delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER; else process.env.APOLLO_BULLETIN_ENABLE_BROWSER = previousBrowser;
    if (previousRequireTurso === undefined) delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO; else process.env.APOLLO_BULLETIN_REQUIRE_TURSO = previousRequireTurso;
  }
});
