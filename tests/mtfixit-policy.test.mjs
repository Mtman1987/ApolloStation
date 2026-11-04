import test from "node:test";
import assert from "node:assert/strict";
import {
  createMtFixItFingerprint,
  evaluateMtFixItGate,
  MTVFIXIT_MAX_FAILED_ATTEMPTS,
} from "../packages/platform-ops/dist/mtfixit-policy.js";

const base = {
  fingerprint: "incident-1",
  failedAttempts: 0,
  blacklisted: false,
  codeChecks: "passed",
  sandboxChecks: "passed",
};

test("new repairs require code checks, sandbox checks, and confidence threshold", () => {
  assert.equal(evaluateMtFixItGate({ ...base, confidencePercent: 90 }).allowed, true);
  const low = evaluateMtFixItGate({ ...base, confidencePercent: 79 });
  assert.equal(low.allowed, false);
  assert.equal(low.requiresOwnerApproval, true);
  assert.equal(low.reason, "confidence-below-threshold");
});

test("missing confidence and pending checks fail closed", () => {
  assert.equal(evaluateMtFixItGate({ ...base, confidencePercent: undefined }).reason, "confidence-missing");
  assert.equal(evaluateMtFixItGate({ ...base, codeChecks: "pending", confidencePercent: 99 }).allowed, false);
  assert.equal(evaluateMtFixItGate({ ...base, sandboxChecks: "pending", confidencePercent: 99 }).allowed, false);
});

test("proven patch fast path still requires code checks and skips sandbox", () => {
  const result = evaluateMtFixItGate({ ...base, provenPatchId: "patch-1", sandboxChecks: "skipped" });
  assert.equal(result.allowed, true);
  assert.equal(result.shouldRunSandbox, false);
  assert.equal(evaluateMtFixItGate({ ...base, provenPatchId: "patch-1", codeChecks: "pending", sandboxChecks: "skipped" }).allowed, false);
});

test("three failed attempts blacklist the incident until owner intervention", () => {
  const result = evaluateMtFixItGate({ ...base, failedAttempts: MTVFIXIT_MAX_FAILED_ATTEMPTS, confidencePercent: 100 });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "blacklisted");
  assert.equal(result.requiresOwnerApproval, true);
});

test("fingerprint ignores volatile IDs and redacts credential-like text", () => {
  const a = createMtFixItFingerprint({ sourceAppId: "app", level: "error", message: "request 123456789012 failed for 123e4567-e89b-12d3-a456-426614174000" });
  const b = createMtFixItFingerprint({ sourceAppId: "app", level: "error", message: "request 987654321098 failed for 123e4567-e89b-12d3-a456-426614174000" });
  assert.equal(a, b);
  assert.equal(createMtFixItFingerprint({ sourceAppId: "app", level: "error", message: "Bearer supersecret" }).includes("supersecret"), false);
});
