import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFleetActionLeaseStore, RotatorFleetController } from "../packages/runtime/dist/index.js";

const now = "2026-08-28T09:00:00.000Z";
const policy = (overrides = {}) => ({ schemaVersion: 1, revision: "r1", workloadId: "worker", ownerAppId: "hearmeout", class: "queue-worker", executionTarget: "fly", minimumCapacity: 0, maximumCapacity: 4, idleSeconds: 300, targetConcurrency: 1, maximumHourlyCostUsd: 1, stopMode: "stop", uniqueConsumer: false, productionMutationEnabled: true, ...overrides });
const observation = (overrides = {}) => ({ schemaVersion: 1, workloadId: "worker", generation: "g1", observedAt: now, runningCapacity: 0, healthyCapacity: 0, stoppedCapacity: 0, activeRequests: 0, requestRate: 0, queueDepth: 0, activeSessions: 0, activeConnections: 0, activeLeases: 0, oldestDemandSeconds: 600, uncheckpointedWork: false, duplicateConsumers: false, estimatedHourlyCostUsd: 0, circuitBreakerOpen: false, ...overrides });

class FakeFleet {
  calls = [];
  current;
  failVerification = false;
  constructor(current) { this.current = current; }
  async observe() { return this.failVerification && this.calls.length > 0 ? { ...this.current, healthyCapacity: 0, duplicateConsumers: true } : { ...this.current }; }
  async start(_id, count, epoch, key) { this.calls.push(["start", count, epoch, key]); this.current.runningCapacity += count; this.current.healthyCapacity += count; this.current.stoppedCapacity -= Math.min(count, this.current.stoppedCapacity); }
  async create(_id, count, epoch, key) { this.calls.push(["create", count, epoch, key]); this.current.runningCapacity += count; this.current.healthyCapacity += count; }
  async drain(_id, count, epoch, key) { this.calls.push(["drain", count, epoch, key]); }
  async stop(_id, count, epoch, key) { this.calls.push(["stop", count, epoch, key]); this.current.runningCapacity -= count; this.current.healthyCapacity = Math.min(this.current.healthyCapacity, this.current.runningCapacity); }
  async restartOne(_id, epoch, key) { this.calls.push(["restart", 1, epoch, key]); }
  async rollback(_id, original, epoch, key) { this.calls.push(["rollback", 0, epoch, key]); this.current = { ...original }; this.failVerification = false; }
}

test("dry-run reports the exact action without mutating Fly", async () => {
  const fleet = new FakeFleet(observation({ queueDepth: 2 }));
  const result = await new RotatorFleetController(new MemoryFleetActionLeaseStore(), { controllerId: "rotator-a", now: () => now }).reconcile(policy(), fleet);
  assert.deepEqual([result.state, result.action, result.desiredCapacity], ["dry-run", "create", 2]);
  assert.deepEqual(fleet.calls, []);
});

test("controller creates and verifies capacity once with a fencing epoch", async () => {
  const fleet = new FakeFleet(observation({ queueDepth: 2 }));
  const controller = new RotatorFleetController(new MemoryFleetActionLeaseStore(), { controllerId: "rotator-a", dryRun: false, now: () => now });
  const first = await controller.reconcile(policy(), fleet);
  const replay = await controller.reconcile(policy(), fleet);
  assert.equal(first.state, "verified");
  assert.equal(first.fencingEpoch, 1);
  assert.equal(fleet.calls.filter(([name]) => name === "create").length, 1);
  assert.equal(replay.action, "none");
});

test("scale-down drains before stopping and active work blocks the plan", async () => {
  const fleet = new FakeFleet(observation({ runningCapacity: 2, healthyCapacity: 2, estimatedHourlyCostUsd: 0.2 }));
  const controller = new RotatorFleetController(new MemoryFleetActionLeaseStore(), { controllerId: "rotator-a", dryRun: false, now: () => now });
  const result = await controller.reconcile(policy(), fleet);
  assert.equal(result.state, "verified");
  assert.deepEqual(fleet.calls.map(([name]) => name), ["drain", "stop"]);
  const busy = new FakeFleet(observation({ runningCapacity: 2, healthyCapacity: 2, activeLeases: 1 }));
  assert.equal((await controller.reconcile(policy(), busy)).state, "blocked");
  assert.deepEqual(busy.calls, []);
});

test("rolling restart requires spare healthy core capacity", async () => {
  const core = policy({ class: "core", workloadId: "spmt", ownerAppId: "spmt", minimumCapacity: 1, maximumCapacity: 2 });
  const unsafe = new FakeFleet(observation({ workloadId: "spmt", runningCapacity: 1, healthyCapacity: 1, restartDue: true }));
  const controller = new RotatorFleetController(new MemoryFleetActionLeaseStore(), { controllerId: "rotator-a", dryRun: false, now: () => now });
  assert.equal((await controller.reconcile(core, unsafe)).state, "blocked");
  const safe = new FakeFleet(observation({ workloadId: "spmt", runningCapacity: 2, healthyCapacity: 2, restartDue: true }));
  assert.equal((await controller.reconcile(core, safe)).state, "verified");
  assert.equal(safe.calls[0][0], "restart");
});

test("a second Rotator cannot acquire a live workload fence", () => {
  const store = new MemoryFleetActionLeaseStore();
  const first = store.acquire("worker", "rotator-a", now, 30);
  assert.ok(first);
  assert.equal(store.acquire("worker", "rotator-b", now, 30), undefined);
  const later = store.acquire("worker", "rotator-b", "2026-08-28T09:00:31.000Z", 30);
  assert.equal(later.fencingEpoch, 2);
  assert.equal(store.isCurrent(first, "2026-08-28T09:00:31.000Z"), false);
});

test("failed readiness rolls back and redacts operational errors", async () => {
  const fleet = new FakeFleet(observation({ queueDepth: 1 }));
  fleet.failVerification = true;
  const result = await new RotatorFleetController(new MemoryFleetActionLeaseStore(), { controllerId: "rotator-a", dryRun: false, now: () => now }).reconcile(policy(), fleet);
  assert.equal(result.state, "rolled-back");
  assert.equal(result.action, "blocked");
  assert.deepEqual(fleet.calls.map(([name]) => name), ["create", "rollback"]);
});
