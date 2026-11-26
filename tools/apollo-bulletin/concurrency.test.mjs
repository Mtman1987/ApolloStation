import test from "node:test";
import assert from "node:assert/strict";
import { createBulletinServer } from "./server.mjs";

test("two Bulletin instances share an exclusive dispatch lease and refresh queue state before the next tick", async () => {
  const keys = ["APOLLO_BULLETIN_USE_HOSTLESS_CRON", "APOLLO_BULLETIN_ENABLE_BROWSER", "APOLLO_BULLETIN_REQUIRE_TURSO", "APOLLO_BULLETIN_CRON_TOKEN"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "test-cron-token";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;

  const leases = new Map();
  let persisted = {
    tasks: [{
      id: "shared-due-task",
      name: "Shared due task",
      prompt: "Send exactly once",
      destination: "test-simulator",
      status: "scheduled",
      nextRunAt: Date.now() - 1_000,
      schedule: { type: "manual" },
      createdAt: Date.now() - 2_000,
    }],
    activity: [],
  };
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
    async ping() { return true; },
    async acquireLease(key, ownerId, at, ttlMs) {
      const current = leases.get(key);
      if (current && current.expiresAt > at && current.ownerId !== ownerId) return false;
      leases.set(key, { ownerId, expiresAt: at + ttlMs });
      return true;
    },
    async releaseLease(key, ownerId) {
      const current = leases.get(key);
      if (!current || current.ownerId !== ownerId) return false;
      leases.set(key, { ...current, expiresAt: 0 });
      return true;
    },
  };
  let dispatchCalls = 0;
  const dispatch = async () => {
    dispatchCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 120));
    return { submitted: true, receipt: { reply: "delivered" }, reason: "test receipt" };
  };
  const first = createBulletinServer({ port: 0, store, dispatch });
  const second = createBulletinServer({ port: 0, store, dispatch });

  try {
    const firstAddress = await first.listen();
    const secondAddress = await second.listen();
    const firstOrigin = "http://127.0.0.1:" + firstAddress.port;
    const secondOrigin = "http://127.0.0.1:" + secondAddress.port;
    const wake = origin => fetch(origin + "/api/cron/tick", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-token" },
    });
    const [firstWake, secondWake] = await Promise.all([wake(firstOrigin), wake(secondOrigin)]);
    assert.equal(firstWake.status, 202);
    assert.equal(secondWake.status, 202);

    for (let attempt = 0; attempt < 100 && persisted.tasks[0].status !== "dispatched"; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(persisted.tasks[0].status, "dispatched");
    assert.equal(dispatchCalls, 1);

    const nextWake = await wake(secondOrigin);
    assert.equal(nextWake.status, 202);
    for (let attempt = 0; attempt < 100 && persisted.cron?.completedTicks < 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(persisted.cron.completedTicks, 2);
    assert.equal(persisted.tasks[0].status, "dispatched");
    assert.equal(dispatchCalls, 1, "a stale second process must reload the completed task instead of sending it again");
  } finally {
    await Promise.all([first.close(), second.close()]);
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("API queue writes cannot overwrite another instance's active dispatch state", async () => {
  const keys = ["APOLLO_BULLETIN_USE_HOSTLESS_CRON", "APOLLO_BULLETIN_CRON_TOKEN", "APOLLO_BULLETIN_ENABLE_BROWSER", "APOLLO_BULLETIN_REQUIRE_TURSO"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "queue-lease-test-token";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  process.env.APOLLO_BULLETIN_REQUIRE_TURSO = "1";
  const leases = new Map();
  let persisted = {
    tasks: [{ id: "leased-task", name: "Leased task", prompt: "Send once", destination: "test-simulator", status: "scheduled", nextRunAt: Date.now() - 1_000, schedule: { type: "manual" } }],
    activity: [],
  };
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
    async ping() { return true; },
    async acquireLease(key, ownerId, at, ttlMs) {
      const current = leases.get(key);
      if (current && current.expiresAt > at && current.ownerId !== ownerId) return false;
      leases.set(key, { ownerId, expiresAt: at + ttlMs });
      return true;
    },
    async releaseLease(key, ownerId) {
      const current = leases.get(key);
      if (!current || current.ownerId !== ownerId) return false;
      leases.set(key, { ...current, expiresAt: 0 });
      return true;
    },
  };
  let releaseDispatch;
  let dispatchEntered = false;
  const dispatchGate = new Promise(resolve => { releaseDispatch = resolve; });
  const dispatch = async () => { dispatchEntered = true; await dispatchGate; return { submitted: true, receipt: { reply: "delivered" } }; };
  const first = createBulletinServer({ port: 0, store, dispatch });
  const second = createBulletinServer({ port: 0, store, dispatch });
  try {
    const firstAddress = await first.listen();
    const secondAddress = await second.listen();
    const firstOrigin = "http://127.0.0.1:" + firstAddress.port;
    const secondOrigin = "http://127.0.0.1:" + secondAddress.port;
    const wake = await fetch(firstOrigin + "/api/cron/tick", { method: "POST", headers: { authorization: "Bearer queue-lease-test-token" } });
    assert.equal(wake.status, 202);
    for (let attempt = 0; attempt < 50 && !dispatchEntered; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(dispatchEntered, true);
    const body = { name: "Do not lose me", prompt: "Persist this task", destination: "test-simulator", scheduleType: "manual" };
    const blocked = await fetch(secondOrigin + "/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(blocked.status, 503);
    await blocked.text();
    assert.equal(persisted.tasks.length, 1);
    assert.equal(persisted.tasks[0].status, "dispatching");
    releaseDispatch();
    for (let attempt = 0; attempt < 50 && persisted.cron?.status !== "completed"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(persisted.tasks[0].status, "dispatched");
    let created;
    for (let attempt = 0; attempt < 10; attempt++) {
      created = await fetch(secondOrigin + "/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (created.status === 201) break;
      await created.text();
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(created.status, 201);
    assert.equal(persisted.tasks.length, 2);
    assert.deepEqual(persisted.tasks.map(task => task.name).sort(), ["Do not lose me", "Leased task"]);
  } finally {
    releaseDispatch();
    await Promise.all([first.close(), second.close()]);
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test("owner can request pause during the active dispatch and the current cycle stops afterward", async () => {
  const keys = ["APOLLO_BULLETIN_USE_HOSTLESS_CRON", "APOLLO_BULLETIN_CRON_TOKEN", "APOLLO_BULLETIN_ENABLE_BROWSER"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "pause-during-dispatch-token";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  let persisted = {
    tasks: [{ id: "pause-current", name: "Pause current", prompt: "Finish this one cycle", destination: "test-simulator", status: "scheduled", nextRunAt: Date.now() - 1_000, schedule: { type: "manual" } }],
    activity: [],
  };
  const leases = new Map();
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
    async acquireLease(key, ownerId, at, ttlMs) { const current = leases.get(key); if (current && current.expiresAt > at && current.ownerId !== ownerId) return false; leases.set(key, { ownerId, expiresAt: at + ttlMs }); return true; },
    async releaseLease(key, ownerId) { const current = leases.get(key); if (!current || current.ownerId !== ownerId) return false; leases.set(key, { ...current, expiresAt: 0 }); return true; },
  };
  let releaseDispatch;
  let dispatchEntered = false;
  const dispatchGate = new Promise(resolve => { releaseDispatch = resolve; });
  const app = createBulletinServer({ port: 0, store, dispatch: async () => { dispatchEntered = true; await dispatchGate; return { submitted: true, receipt: { reply: "delivered" } }; } });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const wake = await fetch(origin + "/api/cron/tick", { method: "POST", headers: { authorization: "Bearer pause-during-dispatch-token" } });
    assert.equal(wake.status, 202);
    for (let attempt = 0; attempt < 50 && !dispatchEntered; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(dispatchEntered, true);
    const pause = await fetch(origin + "/api/tasks/pause-current/pause", { method: "POST" });
    assert.equal(pause.status, 200);
    const pauseResult = await pause.json();
    assert.equal(pauseResult.task.pauseRequested, true);
    releaseDispatch();
    for (let attempt = 0; attempt < 50 && persisted.tasks[0].status !== "paused"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(persisted.tasks[0].status, "paused");
    assert.equal(persisted.tasks[0].nextRunAt, null);
    assert.equal(persisted.tasks[0].lastEvent, "Paused after the current cycle");
  } finally {
    releaseDispatch();
    await app.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
