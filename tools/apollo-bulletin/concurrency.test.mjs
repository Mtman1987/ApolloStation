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

test("ChatGPT review capability works during dispatch and signals the queue without overwriting it", async () => {
  const keys = ["APOLLO_BULLETIN_USE_HOSTLESS_CRON", "APOLLO_BULLETIN_CRON_TOKEN", "APOLLO_BULLETIN_ENABLE_BROWSER"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "review-capability-test-token";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  const reviewKey = "123e4567-e89b-42d3-a456-426614174000";
  const task = {
    id: "review-signal-task", name: "Review signal task", prompt: "Continue carefully",
    destination: "chatgpt", conversationUrl: "https://chatgpt.com/c/review-signal",
    status: "scheduled", nextRunAt: Date.now() - 1_000, schedule: { type: "manual" },
    reviewKey, reviewUrl: "https://apollo-node-1.hostless.app/bulletin/review/" + reviewKey,
    completionMarker: "APOLLO_BULLETIN_COMPLETE_REVIEW_SIGNAL", maxCycles: 3, cycles: 0,
  };
  let persisted = { tasks: [task], activity: [] };
  const leases = new Map(), reviewSignals = new Map();
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
    async acquireLease(key, ownerId, at, ttlMs) { const current = leases.get(key); if (current && current.expiresAt > at && current.ownerId !== ownerId) return false; leases.set(key, { ownerId, expiresAt: at + ttlMs }); return true; },
    async releaseLease(key, ownerId) { const current = leases.get(key); if (!current || current.ownerId !== ownerId) return false; leases.set(key, { ...current, expiresAt: 0 }); return true; },
    async requestReview(taskId, requestedAt) { reviewSignals.set(taskId, { requestedAt }); return true; },
    async consumeReviewRequest(taskId) { const value = reviewSignals.get(taskId) ?? null; reviewSignals.delete(taskId); return value; },
  };
  let releaseDispatch, dispatchEntered = false;
  const dispatchGate = new Promise(resolve => { releaseDispatch = resolve; });
  const dispatch = async () => { dispatchEntered = true; await dispatchGate; return { submitted: true, receipt: { reply: "I need owner input before proceeding." } }; };
  const first = createBulletinServer({ port: 0, store, dispatch });
  const second = createBulletinServer({ port: 0, store, dispatch });
  try {
    const firstAddress = await first.listen(), secondAddress = await second.listen();
    const firstOrigin = "http://127.0.0.1:" + firstAddress.port, secondOrigin = "http://127.0.0.1:" + secondAddress.port;
    const wake = await fetch(firstOrigin + "/api/cron/tick", { method: "POST", headers: { authorization: "Bearer review-capability-test-token" } });
    assert.equal(wake.status, 202);
    for (let attempt = 0; attempt < 50 && !dispatchEntered; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(dispatchEntered, true);
    const review = await fetch(secondOrigin + "/review/" + reviewKey);
    assert.equal(review.status, 200);
    assert.match(await review.text(), /Owner review requested/);
    assert.equal(persisted.tasks[0].status, "dispatching", "the public capability route must not overwrite the active queue row");
    assert.ok(reviewSignals.has(task.id), "the review request is stored separately from the dispatch queue");
    releaseDispatch();
    for (let attempt = 0; attempt < 50 && persisted.tasks[0].status !== "awaiting_review"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(persisted.tasks[0].status, "awaiting_review");
    assert.equal(persisted.tasks[0].lastEvent, "ChatGPT requested owner review");
    assert.equal(reviewSignals.has(task.id), false, "the active dispatcher consumes the one-shot review signal");
  } finally {
    releaseDispatch();
    await Promise.all([first.close(), second.close()]);
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test("pause from a second instance is persisted as a control signal and applied after dispatch", async () => {
  const keys = ["APOLLO_BULLETIN_USE_HOSTLESS_CRON", "APOLLO_BULLETIN_CRON_TOKEN", "APOLLO_BULLETIN_ENABLE_BROWSER"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "cross-instance-pause-token";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  let persisted = {
    tasks: [{ id: "cross-pause", name: "Cross-instance pause", prompt: "Finish this cycle", destination: "test-simulator", status: "scheduled", nextRunAt: Date.now() - 1_000, schedule: { type: "manual" } }],
    activity: [],
  };
  const leases = new Map(), controls = new Map();
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
    async acquireLease(key, ownerId, at, ttlMs) { const current = leases.get(key); if (current && current.expiresAt > at && current.ownerId !== ownerId) return false; leases.set(key, { ownerId, expiresAt: at + ttlMs }); return true; },
    async releaseLease(key, ownerId) { const current = leases.get(key); if (!current || current.ownerId !== ownerId) return false; leases.set(key, { ...current, expiresAt: 0 }); return true; },
    async requestTaskControl(taskId, action, requestedAt) { controls.set(taskId, { action, requestedAt }); return true; },
    async loadTaskControls() { return Object.fromEntries(controls); },
    async consumeTaskControl(taskId) { const control = controls.get(taskId) ?? null; controls.delete(taskId); return control; },
  };
  let releaseDispatch, dispatchEntered = false;
  const dispatchGate = new Promise(resolve => { releaseDispatch = resolve; });
  const dispatch = async () => { dispatchEntered = true; await dispatchGate; return { submitted: true, receipt: { reply: "delivered" } }; };
  const first = createBulletinServer({ port: 0, store, dispatch });
  const second = createBulletinServer({ port: 0, store, dispatch });
  try {
    const firstAddress = await first.listen(), secondAddress = await second.listen();
    const firstOrigin = "http://127.0.0.1:" + firstAddress.port, secondOrigin = "http://127.0.0.1:" + secondAddress.port;
    const wake = await fetch(firstOrigin + "/api/cron/tick", { method: "POST", headers: { authorization: "Bearer cross-instance-pause-token" } });
    assert.equal(wake.status, 202);
    for (let attempt = 0; attempt < 50 && !dispatchEntered; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(dispatchEntered, true);
    const pause = await fetch(secondOrigin + "/api/tasks/cross-pause/pause", { method: "POST" });
    assert.equal(pause.status, 202);
    const response = await pause.json();
    assert.equal(response.controlRequested, "pause");
    assert.equal(response.task.pendingControl, "pause");
    const visible = await fetch(secondOrigin + "/api/tasks");
    assert.equal((await visible.json()).tasks[0].pendingControl, "pause");
    releaseDispatch();
    for (let attempt = 0; attempt < 50 && persisted.tasks[0].status !== "paused"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(persisted.tasks[0].status, "paused");
    assert.equal(persisted.tasks[0].lastEvent, "Paused after the current cycle");
    assert.equal(controls.has("cross-pause"), false);
  } finally {
    releaseDispatch();
    await Promise.all([first.close(), second.close()]);
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});


test("startup recovery waits for the shared dispatcher lease before rewriting an active dispatch", async () => {
  const keys = ["APOLLO_BULLETIN_USE_HOSTLESS_CRON", "APOLLO_BULLETIN_CRON_TOKEN", "APOLLO_BULLETIN_ENABLE_BROWSER", "APOLLO_BULLETIN_REQUIRE_TURSO"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "startup-lease-test-token";
  process.env.APOLLO_BULLETIN_REQUIRE_TURSO = "1";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;

  const leases = new Map();
  let persisted = {
    tasks: [{ id: "deploy-overlap", name: "Deploy overlap", prompt: "Send once", destination: "test-simulator", status: "scheduled", nextRunAt: Date.now() - 1_000, schedule: { type: "manual" } }],
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
  let dispatchCalls = 0;
  const dispatchGate = new Promise(resolve => { releaseDispatch = resolve; });
  const dispatch = async () => {
    dispatchCalls += 1;
    dispatchEntered = true;
    await dispatchGate;
    return { submitted: true, receipt: { reply: "delivered" } };
  };
  const first = createBulletinServer({ port: 0, store, dispatch });
  const second = createBulletinServer({ port: 0, store, dispatch });
  try {
    const firstAddress = await first.listen();
    const firstOrigin = "http://127.0.0.1:" + firstAddress.port;
    const wake = await fetch(firstOrigin + "/api/cron/tick", { method: "POST", headers: { authorization: "Bearer startup-lease-test-token" } });
    assert.equal(wake.status, 202);
    for (let attempt = 0; attempt < 100 && !dispatchEntered; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(dispatchEntered, true);

    const secondAddress = await second.listen();
    const secondOrigin = "http://127.0.0.1:" + secondAddress.port;
    assert.equal(persisted.tasks[0].status, "dispatching", "a new instance must not recover another live instance's in-flight task");

    releaseDispatch();
    for (let attempt = 0; attempt < 100 && persisted.tasks[0].status !== "dispatched"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(persisted.tasks[0].status, "dispatched");
    const secondWake = await fetch(secondOrigin + "/api/cron/tick", { method: "POST", headers: { authorization: "Bearer startup-lease-test-token" } });
    assert.equal(secondWake.status, 202);
    for (let attempt = 0; attempt < 100 && persisted.cron?.completedTicks < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(dispatchCalls, 1, "the overlapping instance must reload the completed task without sending it again");
    assert.equal(persisted.tasks[0].status, "dispatched");
  } finally {
    releaseDispatch();
    await Promise.all([first.close(), second.close()]);
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("first queue mutation waits for the local startup tick instead of returning a transient 503", async () => {
  const keys = ["APOLLO_BULLETIN_USE_HOSTLESS_CRON", "APOLLO_BULLETIN_CRON_TOKEN", "APOLLO_BULLETIN_ENABLE_BROWSER", "APOLLO_BULLETIN_REQUIRE_TURSO"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;
  delete process.env.APOLLO_BULLETIN_CRON_TOKEN;
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;

  let persisted = {
    tasks: [{
      id: "startup-local-dispatch",
      name: "Startup local dispatch",
      prompt: "Deliver once",
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
  };
  let releaseDispatch;
  let dispatchEntered = false;
  const dispatchGate = new Promise(resolve => { releaseDispatch = resolve; });
  const app = createBulletinServer({
    port: 0,
    store,
    dispatch: async () => {
      dispatchEntered = true;
      await dispatchGate;
      return { submitted: true, receipt: { reply: "delivered" }, reason: "test receipt" };
    },
  });

  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    for (let attempt = 0; attempt < 100 && !dispatchEntered; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(dispatchEntered, true, "the local startup tick should have claimed the due task");

    let createSettled = false;
    const create = fetch(origin + "/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Created during startup tick", prompt: "Persist this task", destination: "test-simulator", scheduleType: "manual" }),
    }).finally(() => { createSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(createSettled, false, "same-instance queue mutation must wait for the active tick, not fail busy");

    releaseDispatch();
    const response = await create;
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.ok(body.task.id);
    assert.equal(persisted.tasks.length, 2);
    assert.equal(persisted.tasks[0].status, "dispatched");
    assert.equal(persisted.tasks[1].name, "Created during startup tick");
  } finally {
    releaseDispatch();
    await app.close();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("task-list reads refresh the persisted queue on a second Bulletin instance", async () => {
  const leases = new Map();
  let persisted = { tasks: [], activity: [] };
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
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
  const first = createBulletinServer({ port: 0, store });
  const second = createBulletinServer({ port: 0, store });
  try {
    const firstAddress = await first.listen();
    const secondAddress = await second.listen();
    const firstOrigin = "http://127.0.0.1:" + firstAddress.port;
    const secondOrigin = "http://127.0.0.1:" + secondAddress.port;
    const created = await fetch(firstOrigin + "/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Cross-instance read", prompt: "Visible everywhere", destination: "test-simulator", scheduleType: "manual" }),
    });
    assert.equal(created.status, 201);
    const list = await fetch(secondOrigin + "/api/tasks");
    assert.equal(list.status, 200);
    const data = await list.json();
    assert.equal(data.tasks.length, 1);
    assert.equal(data.tasks[0].name, "Cross-instance read");
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
