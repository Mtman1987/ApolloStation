import {
  assertBillingManifestV1,
  type BillingManifestV1,
  type BillingPlanIdV1,
  type BillingPlanV1,
  type MeteredResourceV1,
  type PersonalUsageSummaryV1,
  type UsageDecisionV1,
  type UsageEventV1,
} from "@spmt/contracts";

const GAUGE_RESOURCES = new Set<MeteredResourceV1>(["workspaces", "connected-providers", "hosted-rooms", "storage-gb"]);

export interface UsageLedgerCommitV1 { duplicate: boolean; used: number; event: UsageEventV1; }
export interface UsageLedgerStoreV1 {
  find(tenantId: string, idempotencyKey: string): UsageEventV1 | undefined;
  total(tenantId: string, userId: string, period: string, resource: MeteredResourceV1, executionTarget: UsageEventV1["executionTarget"]): number;
  commit(event: UsageEventV1, limit: number | null): UsageLedgerCommitV1;
  list(tenantId: string, userId: string, period: string): UsageEventV1[];
}

export class UsageLimitError extends Error {
  constructor(readonly decision: UsageDecisionV1) { super(decision.reason); this.name = "UsageLimitError"; }
}

export class MemoryUsageLedgerStore implements UsageLedgerStoreV1 {
  private readonly events: UsageEventV1[] = [];
  find(tenantId: string, idempotencyKey: string) { return this.events.find((item) => item.tenantId === tenantId && item.idempotencyKey === idempotencyKey); }
  total(tenantId: string, userId: string, period: string, resource: MeteredResourceV1, executionTarget: UsageEventV1["executionTarget"]) {
    return Math.max(0, this.events.filter((item) => item.tenantId === tenantId && item.userId === userId && item.period === period && item.resource === resource && item.executionTarget === executionTarget).reduce((sum, item) => sum + signed(item), 0));
  }
  commit(event: UsageEventV1, limit: number | null) {
    const prior = this.find(event.tenantId, event.idempotencyKey);
    if (prior) { assertReplay(prior, event); return { duplicate: true, used: this.total(event.tenantId, event.userId, event.period, event.resource, event.executionTarget), event: prior }; }
    const used = this.total(event.tenantId, event.userId, event.period, event.resource, event.executionTarget);
    const next = Math.max(0, used + signed(event));
    if (limit !== null && next > limit) throw new Error("usage-limit-exceeded");
    this.events.push(structuredClone(event));
    return { duplicate: false, used: next, event: structuredClone(event) };
  }
  list(tenantId: string, userId: string, period: string) { return this.events.filter((item) => item.tenantId === tenantId && item.userId === userId && item.period === period).map((item) => structuredClone(item)); }
}

export interface UsageRequestV1 {
  tenantId: string;
  userId: string;
  planId: BillingPlanIdV1;
  resource: MeteredResourceV1;
  quantity: number;
  operation?: "consume" | "release";
  executionTarget: "hosted" | "companion";
  idempotencyKey: string;
  occurredAt?: string;
}

export class MonetizationService {
  readonly manifest: BillingManifestV1;
  private readonly plans: Map<BillingPlanIdV1, BillingPlanV1>;
  constructor(manifest: BillingManifestV1, private readonly store: UsageLedgerStoreV1, private readonly now: () => string = () => new Date().toISOString()) {
    this.manifest = structuredClone(assertBillingManifestV1(manifest));
    this.plans = new Map(this.manifest.plans.map((plan) => [plan.planId, plan]));
  }

  preflight(input: Omit<UsageRequestV1, "idempotencyKey">): UsageDecisionV1 {
    const event = this.event({ ...input, idempotencyKey: "preflight" });
    const plan = this.plan(event.planId);
    const used = this.store.total(event.tenantId, event.userId, event.period, event.resource, event.executionTarget);
    return decide(plan, event, used);
  }

  consume(input: UsageRequestV1): UsageDecisionV1 {
    const event = this.event(input);
    const plan = this.plan(event.planId);
    if (this.store.find(event.tenantId, event.idempotencyKey)) {
      const committed = this.store.commit(event, applicableLimit(plan, event));
      return { ...decide(plan, { ...event, quantity: 0, operation: "consume" }, committed.used), requested: signed(event) };
    }
    const before = this.store.total(event.tenantId, event.userId, event.period, event.resource, event.executionTarget);
    const decision = decide(plan, event, before);
    if (!decision.allowed) throw new UsageLimitError(decision);
    try {
      const committed = this.store.commit(event, applicableLimit(plan, event));
      return { ...decide(plan, { ...event, quantity: 0, operation: "consume" }, committed.used), requested: signed(event) };
    } catch (error) {
      if (error instanceof Error && error.message === "usage-limit-exceeded") throw new UsageLimitError(decide(plan, event, this.store.total(event.tenantId, event.userId, event.period, event.resource, event.executionTarget)));
      throw error;
    }
  }

  summary(tenantId: string, userId: string, planId: BillingPlanIdV1, at = this.now()): PersonalUsageSummaryV1 {
    const period = billingPeriod(at), plan = this.plan(planId);
    const resources = Object.keys(plan.limits).map((resource) => {
      const key = resource as MeteredResourceV1;
      const hosted = this.store.total(tenantId, userId, period, key, "hosted");
      const companion = this.store.total(tenantId, userId, period, key, "companion");
      const limit = plan.limits[key];
      return { resource: key, hosted, companion, limit, percent: limit === 0 ? 100 : Math.min(100, Math.round(hosted / limit * 100)), warning: warning(hosted, limit) };
    });
    return { schemaVersion: 1, userId, period, plan: { planId: plan.planId, name: plan.name, monthlyPriceUsd: plan.monthlyPriceUsd, companionLocalProcessing: plan.companionLocalProcessing }, resources };
  }

  private plan(planId: BillingPlanIdV1) { const plan = this.plans.get(planId); if (!plan) throw new Error("Unknown billing plan"); return plan; }
  private event(input: UsageRequestV1): UsageEventV1 {
    const occurredAt = input.occurredAt ?? this.now(), operation = input.operation ?? "consume";
    for (const value of [input.tenantId, input.userId, input.idempotencyKey]) if (!value || value.trim() !== value || value.length > 200) throw new Error("Usage identity is invalid");
    if (!Number.isFinite(Date.parse(occurredAt)) || !Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new Error("Usage quantity or time is invalid");
    if (operation === "release" && !GAUGE_RESOURCES.has(input.resource)) throw new Error("Counter usage cannot be released");
    return { schemaVersion: 1, tenantId: input.tenantId, userId: input.userId, planId: input.planId, period: billingPeriod(occurredAt), resource: input.resource, quantity: input.quantity, operation, executionTarget: input.executionTarget, idempotencyKey: input.idempotencyKey, occurredAt };
  }
}

export function billingPeriod(at: string) { const date = new Date(at); if (!Number.isFinite(date.getTime())) throw new Error("Billing period time is invalid"); return date.toISOString().slice(0, 7); }
function applicableLimit(plan: BillingPlanV1, event: UsageEventV1) { return event.executionTarget === "companion" && plan.companionLocalProcessing === "unmetered-local" ? null : plan.limits[event.resource]; }
function decide(plan: BillingPlanV1, event: UsageEventV1, used: number): UsageDecisionV1 {
  const limit = applicableLimit(plan, event), projected = Math.max(0, used + signed(event));
  const allowed = limit === null || projected <= limit;
  return { schemaVersion: 1, tenantId: event.tenantId, planId: plan.planId, period: event.period, resource: event.resource, executionTarget: event.executionTarget, allowed, used, requested: signed(event), limit, warning: limit === null ? 0 : warning(projected, limit), reason: allowed ? (limit === null ? "Companion-local processing does not consume hosted allowance" : "Usage is within the plan allowance") : `${plan.name} ${event.resource} allowance reached` };
}
function warning(used: number, limit: number): 0 | 70 | 90 | 100 { if (limit === 0 || used >= limit) return 100; const ratio = used / limit; return ratio >= 0.9 ? 90 : ratio >= 0.7 ? 70 : 0; }
function signed(event: UsageEventV1) { return event.operation === "release" ? -event.quantity : event.quantity; }
function assertReplay(prior: UsageEventV1, next: UsageEventV1) { if (JSON.stringify(prior) !== JSON.stringify(next)) throw new Error("Usage idempotency key was reused for a different event"); }
