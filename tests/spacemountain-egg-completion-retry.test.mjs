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
