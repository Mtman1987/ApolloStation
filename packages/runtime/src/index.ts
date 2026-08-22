import type { RuntimeStateV1 } from "@spmt/contracts";

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
