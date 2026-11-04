import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertRuntimePolicyV1 } from "../packages/contracts/dist/index.js";
import { reconcileRuntimePolicy } from "../packages/runtime/dist/index.js";

const now = "2026-08-28T08:00:00.000Z";
const base = { schemaVersion: 1, generation: "g1", observedAt: now, runningCapacity: 0, healthyCapacity: 0, stoppedCapacity: 0, activeRequests: 0, requestRate: 0, queueDepth: 0, activeSessions: 0, activeConnections: 0, activeLeases: 0, oldestDemandSeconds: 600, uncheckpointedWork: false, duplicateConsumers: false, estimatedHourlyCostUsd: 0, circuitBreakerOpen: false };
const loaded = JSON.parse(await readFile(new URL("../config/runtime-policies.v1.json", import.meta.url), "utf8"));
const policies = new Map(loaded.policies.map((policy) => [policy.workloadId, assertRuntimePolicyV1(policy)]));
const decide = (id, observation = {}) => reconcileRuntimePolicy(policies.get(id), { ...base, workloadId: id, ...observation }, { now });

test("canonical policy classifies core, elastic, socket, queue, session, local and recovery workloads", () => {
  assert.equal(loaded.schemaVersion, 1);
  for (const id of ["spacemountain-gateway", "spmt-authority", "rotator-reconciler", "product-api-pool", "chat-provider-sockets", "nebula-bot", "hmo-media-workers", "hmo-room-workers", "qwen-cpu-pool", "xbox-sessions", "companion-local-compute", "spmt-vault"]) assert.ok(policies.has(id), id);
  assert.ok([...policies.values()].every((policy) => policy.productionMutationEnabled === false));
  assert.equal(policies.get("xbox-sessions").idleSeconds, 900);
  assert.equal(policies.get("xbox-sessions").maximumLeaseSeconds, 7200);
  assert.equal(policies.get("qwen-cpu-pool").minimumCapacity, 0);
});

test("core stays available while ordinary APIs and Qwen idle to zero", () => {
  assert.deepEqual([decide("spacemountain-gateway").action, decide("spacemountain-gateway").desiredCapacity], ["create", 1]);
  assert.deepEqual([decide("product-api-pool").action, decide("product-api-pool").desiredCapacity], ["none", 0]);
  assert.deepEqual([decide("qwen-cpu-pool").action, decide("qwen-cpu-pool").desiredCapacity], ["none", 0]);
});

test("queue and session demand scale within policy and prefer stopped capacity", () => {
  const media = decide("hmo-media-workers", { queueDepth: 5, stoppedCapacity: 2 });
  assert.deepEqual([media.action, media.desiredCapacity], ["start", 3]);
  const xbox = decide("xbox-sessions", { activeSessions: 3 });
  assert.deepEqual([xbox.action, xbox.desiredCapacity], ["create", 3]);
});

test("active leases and unique sockets block unsafe scale-down", () => {
  const worker = decide("hmo-media-workers", { runningCapacity: 2, healthyCapacity: 2, activeLeases: 1, estimatedHourlyCostUsd: 0.2 });
  assert.equal(worker.action, "blocked");
  const bot = decide("nebula-bot", { runningCapacity: 1, healthyCapacity: 1, activeConnections: 1, estimatedHourlyCostUsd: 0.05 });
  assert.equal(bot.desiredCapacity, 1);
  assert.equal(bot.action, "none");
});

test("stale signals, duplicate consumers, Companion ownership and cost ceilings fail safe", () => {
  assert.equal(decide("product-api-pool", { runningCapacity: 1, healthyCapacity: 1, observedAt: "2026-08-28T07:00:00.000Z" }).action, "blocked");
  assert.equal(decide("chat-provider-sockets", { runningCapacity: 2, duplicateConsumers: true }).action, "blocked");
  assert.equal(decide("companion-local-compute", { queueDepth: 10 }).action, "external");
  const costly = decide("hmo-room-workers", { activeSessions: 8, runningCapacity: 1, healthyCapacity: 1, estimatedHourlyCostUsd: 0.2 });
  assert.equal(costly.desiredCapacity, 3);
  assert.equal(costly.reason, "capacity limited by workload hourly cost ceiling");
});
