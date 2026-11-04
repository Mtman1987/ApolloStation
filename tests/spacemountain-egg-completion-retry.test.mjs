import assert from "node:assert/strict";
import test from "node:test";
import { ECOSYSTEM_EGG_PENDING_KEY, EcosystemEggCompletionQueue } from "../apps/spacemountain-web/dist/egg-completion-retry.js";

function memoryStorage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("unconfirmed ecosystem egg receipts survive reload for the original account", () => {
  const storage = memoryStorage();
  const first = new EcosystemEggCompletionQueue(storage);
  first.enqueue({ tenantId: "tenant-a", userId: "user-a", egg: "rocket" });
  const reload = new EcosystemEggCompletionQueue(storage);
  assert.deepEqual(reload.forAccount("tenant-a", "user-a"), [{ tenantId: "tenant-a", userId: "user-a", egg: "rocket" }]);
  reload.confirm({ tenantId: "tenant-a", userId: "user-a", egg: "rocket" });
  assert.equal(storage.getItem(ECOSYSTEM_EGG_PENDING_KEY), null);
});

test("a pending discovery never transfers to another tenant or user", () => {
  const queue = new EcosystemEggCompletionQueue(memoryStorage());
  queue.enqueue({ tenantId: "tenant-a", userId: "user-a", egg: "rocket" });
  assert.deepEqual(queue.forAccount("tenant-a", "user-b"), []);
  assert.deepEqual(queue.forAccount("tenant-b", "user-a"), []);
  assert.equal(queue.forAccount("tenant-a", "user-a").length, 1);
});

test("receipt retries coalesce while corrupt persisted entries fail closed", () => {
  const storage = memoryStorage();
  storage.setItem(ECOSYSTEM_EGG_PENDING_KEY, JSON.stringify([{ tenantId: "tenant-a", userId: "user-a", egg: "unknown" }, { tenantId: "tenant-a", userId: "user-a", egg: "signal" }]));
  const queue = new EcosystemEggCompletionQueue(storage);
  queue.enqueue({ tenantId: "tenant-a", userId: "user-a", egg: "signal" });
  queue.enqueue({ tenantId: "tenant-a", userId: "user-a", egg: "signal" });
  assert.deepEqual(queue.forAccount("tenant-a", "user-a"), [{ tenantId: "tenant-a", userId: "user-a", egg: "signal" }]);
});

import { EcosystemEggRetryCoordinator, reconcileEcosystemEggCompletions, eggCompletionType } from "../apps/spacemountain-web/dist/egg-completion-retry.js";
const account = { tenantId: "tenant-a", userId: "user-a" };
function fixture() {
  const events = [];
  const keys = new Map();
  const notifications = [];
  const api = {
    async publishEvent(tenantId, type, payload, idempotencyKey) {
      if (keys.has(idempotencyKey)) return { duplicate: true, event: keys.get(idempotencyKey) };
      const event = { id: `event-${events.length}`, tenantId, sourceAppId: account.userId, type, payload, idempotencyKey };
      events.push(event); keys.set(idempotencyKey, event);
      return { duplicate: false, event };
    },
    async listEvents(tenantId, { type, sourceAppId, limit }) {
      assert.ok(type && sourceAppId, "confirmation reads must target the exact account and event type");
      return events.filter((event) => event.tenantId === tenantId && event.type === type && event.sourceAppId === sourceAppId).slice(-limit);
    },
    async createNotification(...args) { notifications.push(args); },
  };
  const queue = new EcosystemEggCompletionQueue(memoryStorage());
  const run = (isCurrent = () => true) => reconcileEcosystemEggCompletions({ queue, account, isCurrent, api });
  return { events, keys, notifications, api, queue, run };
}

test("old idempotent completions survive busy tenant history and award only once", async () => {
  const f = fixture();
  for (const egg of ["rocket", "blackHole", "signal"]) await f.api.publishEvent(account.tenantId, eggCompletionType(egg), { userId: account.userId, egg, completed: true }, `egg:${account.userId}:${egg}`);
  for (let i = 0; i < 250; i++) f.events.push({ tenantId: account.tenantId, sourceAppId: "another-user", type: "chat", payload: {} });
  f.queue.enqueue({ ...account, egg: "signal" });
  assert.equal((await f.run()).all, true);
  assert.deepEqual(f.queue.forAccount(account.tenantId, account.userId), []);
  f.queue.enqueue({ ...account, egg: "signal" });
  await f.run();
  assert.equal(f.notifications.length, 1);
});

test("a lost publish response is confirmed from canonical account state", async () => {
  const f = fixture();
  const publish = f.api.publishEvent;
  f.api.publishEvent = async (...args) => { await publish(...args); throw new Error("connection lost"); };
  f.queue.enqueue({ ...account, egg: "rocket" });
  assert.equal((await f.run()).pending, 0);
});

test("discoveries arriving during a retry get a second pass without another focus event", async () => {
  const f = fixture();
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const publish = f.api.publishEvent;
  f.api.publishEvent = async (...args) => { if (args[1] === eggCompletionType("rocket")) { entered(); await waiting; } return publish(...args); };
  const coordinator = new EcosystemEggRetryCoordinator(() => f.run());
  f.queue.enqueue({ ...account, egg: "rocket" });
  const first = coordinator.retry();
  await started;
  f.queue.enqueue({ ...account, egg: "signal" });
  const second = coordinator.retry();
  release(); await Promise.all([first, second]);
  assert.equal(f.queue.forAccount(account.tenantId, account.userId).length, 0);
  assert.ok(f.keys.has(`egg:${account.userId}:signal`));
});

test("switching accounts stops subsequent writes and retains receipts for their original owner", async () => {
  const f = fixture(); let current = true, calls = 0;
  f.api.publishEvent = async () => { calls++; current = false; return { event: {} }; };
  f.queue.enqueue({ ...account, egg: "rocket" }); f.queue.enqueue({ ...account, egg: "signal" });
  assert.equal(await f.run(() => current), undefined);
  assert.equal(calls, 1); assert.equal(f.queue.forAccount(account.tenantId, account.userId).length, 2);
});

test("a mismatched server receipt cannot confirm another user's discovery", async () => {
  const f = fixture();
  f.api.publishEvent = async () => ({ event: { tenantId: account.tenantId, sourceAppId: "other", type: eggCompletionType("rocket"), payload: { userId: "other", egg: "rocket", completed: true } } });
  f.queue.enqueue({ ...account, egg: "rocket" });
  assert.equal((await f.run()).pending, 1);
});

test("a temporary read failure retains receipts without spinning automatic retries", async () => {
  const f = fixture(); let calls = 0;
  f.api.listEvents = async () => { calls++; throw new Error("temporarily offline"); };
  f.queue.enqueue({ ...account, egg: "rocket" });
  const coordinator = new EcosystemEggRetryCoordinator(() => f.run());
  await assert.rejects(coordinator.retry(), /temporarily offline/);
  assert.equal(calls, 1); assert.equal(f.queue.forAccount(account.tenantId, account.userId).length, 1);
});
