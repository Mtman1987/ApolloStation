import test from "node:test";
import assert from "node:assert/strict";
import { readinessStatus } from "./readiness.mjs";

test("readiness fails when the required browser process has not started", () => {
  assert.deepEqual(readinessStatus({ browserRequired:true, browserStarted:false, ownerActorConfigured:true }), { ready:false, statusCode:503 });
});
test("readiness requires the owner actor pin even when optional dependencies are disabled", () => {
  assert.deepEqual(readinessStatus({ browserRequired:false, persistenceRequired:false, ownerActorConfigured:false }), { ready:false, statusCode:503 });
});
test("readiness ignores optional browser and persistence fallback when owner pin is configured", () => {
  assert.deepEqual(readinessStatus({ browserRequired:false, browserStarted:false, persistenceRequired:false, persistenceAvailable:false, ownerActorConfigured:true }), { ready:true, statusCode:200 });
});
test("readiness requires configured persistence when policy requires it", () => {
  assert.deepEqual(readinessStatus({ browserRequired:false, persistenceRequired:true, persistenceAvailable:false, ownerActorConfigured:true }), { ready:false, statusCode:503 });
});
test("readiness requires a configured Hostless cron with a recent completed tick", () => {
  assert.deepEqual(readinessStatus({ persistenceRequired:true, persistenceAvailable:true, ownerActorConfigured:true, hostlessCronRequired:true, hostlessCronConfigured:false }), { ready:false, statusCode:503 });
});
test("readiness passes when all production dependencies and cron proof are present", () => {
  assert.deepEqual(readinessStatus({ browserRequired:true, browserStarted:true, persistenceRequired:true, persistenceAvailable:true, ownerActorConfigured:true, hostlessCronRequired:true, hostlessCronConfigured:true }), { ready:true, statusCode:200 });
});
