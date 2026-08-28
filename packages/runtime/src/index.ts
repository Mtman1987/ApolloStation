import { assertRuntimePolicyV1, type FleetDecisionV1, type RuntimeObservationV1, type RuntimePolicyV1, type RuntimeStateV1 } from "@spmt/contracts";

export const CONFIG_CLASSES = ["secret", "public-runtime", "app-state", "local-debug"] as const;
export type ConfigClassV1 = (typeof CONFIG_CLASSES)[number];

export interface ConfigSpecV1 {
  key: string;
  class: ConfigClassV1;
  required?: boolean;
  defaultValue?: string;
  description?: string;
}

export interface ResolvedConfigV1 {
  key: string;
  class: ConfigClassV1;
  value?: string;
  source: "environment" | "default" | "missing";
}

export function resolveConfig(spec: ConfigSpecV1, source: Record<string, string | undefined>): ResolvedConfigV1 {
  if (spec.class === "secret" && spec.defaultValue !== undefined) {
    throw new Error(`Secret config ${spec.key} may not define a default value`);
  }
  const fromEnvironment = source[spec.key];
  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    return { key: spec.key, class: spec.class, value: fromEnvironment, source: "environment" };
  }
  if (spec.defaultValue !== undefined) {
    return { key: spec.key, class: spec.class, value: spec.defaultValue, source: "default" };
  }
  if (spec.required) throw new Error(`Required config ${spec.key} is missing`);
  return { key: spec.key, class: spec.class, source: "missing" };
}

export function describeConfig(config: ResolvedConfigV1) {
  return {
    key: config.key,
    class: config.class,
    source: config.source,
    value: config.class === "secret" && config.value !== undefined ? "[REDACTED]" : config.value,
  };
}

export type DependencyHealthV1 = "ready" | "degraded" | "unavailable";

export interface HealthDependencyV1 {
  name: string;
  state: DependencyHealthV1;
  detail?: string;
  checkedAt: string;
}

export interface HealthSnapshotV1 {
  live: true;
  state: RuntimeStateV1;
  dependencies: HealthDependencyV1[];
  checkedAt: string;
}

export class HealthRegistry {
  private readonly dependencies = new Map<string, HealthDependencyV1>();
  private draining = false;

  setDraining(draining = true) {
    this.draining = draining;
  }

  setDependency(name: string, state: DependencyHealthV1, detail?: string) {
    const dependency: HealthDependencyV1 = {
      name,
      state,
      checkedAt: new Date().toISOString(),
      ...(detail ? { detail } : {}),
    };
    this.dependencies.set(name, dependency);
    return dependency;
  }

  snapshot(): HealthSnapshotV1 {
    const dependencies = [...this.dependencies.values()].sort((a, b) => a.name.localeCompare(b.name));
    let state: RuntimeStateV1 = "ready";
    if (this.draining) state = "draining";
    else if (dependencies.some((item) => item.state === "unavailable")) state = "unavailable";
    else if (dependencies.some((item) => item.state === "degraded")) state = "degraded";
    return { live: true, state, dependencies, checkedAt: new Date().toISOString() };
  }
}

export interface CorrelationContextV1 {
  correlationId: string;
  tenantId?: string;
  appId: string;
  version: string;
}

export function createCorrelationId(now = Date.now(), random = Math.random()) {
  return `${now.toString(36)}-${Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36)}`;
}

export function createCorrelationContext(
  input: Omit<CorrelationContextV1, "correlationId"> & { correlationId?: string },
): CorrelationContextV1 {
  return {
    correlationId: input.correlationId || createCorrelationId(),
    appId: input.appId,
    version: input.version,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  };
}

const REDACT_KEY = /(?:authorization|password|secret|token|api[_-]?key|cookie)/i;

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, REDACT_KEY.test(key) ? "[REDACTED]" : item]));
}

export function createLogRecord(
  context: CorrelationContextV1,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
) {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    correlationId: context.correlationId,
    appId: context.appId,
    version: context.version,
    ...(context.tenantId ? { tenantId: context.tenantId } : {}),
    ...redactRecord(fields),
  };
}

export interface FleetReconcileOptionsV1 {
  now?: string;
  maximumSignalAgeSeconds?: number;
}

export function reconcileRuntimePolicy(policyInput: RuntimePolicyV1, observation: RuntimeObservationV1, options: FleetReconcileOptionsV1 = {}): FleetDecisionV1 {
  const policy = assertRuntimePolicyV1(policyInput);
  if (observation.schemaVersion !== 1 || observation.workloadId !== policy.workloadId) throw new Error("Runtime observation does not match policy");
  const now = options.now ?? new Date().toISOString();
  const signalAge = (Date.parse(now) - Date.parse(observation.observedAt)) / 1_000;
  if (!Number.isFinite(signalAge) || signalAge < 0) throw new Error("Runtime observation time is invalid");
  const stale = signalAge > (options.maximumSignalAgeSeconds ?? 90);
  let desired = policy.minimumCapacity;
  let reason = policy.class === "core" ? "maintain core minimum healthy capacity" : "no current demand";

  if (policy.executionTarget === "companion") return decision(policy, observation, observation.runningCapacity, "external", "Companion owns local capacity and may only be offered eligible jobs", now);
  if (observation.duplicateConsumers) return decision(policy, observation, observation.runningCapacity, "blocked", "duplicate consumer circuit breaker requires operator repair", now);
  if (observation.circuitBreakerOpen) return decision(policy, observation, Math.max(policy.minimumCapacity, Math.min(observation.runningCapacity, policy.maximumCapacity)), "blocked", "workload circuit breaker is open", now);
  if (stale && policy.class !== "core") return decision(policy, observation, Math.max(policy.minimumCapacity, Math.min(observation.runningCapacity, policy.maximumCapacity)), "blocked", "demand signals are stale; preserving bounded current capacity", now);

  const demand = demandUnits(policy, observation);
  if (demand > 0) {
    desired = Math.max(policy.minimumCapacity, Math.ceil(demand / policy.targetConcurrency));
    reason = `${policy.class} demand requires capacity`;
  }
  if (observation.oldestDemandSeconds >= policy.idleSeconds && demand === 0) desired = policy.minimumCapacity;
  if (policy.uniqueConsumer && desired > 0) desired = 1;
  desired = Math.max(policy.minimumCapacity, Math.min(desired, policy.maximumCapacity));

  const perMachineCost = observation.runningCapacity > 0 ? observation.estimatedHourlyCostUsd / observation.runningCapacity : 0;
  if (perMachineCost > 0 && desired * perMachineCost > policy.maximumHourlyCostUsd) {
    desired = Math.max(policy.minimumCapacity, Math.min(desired, Math.floor((policy.maximumHourlyCostUsd + Number.EPSILON * 16) / perMachineCost)));
    reason = "capacity limited by workload hourly cost ceiling";
  }
  if (desired > observation.runningCapacity) return decision(policy, observation, desired, observation.stoppedCapacity > 0 ? "start" : "create", reason, now);
  if (desired < observation.runningCapacity) {
    if (observation.activeLeases > 0 || observation.uncheckpointedWork || (policy.uniqueConsumer && observation.activeConnections > 0)) return decision(policy, observation, observation.runningCapacity, "blocked", "scale-down blocked until active leases, unique connections, and work drain", now);
    return decision(policy, observation, desired, "drain-stop", "idle capacity may drain and stop", now);
  }
  return decision(policy, observation, desired, "none", reason, now);
}

function demandUnits(policy: RuntimePolicyV1, observation: RuntimeObservationV1) {
  switch (policy.class) {
    case "core": return Math.max(policy.minimumCapacity, observation.activeRequests);
    case "elastic-http": return Math.max(observation.activeRequests, Math.ceil(observation.requestRate));
    case "queue-worker":
    case "heavy-job": return Math.max(observation.queueDepth, observation.activeLeases);
    case "bot-socket": return Math.max(observation.activeConnections, observation.activeLeases);
    case "room-session": return Math.max(observation.activeSessions, observation.activeLeases);
  }
}

function decision(policy: RuntimePolicyV1, observation: RuntimeObservationV1, desiredCapacity: number, action: FleetDecisionV1["action"], reason: string, decidedAt: string): FleetDecisionV1 {
  return { schemaVersion: 1, workloadId: policy.workloadId, generation: observation.generation, policyRevision: policy.revision, observedCapacity: observation.runningCapacity, desiredCapacity, action, reason, idempotencyKey: `${policy.workloadId}:${observation.generation}:${action}:${desiredCapacity}`, decidedAt, productionMutationAllowed: policy.productionMutationEnabled && action !== "blocked" && action !== "external" };
}
