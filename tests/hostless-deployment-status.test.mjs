import test from "node:test";
import assert from "node:assert/strict";
import {
  isHostlessDeploymentFailure,
  isHostlessDeploymentSuccessful,
  normalizeHostlessDeploymentStatus,
} from "../scripts/hostless/deployment-status.mjs";

test("Hostless build failures are terminal and reported immediately", () => {
  for (const status of [
    "BUILD_FAILED",
    "BUILD_FAILURE",
    "BUILD_ERROR",
    "BUILD_TIMED_OUT",
    "BUILD_TIMEOUT",
    "VALIDATE_HOSTLESS_FILE_FAILED",
    "DEPLOYMENT_FAILED",
  ]) {
    assert.equal(isHostlessDeploymentFailure(status), true, status);
  }
});

test("successful Hostless deployment states remain successful", () => {
  for (const status of ["READY", "LIVE", "ACTIVE", "DEPLOYMENT_SUCCESSFUL", "COMPLETED"]) {
    assert.equal(isHostlessDeploymentSuccessful(status), true, status);
    assert.equal(isHostlessDeploymentFailure(status), false, status);
  }
});

test("unknown Hostless states are normalized without being guessed as terminal", () => {
  assert.equal(normalizeHostlessDeploymentStatus(" Build-Failed "), "build_failed");
  assert.equal(isHostlessDeploymentFailure("waiting_for_capacity"), false);
  assert.equal(isHostlessDeploymentSuccessful("waiting_for_capacity"), false);
});
