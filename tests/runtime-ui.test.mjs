import assert from "node:assert/strict";
import test from "node:test";
import { effectiveShellTopInset, usableShellRect } from "../packages/embed/dist/index.js";
import { SHARED_SURFACE_CSS, portalLayer } from "../packages/ui/dist/index.js";
import { HealthRegistry, createCorrelationContext, createLogRecord, describeConfig, resolveConfig } from "../packages/runtime/dist/index.js";

const layout = {
  schemaVersion: 1,
  headerHeight: 132,
  safeTop: 24,
  safeRight: 10,
  safeBottom: 18,
  safeLeft: 8,
  availableWidth: 430,
  availableHeight: 932,
  measuredAt: "2026-08-21T00:00:00.000Z",
};

test("shell mode reserves a wrapped header while overlay mode does not", () => {
  assert.equal(effectiveShellTopInset("shell", layout), 156);
  assert.equal(effectiveShellTopInset("overlay", layout), 24);
  assert.equal(usableShellRect("shell", layout).height, 758);
  assert.equal(usableShellRect("overlay", layout).height, 890);
});

test("shared CSS binds sidebars and portals to the canonical shell inset", () => {
  assert.match(SHARED_SURFACE_CSS, /--spmt-shell-top-inset/);
  assert.match(SHARED_SURFACE_CSS, /\.spmt-sidebar/);
  assert.match(SHARED_SURFACE_CSS, /\.spmt-portal-root/);
  assert.equal(portalLayer("modal"), 400);
  assert.equal(portalLayer("toast"), 500);
});

test("config classification forbids secret defaults and redacts secret output", () => {
  assert.throws(() => resolveConfig({ key: "TOKEN", class: "secret", defaultValue: "bad" }, {}));
  const resolved = resolveConfig({ key: "TOKEN", class: "secret", required: true }, { TOKEN: "real-secret" });
  assert.equal(describeConfig(resolved).value, "[REDACTED]");
});

test("health registry reports degraded/unavailable/draining honestly", () => {
  const health = new HealthRegistry();
  health.setDependency("spmt", "ready");
  assert.equal(health.snapshot().state, "ready");
  health.setDependency("events", "degraded", "lagging");
  assert.equal(health.snapshot().state, "degraded");
  health.setDependency("storage", "unavailable");
  assert.equal(health.snapshot().state, "unavailable");
  health.setDraining();
  assert.equal(health.snapshot().state, "draining");
});

test("structured logging carries correlation and redacts sensitive fields", () => {
  const context = createCorrelationContext({ correlationId: "corr-1", tenantId: "tenant-a", appId: "reference", version: "1" });
  const record = createLogRecord(context, "info", "request.complete", { token: "secret", outcome: "ok" });
  assert.equal(record.correlationId, "corr-1");
  assert.equal(record.tenantId, "tenant-a");
  assert.equal(record.token, "[REDACTED]");
  assert.equal(record.outcome, "ok");
});
