import test from "node:test";
import assert from "node:assert/strict";
import { readinessStatus } from "./readiness.mjs";

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

test("production readiness fails closed without configured Bulletin owner identity", () => {
  assert.deepEqual(readinessStatus({ browserRequired:true, browserStarted:true, persistenceRequired:true, persistenceAvailable:true, ownerActorRequired:true, ownerActorConfigured:false }), { ready:false, statusCode:503 });
});
test("production readiness passes when owner identity is configured", () => {
  assert.deepEqual(readinessStatus({ browserRequired:true, browserStarted:true, persistenceRequired:true, persistenceAvailable:true, ownerActorRequired:true, ownerActorConfigured:true }), { ready:true, statusCode:200 });
});
