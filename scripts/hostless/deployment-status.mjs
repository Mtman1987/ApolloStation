const SUCCESS = new Set([
  "ready", "live", "active", "succeeded", "success", "deployed",
  "completed", "deployment_successful", "deployment_success",
]);

const FAILURE = new Set([
  "failed", "error", "errored", "cancelled", "canceled", "rejected",
  "deployment_failed", "deployment_error", "validate_hostless_file_failed",
  "build_failed", "build_failure", "build_error", "build_timed_out", "build_timeout",
]);

export function normalizeHostlessDeploymentStatus(value) {
  return String(value ?? "unknown").trim().toLowerCase().replace(/[\\s-]+/g, "_");
}

export function isHostlessDeploymentSuccessful(value) {
  return SUCCESS.has(normalizeHostlessDeploymentStatus(value));
}

export function isHostlessDeploymentFailure(value) {
  return FAILURE.has(normalizeHostlessDeploymentStatus(value));
}
