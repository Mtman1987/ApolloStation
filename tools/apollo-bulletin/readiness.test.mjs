import test from "node:test";
import assert from "node:assert/strict";
import { readinessStatus } from "./readiness.mjs";

test("readiness is false when required browser has not started", () => {
  assert.deepEqual(readinessStatus({ browserRequired: true, browserStarted: false, persistenceRequired: false, persistenceAvailable: false, ownerActorConfigured: true }), { ready: false, statusCode: 503 });
});
test("readiness ignores optional browser and persistence fallback when owner pin is configured", () => {
  assert.deepEqual(readinessStatus({ browserRequired: false, browserStarted: false, persistenceRequired: false, persistenceAvailable: false, ownerActorConfigured: true }), { ready: true, statusCode: 200 });
});
test("readiness requires configured persistence when policy requires it", () => {
  assert.deepEqual(readinessStatus({ browserRequired: false, browserStarted: true, persistenceRequired: true, persistenceAvailable: false, ownerActorConfigured: true }), { ready: false, statusCode: 503 });
});
test("readiness passes when all required dependencies and owner pin are present", () => {
  assert.deepEqual(readinessStatus({ browserRequired: true, browserStarted: true, persistenceRequired: true, persistenceAvailable: true, ownerActorConfigured: true }), { ready: true, statusCode: 200 });
});
test("readiness fails closed when the owner actor pin is missing", () => {
  assert.deepEqual(readinessStatus({ browserRequired: false, browserStarted: true, persistenceRequired: false, persistenceAvailable: false, ownerActorConfigured: false }), { ready: false, statusCode: 503 });
});
