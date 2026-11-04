import test from "node:test";
import assert from "node:assert/strict";
import { BILLING_PLAN_IDS, METERED_RESOURCES } from "../packages/contracts/dist/index.js";
import { missionControlMonetizationView } from "../apps/mission-control/dist/index.js";

function tenant(planId, price, warning, hosted = 0, companion = 0) {
  return { planId, monthlyPriceUsd: price, resources: Object.fromEntries(METERED_RESOURCES.map((resource) => [resource, { hosted, companion, limit: 100, warning }])) };
}

test("Mission Control aggregates revenue, plans, warnings, and Companion savings without tenant identities", () => {
  const view = missionControlMonetizationView([tenant("creator", 5, 70, 2, 8), tenant("pro", 12, 90, 3, 9), tenant("agency", 29, 100, 4, 10)]);
  assert.equal(view.totalTenants, 3);
  assert.equal(view.monthlyRecurringRevenueUsd, 46);
  assert.deepEqual(BILLING_PLAN_IDS.map((id) => view.planCounts[id]), [0, 1, 1, 1]);
  assert.deepEqual([view.warning70, view.warning90, view.exhausted], [1, 1, 1]);
  assert.equal(view.hostedUsage["hosted-worker-minutes"], 9);
  assert.equal(view.companionUsage["hosted-worker-minutes"], 27);
  assert.doesNotMatch(JSON.stringify(view), /tenant-/);
});
