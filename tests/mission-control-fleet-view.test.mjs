import assert from "node:assert/strict";
import test from "node:test";
import { missionControlFleetView } from "../apps/mission-control/dist/index.js";

const projection = (workloadId, state, overrides = {}) => ({ schemaVersion: 1, workloadId, generation: "g1", policyRevision: "r1", state, observedCapacity: 1, desiredCapacity: 1, healthyCapacity: 1, action: "none", reason: "test", productionMutationAllowed: false, updatedAt: "2026-08-28T09:00:00.000Z", ...overrides });

test("Mission Control summarizes bounded Rotator projections without Fly credentials", () => {
  const view = missionControlFleetView([
    projection("qwen", "dry-run", { observedCapacity: 0, desiredCapacity: 1, healthyCapacity: 0, action: "create" }),
    projection("spmt", "verified", { productionMutationAllowed: true }),
    projection("bot", "rolled-back", { action: "blocked" }),
  ]);
  assert.deepEqual({ total: view.totalWorkloads, ready: view.ready, dryRun: view.dryRun, blocked: view.blocked, running: view.runningCapacity, desired: view.desiredCapacity, enabled: view.productionMutationEnabled }, { total: 3, ready: 1, dryRun: 1, blocked: 1, running: 2, desired: 3, enabled: 1 });
  assert.deepEqual(view.workloads.map((item) => item.workloadId), ["bot", "qwen", "spmt"]);
  assert.equal(JSON.stringify(view).includes("machineId"), false);
});
