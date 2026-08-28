import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertBillingManifestV1 } from "../packages/contracts/dist/index.js";
import { MemoryUsageLedgerStore, MonetizationService, UsageLimitError } from "../packages/monetization/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";

const at = "2026-08-28T12:00:00.000Z";
const manifest = () => assertBillingManifestV1(JSON.parse(readFileSync(new URL("../config/billing-plans.v1.json", import.meta.url), "utf8")));
const service = (store = new MemoryUsageLedgerStore()) => new MonetizationService(manifest(), store, () => at);

test("canonical billing manifest keeps approved affordable prices and launch caps in one file", () => {
  const plans = manifest().plans;
  assert.deepEqual(plans.map((plan) => [plan.planId, plan.monthlyPriceUsd]), [["free", 0], ["creator", 5], ["pro", 12], ["agency", 29]]);
  assert.equal(plans.find((plan) => plan.planId === "free").limits["premium-ai-requests"], 25);
  assert.equal(plans.find((plan) => plan.planId === "agency").limits["xbox-session-minutes"], 2100);
});

test("preflight blocks work before a hard cap and consumption is replay safe", () => {
  const usage = service();
  const base = { tenantId: "tenant-a", planId: "free", resource: "premium-ai-requests", executionTarget: "hosted", occurredAt: at };
  const first = usage.consume({ ...base, quantity: 25, idempotencyKey: "ai-1" });
  assert.equal(first.warning, 100);
  assert.equal(usage.consume({ ...base, quantity: 25, idempotencyKey: "ai-1" }).used, 25);
  assert.equal(usage.preflight({ ...base, quantity: 1 }).allowed, false);
  assert.throws(() => usage.consume({ ...base, quantity: 1, idempotencyKey: "ai-2" }), UsageLimitError);
});

test("warning thresholds fire at 70, 90, and 100 percent", () => {
  const usage = service();
  const base = { tenantId: "tenant-a", planId: "creator", resource: "hosted-worker-minutes", executionTarget: "hosted", occurredAt: at };
  assert.equal(usage.consume({ ...base, quantity: 210, idempotencyKey: "w-70" }).warning, 70);
  assert.equal(usage.consume({ ...base, quantity: 60, idempotencyKey: "w-90" }).warning, 90);
  assert.equal(usage.consume({ ...base, quantity: 30, idempotencyKey: "w-100" }).warning, 100);
});

test("paid Companion work is unmetered locally but Free remains fair-use bounded", () => {
  const usage = service();
  const paid = { tenantId: "paid", planId: "creator", resource: "hosted-worker-minutes", executionTarget: "companion", occurredAt: at };
  assert.equal(usage.consume({ ...paid, quantity: 10_000, idempotencyKey: "local-paid" }).limit, null);
  assert.equal(usage.summary("paid", "creator", at)["hosted-worker-minutes"].companion, 10_000);
  const free = { ...paid, tenantId: "free", planId: "free" };
  assert.throws(() => usage.consume({ ...free, quantity: 31, idempotencyKey: "local-free" }), UsageLimitError);
});

test("gauge allocations can be released while monthly counters cannot", () => {
  const usage = service();
  const base = { tenantId: "tenant-a", planId: "creator", resource: "connected-providers", executionTarget: "hosted", occurredAt: at };
  usage.consume({ ...base, quantity: 3, idempotencyKey: "providers-add" });
  usage.consume({ ...base, quantity: 1, operation: "release", idempotencyKey: "providers-remove" });
  assert.equal(usage.summary("tenant-a", "creator", at)["connected-providers"].hosted, 2);
  assert.throws(() => usage.consume({ ...base, resource: "hosted-voice-minutes", quantity: 1, operation: "release", idempotencyKey: "bad-release" }), /cannot be released/);
});

test("SQLite usage ledger persists, isolates tenants, and rejects conflicting replays", () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-usage-")), path = join(dir, "authority.sqlite");
  try {
    let store = new SqliteAuthorityStore(path), usage = service(store);
    const event = { tenantId: "tenant-a", planId: "pro", resource: "hosted-voice-minutes", executionTarget: "hosted", quantity: 20, occurredAt: at, idempotencyKey: "voice-1" };
    usage.consume(event); store.close();
    store = new SqliteAuthorityStore(path); usage = service(store);
    assert.equal(usage.summary("tenant-a", "pro", at)["hosted-voice-minutes"].hosted, 20);
    assert.equal(usage.summary("tenant-b", "pro", at)["hosted-voice-minutes"].hosted, 0);
    assert.throws(() => usage.consume({ ...event, quantity: 21 }), /reused for a different event/);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
