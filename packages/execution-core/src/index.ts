import { createHash, randomBytes } from "node:crypto";
import {
  EXECUTION_JOB_STATES,
  METERED_RESOURCES,
  type BillingPlanIdV1,
  type ExecutionJobStateV1,
  type ExecutionJobV1,
  type ExecutionTargetV1,
  type ExecutionWorkerProjectionV1,
  type MeteredResourceV1,
  type RuntimeStateV1,
} from "@spmt/contracts";
import { MonetizationService, UsageLimitError } from "@spmt/monetization";

export interface ExecutionJobListOptionsV1 {
  ownerAppId?: string;
  executionOwner?: string;
  billedUserId?: string;
  state?: ExecutionJobStateV1;
  executionTarget?: ExecutionTargetV1;
  limit?: number;
}

export interface ExecutionJobStoreV1 {
  transaction<T>(work: () => T): T;
  getExecutionJob(id: string): ExecutionJobV1 | undefined;
  findExecutionJobByIdempotency(tenantId: string, ownerAppId: string, requestedById: string, idempotencyKey: string): ExecutionJobV1 | undefined;
  putExecutionJob(job: ExecutionJobV1): void;
  deleteExecutionJob(id: string): void;
  listExecutionJobs(tenantId: string, options?: ExecutionJobListOptionsV1): ExecutionJobV1[];
  listAllExecutionJobs(tenantId: string): ExecutionJobV1[];
  listExecutionJobTenants(options: { executionOwner: string; executionTarget: ExecutionTargetV1 }): string[];
}

export class MemoryExecutionJobStore implements ExecutionJobStoreV1 {
  private readonly jobs = new Map<string, ExecutionJobV1>();
  transaction<T>(work: () => T) { return work(); }
  getExecutionJob(id: string) { const value = this.jobs.get(id); return value ? clone(value) : undefined; }
  findExecutionJobByIdempotency(tenantId: string, ownerAppId: string, requestedById: string, idempotencyKey: string) { return this.values().find((job) => job.tenantId === tenantId && job.ownerAppId === ownerAppId && job.requestedById === requestedById && job.idempotencyKey === idempotencyKey); }
  putExecutionJob(job: ExecutionJobV1) { this.jobs.set(job.id, clone(job)); }
  deleteExecutionJob(id: string) { this.jobs.delete(id); }
  listExecutionJobs(tenantId: string, options: ExecutionJobListOptionsV1 = {}) { return filterJobs(this.values(), tenantId, options); }
  listAllExecutionJobs(tenantId: string) { return this.values().filter((job) => job.tenantId === tenantId).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)); }
  listExecutionJobTenants(options: { executionOwner: string; executionTarget: ExecutionTargetV1 }) { const oldest = new Map<string, string>(); for (const job of this.values()) { if (job.executionOwner !== options.executionOwner || job.executionTarget !== options.executionTarget || !["queued", "leased", "running"].includes(job.state)) continue; if (!oldest.has(job.tenantId) || job.createdAt < oldest.get(job.tenantId)!) oldest.set(job.tenantId, job.createdAt); } return [...oldest].sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0])).map(([tenantId]) => tenantId); }
  private values() { return [...this.jobs.values()].map(clone); }
}

export class ExecutionJobError extends Error {
  constructor(readonly code: "invalid" | "not_found" | "conflict" | "lease_lost" | "usage_limit", message: string) { super(message); this.name = "ExecutionJobError"; }
}

export interface CreateExecutionJobInputV1 {
  tenantId: string;
  ownerAppId: string;
  capabilityId: string;
  executionOwner: string;
  requestedByType: "user" | "service";
  requestedById: string;
  billedUserId: string;
  meteredResource: MeteredResourceV1;
  usageQuantity: number;
  executionTarget: ExecutionTargetV1;
  meteringTarget: "hosted" | "companion";
  idempotencyKey: string;
  input: Record<string, unknown>;
  correlationId?: string;
}

export interface ExecutionJobServiceOptionsV1 {
  store: ExecutionJobStoreV1;
  usage: MonetizationService;
  resolvePlan: (tenantId: string) => BillingPlanIdV1;
  now?: () => string;
  idFactory?: () => string;
  maximumAttempts?: number;
  onTransition?: (job: ExecutionJobV1, previousState?: ExecutionJobStateV1) => void;
}

export class ExecutionJobService {
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly maximumAttempts: number;
  private readonly workers = new Map<string, ExecutionWorkerProjectionV1>();
  constructor(private readonly options: ExecutionJobServiceOptionsV1) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `job_${randomBytes(12).toString("hex")}`);
    this.maximumAttempts = Math.max(1, Math.min(20, options.maximumAttempts ?? 3));
  }

  create(input: CreateExecutionJobInputV1): { duplicate: boolean; job: ExecutionJobV1 } {
    const normalized = normalizeCreate(input);
    const existing = this.options.store.findExecutionJobByIdempotency(normalized.tenantId, normalized.ownerAppId, normalized.requestedById, normalized.idempotencyKey);
    if (existing) {
      if (JSON.stringify(comparable(existing)) !== JSON.stringify(comparable(normalized))) throw new ExecutionJobError("conflict", "Execution job idempotency key was reused with different input");
      return { duplicate: true, job: existing };
    }
    const planId = this.options.resolvePlan(normalized.tenantId);
    const decision = this.options.usage.preflight({ tenantId: normalized.tenantId, userId: normalized.billedUserId, planId, resource: normalized.meteredResource, quantity: normalized.usageQuantity, executionTarget: normalized.meteringTarget });
    if (!decision.allowed) throw new ExecutionJobError("usage_limit", decision.reason);
    const now = timestamp(this.now(), "job clock");
    const job: ExecutionJobV1 = { schemaVersion: 1, id: identifier(this.idFactory(), "job id"), ...normalized, planId, state: "queued", attempt: 0, fencingEpoch: 0, createdAt: now, updatedAt: now };
    this.options.store.transaction(() => {
      const raced = this.options.store.findExecutionJobByIdempotency(job.tenantId, job.ownerAppId, job.requestedById, job.idempotencyKey);
      if (raced) throw new ExecutionJobError("conflict", "Execution job was created concurrently; retry the same request");
      this.options.store.putExecutionJob(job);
    });
    try {
      this.options.usage.consume({ tenantId: job.tenantId, userId: job.billedUserId, planId, resource: job.meteredResource, quantity: job.usageQuantity, executionTarget: job.meteringTarget, idempotencyKey: `execution:${job.id}`, occurredAt: now });
    } catch (error) {
      const failed: ExecutionJobV1 = { ...job, state: "failed", error: { code: "usage-limit", message: error instanceof Error ? error.message : "Usage allowance was reached", retryable: false }, completedAt: now, updatedAt: now };
      this.options.store.putExecutionJob(failed);
      this.emit(failed, "queued");
      if (error instanceof UsageLimitError) throw new ExecutionJobError("usage_limit", error.message);
      throw error;
    }
    this.emit(job);
    return { duplicate: false, job: clone(job) };
  }

  get(tenantId: string, jobId: string) { const job = this.options.store.getExecutionJob(identifier(jobId, "jobId")); if (!job || job.tenantId !== identifier(tenantId, "tenantId")) throw new ExecutionJobError("not_found", "Execution job was not found"); return job; }
  findIdempotent(tenantId: string, ownerAppId: string, requestedById: string, idempotencyKey: string) { return this.options.store.findExecutionJobByIdempotency(identifier(tenantId, "tenantId"), identifier(ownerAppId, "ownerAppId"), identifier(requestedById, "requestedById"), boundedText(idempotencyKey, "idempotencyKey", 300)); }
  list(tenantId: string, options: ExecutionJobListOptionsV1 = {}) { return this.options.store.listExecutionJobs(identifier(tenantId, "tenantId"), normalizeList(options)); }
  listForMaintenance(tenantId: string, options: Omit<ExecutionJobListOptionsV1, "limit"> = {}) { const normalizedTenant = identifier(tenantId, "tenantId"), normalized = normalizeList(options); return filterJobs(this.options.store.listAllExecutionJobs(normalizedTenant), normalizedTenant, { ...normalized, limit: Number.MAX_SAFE_INTEGER }); }

  redactPayloads(tenantId: string, jobId: string, input: Record<string, unknown>, result?: Record<string, unknown>) {
    return this.options.store.transaction(() => {
      const current = this.get(tenantId, jobId);
      if (!["succeeded", "failed", "cancelled", "dead-letter"].includes(current.state)) throw new ExecutionJobError("conflict", "Only terminal execution jobs may be content-minimized");
      const { result: _previousResult, ...withoutResult } = current;
      const next: ExecutionJobV1 = { ...withoutResult, input: safeObject(input, "input"), ...(result === undefined ? {} : { result: safeObject(result, "result") }), updatedAt: timestamp(this.now(), "job clock") };
      this.options.store.putExecutionJob(next);
      return clone(next);
    });
  }

  delete(tenantId: string, jobId: string) {
    return this.options.store.transaction(() => {
      const current = this.get(tenantId, jobId);
      if (!["succeeded", "failed", "cancelled", "dead-letter"].includes(current.state)) throw new ExecutionJobError("conflict", "Only terminal execution jobs may be deleted");
      this.options.store.deleteExecutionJob(current.id);
      return current;
    });
  }

  reportWorker(input: {
    executionOwner: string;
    workerId: string;
    executionTarget: ExecutionTargetV1;
    state: RuntimeStateV1;
    capabilityIds: string[];
    tenantIds?: string[];
    providerHealthy: boolean;
    startedAt: string;
    leaseMs?: number;
    metrics: ExecutionWorkerProjectionV1["metrics"];
  }) {
    const now = timestamp(this.now(), "worker clock");
    const leaseMs = boundedInteger(input.leaseMs ?? 30_000, "leaseMs", 5_000, 120_000);
    const projection: ExecutionWorkerProjectionV1 = {
      schemaVersion: 1,
      executionOwner: identifier(input.executionOwner, "executionOwner"),
      workerId: identifier(input.workerId, "workerId"),
      executionTarget: target(input.executionTarget),
      state: runtimeState(input.state),
      capabilityIds: uniqueIdentifiers(input.capabilityIds, "capabilityId"),
      ...(input.tenantIds ? { tenantIds: uniqueIdentifiers(input.tenantIds, "tenantId") } : {}),
      providerHealthy: strictBoolean(input.providerHealthy, "providerHealthy"),
      startedAt: timestamp(input.startedAt, "startedAt"),
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
      metrics: workerMetrics(input.metrics),
    };
    this.workers.set(`${projection.executionOwner}\0${projection.workerId}`, clone(projection));
    return clone(projection);
  }

  listWorkers(options: { executionOwner?: string; executionTarget?: ExecutionTargetV1; capabilityId?: string; tenantId?: string; freshOnly?: boolean } = {}) {
    const now = Date.parse(timestamp(this.now(), "worker clock"));
    return [...this.workers.values()].filter((worker) =>
      (!options.executionOwner || worker.executionOwner === options.executionOwner) &&
      (!options.executionTarget || worker.executionTarget === options.executionTarget) &&
      (!options.capabilityId || worker.capabilityIds.includes(options.capabilityId)) &&
      (!options.tenantId || !worker.tenantIds || worker.tenantIds.includes(options.tenantId)) &&
      (options.freshOnly === false || Date.parse(worker.leaseExpiresAt) > now)
    ).sort((left, right) => left.workerId.localeCompare(right.workerId)).map(clone);
  }

  hasReadyWorker(input: { executionOwner: string; executionTarget: ExecutionTargetV1; capabilityId: string; tenantId?: string }) {
    return this.listWorkers({ ...input, freshOnly: true }).some((worker) => worker.state === "ready" && worker.providerHealthy);
  }

  claim(input: { tenantId: string; executionOwner: string; workerId: string; executionTarget: ExecutionTargetV1; capabilityIds?: string[]; leaseMs?: number }): ExecutionJobV1 | undefined {
    const tenantId = identifier(input.tenantId, "tenantId"), executionOwner = identifier(input.executionOwner, "executionOwner"), workerId = identifier(input.workerId, "workerId"), executionTarget = target(input.executionTarget);
    const capabilities = input.capabilityIds?.map((value) => identifier(value, "capabilityId"));
    const leaseMs = boundedInteger(input.leaseMs ?? 30_000, "leaseMs", 5_000, 3_600_000);
    return this.options.store.transaction(() => {
      this.requeueExpired(tenantId, executionOwner, executionTarget);
      const candidate = this.options.store.listExecutionJobs(tenantId, { executionOwner, executionTarget, state: "queued", limit: 200 }).find((job) => !capabilities?.length || capabilities.includes(job.capabilityId));
      if (!candidate) return undefined;
      const now = timestamp(this.now(), "job clock");
      const claimed: ExecutionJobV1 = { ...candidate, state: "leased", attempt: candidate.attempt + 1, fencingEpoch: candidate.fencingEpoch + 1, leaseId: `lease_${randomBytes(12).toString("hex")}`, leaseOwner: workerId, leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now };
      this.options.store.putExecutionJob(claimed); this.emit(claimed, candidate.state); return clone(claimed);
    });
  }

  claimAny(input: { executionOwner: string; workerId: string; executionTarget: ExecutionTargetV1; tenantIds?: string[]; capabilityIds?: string[]; leaseMs?: number }): ExecutionJobV1 | undefined {
    const executionOwner = identifier(input.executionOwner, "executionOwner"), executionTarget = target(input.executionTarget);
    const allowedTenants = input.tenantIds?.map((value) => identifier(value, "tenantId"));
    const tenants = this.options.store.listExecutionJobTenants({ executionOwner, executionTarget }).filter((tenantId) => !allowedTenants || allowedTenants.includes(tenantId));
    for (const tenantId of tenants) {
      const claimed = this.claim({ tenantId, executionOwner, workerId: input.workerId, executionTarget, ...(input.capabilityIds ? { capabilityIds: input.capabilityIds } : {}), ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }) });
      if (claimed) return claimed;
    }
    return undefined;
  }

  heartbeat(input: { tenantId: string; jobId: string; workerId: string; leaseId: string; fencingEpoch: number; leaseMs?: number; progress?: { percent: number; message?: string } }): ExecutionJobV1 {
    return this.options.store.transaction(() => {
      const current = this.requireLease(input), now = timestamp(this.now(), "job clock"), leaseMs = boundedInteger(input.leaseMs ?? 30_000, "leaseMs", 5_000, 3_600_000);
      const progress = input.progress ? { percent: boundedNumber(input.progress.percent, "progress.percent", 0, 100), ...(input.progress.message ? { message: boundedText(input.progress.message, "progress.message", 500) } : {}), updatedAt: now } : current.progress;
      const next: ExecutionJobV1 = { ...current, state: "running", leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(), ...(progress ? { progress } : {}), ...(current.startedAt ? {} : { startedAt: now }), updatedAt: now };
      this.options.store.putExecutionJob(next); this.emit(next, current.state); return clone(next);
    });
  }

  succeed(input: { tenantId: string; jobId: string; workerId: string; leaseId: string; fencingEpoch: number; result: Record<string, unknown> }): ExecutionJobV1 {
    return this.options.store.transaction(() => { const current = this.requireLease(input), now = timestamp(this.now(), "job clock"); const next = withoutLease({ ...current, state: "succeeded", result: safeObject(input.result, "result"), progress: { percent: 100, message: "Completed", updatedAt: now }, completedAt: now, updatedAt: now }); this.options.store.putExecutionJob(next); this.emit(next, current.state); return clone(next); });
  }

  fail(input: { tenantId: string; jobId: string; workerId: string; leaseId: string; fencingEpoch: number; code: string; message: string; retryable: boolean }): ExecutionJobV1 {
    return this.options.store.transaction(() => { const current = this.requireLease(input), now = timestamp(this.now(), "job clock"), retry = input.retryable && current.attempt < this.maximumAttempts; const state: ExecutionJobStateV1 = retry ? "queued" : input.retryable ? "dead-letter" : "failed"; const next = withoutLease({ ...current, state, error: { code: identifier(input.code, "error code"), message: boundedText(input.message, "error message", 1000), retryable: input.retryable }, ...(retry ? {} : { completedAt: now }), updatedAt: now }); this.options.store.putExecutionJob(next); this.emit(next, current.state); return clone(next); });
  }

  cancel(tenantId: string, jobId: string): ExecutionJobV1 {
    return this.options.store.transaction(() => { const current = this.get(tenantId, jobId); if (["succeeded", "failed", "cancelled", "dead-letter"].includes(current.state)) return current; const now = timestamp(this.now(), "job clock"), next = withoutLease({ ...current, state: "cancelled", completedAt: now, updatedAt: now }); this.options.store.putExecutionJob(next); this.emit(next, current.state); return clone(next); });
  }

  private requireLease(input: { tenantId: string; jobId: string; workerId: string; leaseId: string; fencingEpoch: number }) { const current = this.get(input.tenantId, input.jobId); if ((current.state !== "leased" && current.state !== "running") || current.leaseOwner !== identifier(input.workerId, "workerId") || current.leaseId !== identifier(input.leaseId, "leaseId") || current.fencingEpoch !== boundedInteger(input.fencingEpoch, "fencingEpoch", 1, Number.MAX_SAFE_INTEGER) || !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) <= Date.parse(timestamp(this.now(), "job clock"))) throw new ExecutionJobError("lease_lost", "Execution job lease is stale or belongs to another worker"); return current; }
  private requeueExpired(tenantId: string, executionOwner: string, executionTarget: ExecutionTargetV1) { const now = timestamp(this.now(), "job clock"); for (const current of this.options.store.listExecutionJobs(tenantId, { executionOwner, executionTarget, limit: 500 })) { if ((current.state !== "leased" && current.state !== "running") || !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) > Date.parse(now)) continue; const state: ExecutionJobStateV1 = current.attempt >= this.maximumAttempts ? "dead-letter" : "queued"; const next = withoutLease({ ...current, state, error: { code: "lease-expired", message: "Worker lease expired before completion", retryable: true }, ...(state === "dead-letter" ? { completedAt: now } : {}), updatedAt: now }); this.options.store.putExecutionJob(next); this.emit(next, current.state); } }
  private emit(job: ExecutionJobV1, previousState?: ExecutionJobStateV1) { this.options.onTransition?.(clone(job), previousState); }
}

function normalizeCreate(input: CreateExecutionJobInputV1): Omit<ExecutionJobV1, "schemaVersion" | "id" | "planId" | "state" | "attempt" | "fencingEpoch" | "createdAt" | "updatedAt"> { return { tenantId: identifier(input.tenantId, "tenantId"), ownerAppId: identifier(input.ownerAppId, "ownerAppId"), capabilityId: identifier(input.capabilityId, "capabilityId"), executionOwner: identifier(input.executionOwner, "executionOwner"), requestedByType: input.requestedByType === "user" || input.requestedByType === "service" ? input.requestedByType : invalid("requestedByType"), requestedById: identifier(input.requestedById, "requestedById"), billedUserId: identifier(input.billedUserId, "billedUserId"), meteredResource: meter(input.meteredResource), usageQuantity: boundedInteger(input.usageQuantity, "usageQuantity", 1, 1_000_000), executionTarget: target(input.executionTarget), meteringTarget: meteringTarget(input.meteringTarget), idempotencyKey: boundedText(input.idempotencyKey, "idempotencyKey", 300), input: safeObject(input.input, "input"), ...(input.correlationId ? { correlationId: identifier(input.correlationId, "correlationId") } : {}) }; }
function normalizeList(options: ExecutionJobListOptionsV1): ExecutionJobListOptionsV1 { return { ...(options.ownerAppId ? { ownerAppId: identifier(options.ownerAppId, "ownerAppId") } : {}), ...(options.executionOwner ? { executionOwner: identifier(options.executionOwner, "executionOwner") } : {}), ...(options.billedUserId ? { billedUserId: identifier(options.billedUserId, "billedUserId") } : {}), ...(options.state ? { state: state(options.state) } : {}), ...(options.executionTarget ? { executionTarget: target(options.executionTarget) } : {}), ...(options.limit === undefined ? {} : { limit: boundedInteger(options.limit, "limit", 1, 500) }) }; }
function filterJobs(values: ExecutionJobV1[], tenantId: string, options: ExecutionJobListOptionsV1) { return values.filter((job) => job.tenantId === tenantId && (!options.ownerAppId || job.ownerAppId === options.ownerAppId) && (!options.executionOwner || job.executionOwner === options.executionOwner) && (!options.billedUserId || job.billedUserId === options.billedUserId) && (!options.state || job.state === options.state) && (!options.executionTarget || job.executionTarget === options.executionTarget)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, options.limit ?? 100).map(clone); }
function comparable(value: Partial<ExecutionJobV1>) { return { tenantId: value.tenantId, ownerAppId: value.ownerAppId, capabilityId: value.capabilityId, executionOwner: value.executionOwner, requestedByType: value.requestedByType, requestedById: value.requestedById, billedUserId: value.billedUserId, meteredResource: value.meteredResource, usageQuantity: value.usageQuantity, executionTarget: value.executionTarget, meteringTarget: value.meteringTarget, idempotencyKey: value.idempotencyKey, input: value.input, correlationId: value.correlationId }; }
function withoutLease(job: ExecutionJobV1): ExecutionJobV1 { const { leaseId: _leaseId, leaseOwner: _leaseOwner, leaseExpiresAt: _leaseExpiresAt, ...rest } = job; return rest; }
function identifier(value: unknown, name: string) { if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,200}$/.test(value)) throw new ExecutionJobError("invalid", `${name} is invalid`); return value; }
function boundedText(value: unknown, name: string, maximum: number) { if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > maximum) throw new ExecutionJobError("invalid", `${name} is invalid`); return value; }
function boundedInteger(value: unknown, name: string, minimum: number, maximum: number) { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new ExecutionJobError("invalid", `${name} is invalid`); return value as number; }
function boundedNumber(value: unknown, name: string, minimum: number, maximum: number) { if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new ExecutionJobError("invalid", `${name} is invalid`); return value; }
function strictBoolean(value: unknown, name: string) { if (typeof value !== "boolean") throw new ExecutionJobError("invalid", `${name} is invalid`); return value; }
function target(value: unknown): ExecutionTargetV1 { if (value !== "sprite" && value !== "fly" && value !== "companion") throw new ExecutionJobError("invalid", "executionTarget is invalid"); return value; }
function meteringTarget(value: unknown): "hosted" | "companion" { if (value !== "hosted" && value !== "companion") throw new ExecutionJobError("invalid", "meteringTarget is invalid"); return value; }
function state(value: unknown): ExecutionJobStateV1 { if (typeof value !== "string" || !(EXECUTION_JOB_STATES as readonly string[]).includes(value)) throw new ExecutionJobError("invalid", "state is invalid"); return value as ExecutionJobStateV1; }
function meter(value: unknown): MeteredResourceV1 { if (typeof value !== "string" || !(METERED_RESOURCES as readonly string[]).includes(value)) throw new ExecutionJobError("invalid", "meteredResource is invalid"); return value as MeteredResourceV1; }
function runtimeState(value: unknown): RuntimeStateV1 { if (value !== "starting" && value !== "ready" && value !== "degraded" && value !== "draining" && value !== "unavailable") throw new ExecutionJobError("invalid", "worker state is invalid"); return value; }
function uniqueIdentifiers(values: string[], name: string) { if (!Array.isArray(values) || values.length < 1 || values.length > 100) throw new ExecutionJobError("invalid", `${name} list is invalid`); return [...new Set(values.map((value) => identifier(value, name)))].sort(); }
function workerMetrics(value: ExecutionWorkerProjectionV1["metrics"]): ExecutionWorkerProjectionV1["metrics"] { if (!value || typeof value !== "object") throw new ExecutionJobError("invalid", "worker metrics are invalid"); const count = (item: unknown, name: string) => boundedInteger(item, name, 0, Number.MAX_SAFE_INTEGER); const optional = (item: unknown, name: string) => item === undefined ? undefined : boundedNumber(item, name, 0, Number.MAX_SAFE_INTEGER); const coldStartMs=optional(value.coldStartMs,"coldStartMs"),lastLatencyMs=optional(value.lastLatencyMs,"lastLatencyMs"),throughputUnitsPerSecond=optional(value.throughputUnitsPerSecond,"throughputUnitsPerSecond"),memoryRssBytes=optional(value.memoryRssBytes,"memoryRssBytes"); return { completedJobs: count(value.completedJobs, "completedJobs"), failedJobs: count(value.failedJobs, "failedJobs"), inputUnits: count(value.inputUnits, "inputUnits"), outputUnits: count(value.outputUnits, "outputUnits"), ...(coldStartMs === undefined ? {} : { coldStartMs }), ...(lastLatencyMs === undefined ? {} : { lastLatencyMs }), ...(throughputUnitsPerSecond === undefined ? {} : { throughputUnitsPerSecond }), ...(memoryRssBytes === undefined ? {} : { memoryRssBytes }) }; }
function timestamp(value: string, name: string) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new ExecutionJobError("invalid", `${name} is invalid`); return new Date(parsed).toISOString(); }
function invalid(name: string): never { throw new ExecutionJobError("invalid", `${name} is invalid`); }
function safeObject(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExecutionJobError("invalid", `${name} must be an object`); const copy = structuredClone(value) as Record<string, unknown>; inspectPayload(copy, name, 0); if (Buffer.byteLength(JSON.stringify(copy), "utf8") > 64 * 1024) throw new ExecutionJobError("invalid", `${name} is too large`); return copy; }
function inspectPayload(value: unknown, path: string, depth: number): void { if (depth > 8) throw new ExecutionJobError("invalid", `${path} is nested too deeply`); if (value === null || typeof value === "boolean" || typeof value === "number") return; if (typeof value === "string") { if (value.length > 16_000) throw new ExecutionJobError("invalid", `${path} contains oversized text`); return; } if (Array.isArray(value)) { if (value.length > 500) throw new ExecutionJobError("invalid", `${path} contains too many items`); value.forEach((item, index) => inspectPayload(item, `${path}[${index}]`, depth + 1)); return; } if (typeof value !== "object") throw new ExecutionJobError("invalid", `${path} contains unsupported data`); for (const [key, item] of Object.entries(value as Record<string, unknown>)) { if (/authorization|credential|password|secret|token|private.?key/i.test(key)) throw new ExecutionJobError("invalid", `${path}.${key} must use the provider-grant or secret-storage contract`); inspectPayload(item, `${path}.${key}`, depth + 1); } }
function clone<T>(value: T): T { return structuredClone(value); }
export function executionJobIdempotencyDigest(tenantId: string, ownerAppId: string, requestedById: string, key: string) { return createHash("sha256").update(`${tenantId}\0${ownerAppId}\0${requestedById}\0${key}`).digest("hex"); }
