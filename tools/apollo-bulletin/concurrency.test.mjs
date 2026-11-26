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
