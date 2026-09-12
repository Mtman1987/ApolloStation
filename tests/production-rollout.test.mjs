import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditProductionRollout } from "../scripts/audit-production-rollout.mjs";

const readPlan = () => JSON.parse(readFileSync(new URL("../config/production-rollout.v1.json", import.meta.url), "utf8"));

test("Apollo starts as a parallel protected release with Blue production authority", () => {
  const plan = readPlan();
  const report = auditProductionRollout(plan);
  assert.equal(report.valid, true);
  assert.equal(report.publicPreviewReady, false);
  assert.equal(report.publicShellEnabled, false);
  assert.equal(report.productionTrafficMoved, false);
  assert.equal(report.liveMutationAllowed, false);
  assert.equal(report.blueRetirementAllowed, false);
  assert.equal(report.nextCandidate, "hearmeout");
  assert.ok(report.pendingPublicGates.includes("publicIngress"));
  assert.ok(plan.cohorts.every((cohort) => cohort.productionAuthority === "blue"));
  assert.ok(plan.cohorts.every((cohort) => cohort.shadowSideEffectsAllowed === false));
  assert.equal([...plan.cohorts].sort((a, b) => a.order - b.order).at(-1).id, "streamweaver");
});

test("public exposure fails closed while any preview gate is pending", () => {
  const plan = readPlan();
  plan.global.publicShellEnabled = true;
  const report = auditProductionRollout(plan);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => /public shell cannot be enabled/.test(error)));
});

test("a canary cannot gain authority before proof or while live mutation is disabled", () => {
  const plan = readPlan();
  const hearmeout = plan.cohorts.find((cohort) => cohort.id === "hearmeout");
  hearmeout.status = "canary";
  hearmeout.greenMode = "canary";
  hearmeout.productionAuthority = "green";
  const report = auditProductionRollout(plan);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => /before every cutover gate passes/.test(error)));
  assert.ok(report.errors.some((error) => /live mutation is disabled/.test(error)));
});

test("shadow mode can never emit side effects", () => {
  const plan = readPlan();
  plan.cohorts.find((cohort) => cohort.id === "discord-stream-hub").shadowSideEffectsAllowed = true;
  const report = auditProductionRollout(plan);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => /shadow mode must be side-effect free/.test(error)));
});

test("Blue cannot be retired before production has moved", () => {
  const plan = readPlan();
  plan.global.blueRetirementAllowed = true;
  const report = auditProductionRollout(plan);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => /retirement cannot be allowed/.test(error)));
});
