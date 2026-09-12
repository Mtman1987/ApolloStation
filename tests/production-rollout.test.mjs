import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditProductionRollout } from "../scripts/audit-production-rollout.mjs";

const readPlan = () => JSON.parse(readFileSync(new URL("../config/production-rollout.v1.json", import.meta.url), "utf8"));

test("deleting any required public gate cannot unlock public exposure", () => {
  for (const name of Object.keys(readPlan().publicPreviewGates)) {
    const plan = readPlan();
    for (const gate of Object.values(plan.publicPreviewGates)) gate.state = "passed";
    delete plan.publicPreviewGates[name];
    plan.global.publicShellEnabled = true;
    const report = auditProductionRollout(plan);
    assert.equal(report.valid, false, name);
    assert.equal(report.publicPreviewReady, false, name);
    assert.ok(report.pendingPublicGates.includes(name), name);
  }
});

test("deleting any cutover gate cannot unlock a canary", () => {
  for (const name of Object.keys(readPlan().cohorts[1].gates)) {
    const plan = readPlan();
    plan.global.liveMutationAllowed = true;
    plan.global.productionTrafficMoved = true;
    const cohort = plan.cohorts[1];
    for (const gate of Object.keys(cohort.gates)) cohort.gates[gate] = "passed";
    delete cohort.gates[name];
    cohort.status = cohort.greenMode = "canary";
    cohort.productionAuthority = "green";
    const report = auditProductionRollout(plan);
    assert.equal(report.valid, false, name);
    assert.ok(report.errors.some((error) => error.includes(`required cutover gate ${name}`)), name);
  }
});

test("explicit complete proof permits a bounded canary without public shell exposure", () => {
  const plan = readPlan();
  plan.global.liveMutationAllowed = true;
  plan.global.productionTrafficMoved = true;
  const cohort = plan.cohorts[1];
  for (const name of Object.keys(cohort.gates)) cohort.gates[name] = "passed";
  cohort.status = cohort.greenMode = "canary";
  cohort.productionAuthority = "green";
  assert.equal(auditProductionRollout(plan).valid, true);
  plan.global.productionTrafficMoved = false;
  assert.equal(auditProductionRollout(plan).valid, false);
});

test("truthy strings, missing switches, and automatic promotion fail closed", () => {
  for (const name of ["publicShellEnabled", "productionTrafficMoved", "liveMutationAllowed", "blueRetirementAllowed", "automaticPromotionAllowed"]) {
    for (const value of ["false", undefined]) {
      const plan = readPlan();
      plan.global[name] = value;
      assert.equal(auditProductionRollout(plan).valid, false, name);
    }
  }
  const plan = readPlan();
  plan.global.automaticPromotionAllowed = true;
  assert.equal(auditProductionRollout(plan).valid, false);
});

test("Green authority cannot be assigned in shadow mode even with global permissions", () => {
  const plan = readPlan();
  plan.global.liveMutationAllowed = plan.global.productionTrafficMoved = true;
  plan.cohorts[1].productionAuthority = "green";
  assert.equal(auditProductionRollout(plan).valid, false);
});

test("retired Green mode requires the retirement permission too", () => {
  const plan = readPlan();
  plan.global.liveMutationAllowed = plan.global.productionTrafficMoved = true;
  const cohort = plan.cohorts[1];
  for (const name of Object.keys(cohort.gates)) cohort.gates[name] = "passed";
  cohort.greenMode = "retired";
  assert.ok(auditProductionRollout(plan).errors.some((error) => /cannot retire Blue/.test(error)));
});

test("null public gates fail closed without crashing the audit", () => {
  const plan = readPlan();
  plan.publicPreviewGates.publicIngress = null;
  assert.equal(auditProductionRollout(plan).valid, false);
});

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
