import test from "node:test";
import assert from "node:assert/strict";
import { readinessStatus, isReadinessResponseReady } from "./readiness.mjs";

test("readiness is false when required browser has not started", () => {
  assert.deepEqual(readinessStatus({ browserRequired: true, browserStarted: false, persistenceRequired: false, persistenceAvailable: false }), { ready: false, statusCode: 503 });
});
test("readiness ignores optional browser and persistence fallback", () => {
  assert.deepEqual(readinessStatus({ browserRequired: false, browserStarted: false, persistenceRequired: false, persistenceAvailable: false }), { ready: true, statusCode: 200 });
});
test("readiness requires configured persistence when policy requires it", () => {
  assert.deepEqual(readinessStatus({ browserRequired: false, browserStarted: true, persistenceRequired: true, persistenceAvailable: false }), { ready: false, statusCode: 503 });
});
test("readiness passes when required dependencies are present", () => {
  assert.deepEqual(readinessStatus({ browserRequired: true, browserStarted: true, persistenceRequired: true, persistenceAvailable: true }), { ready: true, statusCode: 200 });
});
test("release readiness accepts the SPMT root state contract", () => {
  assert.equal(isReadinessResponseReady("/health/ready", { live: true, state: "ready", storage: { ready: true } }), true);
  assert.equal(isReadinessResponseReady("/health/ready", { live: true, state: "degraded", storage: { ready: true } }), true);
  assert.equal(isReadinessResponseReady("/health/ready", { live: true, state: "degraded", storage: { ready: false } }), false);
  assert.equal(isReadinessResponseReady("/health/ready", { live: true, state: "unavailable", storage: { ready: true } }), false);
  assert.equal(isReadinessResponseReady("/health/ready", { ready: false, live: true, state: "ready" }), false);
});
test("readiness requires configured Hostless cron authentication and persisted execution proof", () => {
  const base = { browserRequired: true, browserStarted: true, persistenceRequired: true, persistenceAvailable: true, cronRequired: true };
  assert.deepEqual(readinessStatus({ ...base, cronAuthConfigured: false, cronExecutionConfirmed: false }), { ready: false, statusCode: 503 });
  assert.deepEqual(readinessStatus({ ...base, cronAuthConfigured: true, cronExecutionConfirmed: false }), { ready: false, statusCode: 503 });
  assert.deepEqual(readinessStatus({ ...base, cronAuthConfigured: true, cronExecutionConfirmed: true }), { ready: true, statusCode: 200 });
});
test("release readiness requires the Bulletin boolean contract", () => {
  assert.equal(isReadinessResponseReady("/bulletin/health/ready", { ready: true }), true);
  assert.equal(isReadinessResponseReady("/bulletin/health/ready", { state: "ready" }), false);
  assert.equal(isReadinessResponseReady("/bulletin/health/ready", { ready: false }), false);
});
