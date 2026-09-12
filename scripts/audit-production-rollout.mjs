#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GATE_STATES = new Set(["pending", "passed", "blocked"]);
const COHORT_STATES = new Set(["queued", "blocked", "protected-preview", "shadow", "canary", "primary", "retired"]);
const GREEN_MODES = new Set(["isolated", "shadow", "canary", "primary", "retired"]);
const AUTHORITIES = new Set(["blue", "green"]);

export function auditProductionRollout(plan) {
  const errors = [];
  if (plan?.schemaVersion !== 1) errors.push("production rollout must use schemaVersion 1");
  if (plan?.strategy !== "parallel-app-cutover") errors.push("production rollout must use the parallel app cutover strategy");
  const global = plan?.global ?? {};
  if (!AUTHORITIES.has(global.defaultProductionAuthority)) errors.push("default production authority must be blue or green");
  if (!AUTHORITIES.has(global.emergencyRollbackAuthority)) errors.push("emergency rollback authority must be blue or green");
  if (global.productionTrafficMoved && !global.liveMutationAllowed) errors.push("production traffic cannot move while live mutation is disabled");
  if (global.blueRetirementAllowed && !global.productionTrafficMoved) errors.push("Blue retirement cannot be allowed before production traffic moves");

  const publicPreviewGates = plan?.publicPreviewGates ?? {};
  const publicGateEntries = Object.entries(publicPreviewGates);
  if (!publicGateEntries.length) errors.push("public preview gates are required");
  for (const [name, gate] of publicGateEntries) {
    if (!GATE_STATES.has(gate?.state)) errors.push(`public preview gate ${name} has an invalid state`);
    if (!String(gate?.evidence ?? "").trim()) errors.push(`public preview gate ${name} requires evidence`);
  }
  const publicPreviewReady = publicGateEntries.length > 0 && publicGateEntries.every(([, gate]) => gate.state === "passed");
  if (global.publicShellEnabled && !publicPreviewReady) errors.push("public shell cannot be enabled until every public preview gate passes");

  const cohorts = Array.isArray(plan?.cohorts) ? plan.cohorts : [];
  if (!cohorts.length) errors.push("at least one rollout cohort is required");
  const ids = new Set();
  const units = new Set();
  const orders = new Set();
  const candidates = [];
  for (const cohort of cohorts) {
    if (!cohort?.id || ids.has(cohort.id)) errors.push(`duplicate or missing cohort id: ${cohort?.id ?? "unknown"}`);
    ids.add(cohort?.id);
    if (!Number.isInteger(cohort?.order) || orders.has(cohort.order)) errors.push(`cohort ${cohort?.id ?? "unknown"} needs a unique integer order`);
    orders.add(cohort?.order);
    if (!COHORT_STATES.has(cohort?.status)) errors.push(`cohort ${cohort?.id ?? "unknown"} has an invalid status`);
    if (!GREEN_MODES.has(cohort?.greenMode)) errors.push(`cohort ${cohort?.id ?? "unknown"} has an invalid Green mode`);
    if (!AUTHORITIES.has(cohort?.productionAuthority)) errors.push(`cohort ${cohort?.id ?? "unknown"} has an invalid production authority`);
    if (!AUTHORITIES.has(cohort?.rollbackTarget)) errors.push(`cohort ${cohort?.id ?? "unknown"} has an invalid rollback target`);
    if (!Array.isArray(cohort?.units) || !cohort.units.length) errors.push(`cohort ${cohort?.id ?? "unknown"} requires rollout units`);
    for (const unit of cohort?.units ?? []) {
      if (!String(unit).trim() || units.has(unit)) errors.push(`duplicate or invalid rollout unit: ${unit ?? "unknown"}`);
      units.add(unit);
    }
    if (cohort?.nextCandidate) candidates.push(cohort.id);
    const gates = Object.entries(cohort?.gates ?? {});
    if (!gates.length) errors.push(`cohort ${cohort?.id ?? "unknown"} requires cutover gates`);
    for (const [name, state] of gates) if (!GATE_STATES.has(state)) errors.push(`cohort ${cohort?.id ?? "unknown"} gate ${name} has an invalid state`);
    const cutoverGatesPassed = gates.length > 0 && gates.every(([, state]) => state === "passed");
    const canAffectProduction = ["canary", "primary", "retired"].includes(cohort?.greenMode) || ["canary", "primary", "retired"].includes(cohort?.status);
    if (canAffectProduction && !cutoverGatesPassed) errors.push(`cohort ${cohort?.id ?? "unknown"} cannot affect production before every cutover gate passes`);
    if (cohort?.shadowSideEffectsAllowed && cohort?.greenMode === "shadow") errors.push(`cohort ${cohort?.id ?? "unknown"} shadow mode must be side-effect free`);
    if (cohort?.productionAuthority === "green" && !global.liveMutationAllowed) errors.push(`cohort ${cohort?.id ?? "unknown"} cannot give Green production authority while live mutation is disabled`);
    if (cohort?.status === "retired" && !global.blueRetirementAllowed) errors.push(`cohort ${cohort?.id ?? "unknown"} cannot retire Blue while retirement is disabled`);
  }
  if (candidates.length !== 1) errors.push(`exactly one next rollout candidate is required; found ${candidates.length}`);
  const ordered = [...cohorts].sort((a, b) => a.order - b.order);
  if (ordered.at(-1)?.id !== "streamweaver") errors.push("StreamWeaver must remain the last broad migration cohort");
  if (candidates[0] !== "hearmeout") errors.push("HearMeOut must remain the first real app canary until its cutover is complete");

  return {
    schemaVersion: 1,
    strategy: plan?.strategy,
    valid: errors.length === 0,
    publicPreviewReady,
    publicShellEnabled: global.publicShellEnabled === true,
    productionTrafficMoved: global.productionTrafficMoved === true,
    liveMutationAllowed: global.liveMutationAllowed === true,
    blueRetirementAllowed: global.blueRetirementAllowed === true,
    nextCandidate: candidates.length === 1 ? candidates[0] : null,
    pendingPublicGates: publicGateEntries.filter(([, gate]) => gate.state !== "passed").map(([name]) => name),
    errors,
  };
}

export function auditProductionRolloutFile(root) {
  const plan = JSON.parse(readFileSync(resolve(root, "config/production-rollout.v1.json"), "utf8"));
  return auditProductionRollout(plan);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const report = auditProductionRolloutFile(root);
  console.log(`Apollo production rollout: ${report.valid ? "VALID" : "INVALID"}`);
  console.log(`Public preview: ${report.publicPreviewReady ? "READY" : "BLOCKED"}; production traffic moved: ${report.productionTrafficMoved ? "yes" : "no"}`);
  console.log(`Next app canary: ${report.nextCandidate ?? "none"}`);
  for (const gate of report.pendingPublicGates) console.log(`BLOCKED public preview gate: ${gate}`);
  for (const error of report.errors) console.error(`ERROR ${error}`);
  if (!report.valid) process.exitCode = 1;
}
