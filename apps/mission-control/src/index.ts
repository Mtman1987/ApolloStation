import { assertAppModuleManifestV1, BILLING_PLAN_IDS, METERED_RESOURCES, type AppCatalogRegistrationV1, type AppModuleManifestV1, type BillingPlanIdV1, type FleetProjectionV1, type MeteredResourceV1 } from "@spmt/contracts";

export const manifest = assertAppModuleManifestV1({
  schemaVersion: 1,
  manifestVersion: "spmt.app-manifest/v1",
  id: "mission-control",
  name: "Mission Control",
  description: "Owner-scoped operational evidence, Rotator fleet controls, Coder jobs, approvals, checkpoints, and deployments.",
  capabilities: ["operations", "rotator", "coder", "evidence", "approvals", "checkpoints", "deployments"],
  surfaces: ["shell", "standalone"],
  requiredScopes: ["operations:logs:read", "operations:coder:read", "operations:coder:invoke"],
  eventTypes: ["operations.coder.job.created.v1", "operations.coder.job.completed.v1"],
  integration: { identity: "connected", events: "connected", operations: "native", rotator: "declared" },
  workers: [],
} satisfies AppModuleManifestV1);

export function missionControlCatalogRegistration(publicOrigin: string): AppCatalogRegistrationV1 {
  const origin = catalogOrigin(publicOrigin, "Mission Control");
  return {
    appId: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: "0.1.0-green",
    launchUrl: new URL("/apps/mission-control?surface=workspace", origin).toString(),
    allowedScopes: [...manifest.requiredScopes],
    surfaces: ["shell", "standalone"],
    status: "active",
  };
}

export interface MissionControlFleetViewV1 {
  schemaVersion: 1;
  totalWorkloads: number;
  ready: number;
  dryRun: number;
  blocked: number;
  changing: number;
  runningCapacity: number;
  desiredCapacity: number;
  productionMutationEnabled: number;
  workloads: FleetProjectionV1[];
}

export function missionControlFleetView(projections: FleetProjectionV1[]): MissionControlFleetViewV1 {
  const workloads = [...projections].sort((a, b) => a.workloadId.localeCompare(b.workloadId));
  return {
    schemaVersion: 1,
    totalWorkloads: workloads.length,
    ready: workloads.filter((item) => item.state === "verified" || item.state === "observed").length,
    dryRun: workloads.filter((item) => item.state === "dry-run").length,
    blocked: workloads.filter((item) => item.state === "blocked" || item.state === "rolled-back").length,
    changing: workloads.filter((item) => item.state === "applying").length,
    runningCapacity: workloads.reduce((sum, item) => sum + item.healthyCapacity, 0),
    desiredCapacity: workloads.reduce((sum, item) => sum + item.desiredCapacity, 0),
    productionMutationEnabled: workloads.filter((item) => item.productionMutationAllowed).length,
    workloads,
  };
}

export interface MissionControlTenantUsageV1 {
  planId: BillingPlanIdV1;
  monthlyPriceUsd: number;
  resources: Record<MeteredResourceV1, { hosted: number; companion: number; limit: number; warning: 0 | 70 | 90 | 100 }>;
}
export interface MissionControlMonetizationViewV1 {
  schemaVersion: 1;
  totalTenants: number;
  monthlyRecurringRevenueUsd: number;
  planCounts: Record<BillingPlanIdV1, number>;
  warning70: number;
  warning90: number;
  exhausted: number;
  hostedUsage: Record<MeteredResourceV1, number>;
  companionUsage: Record<MeteredResourceV1, number>;
}

export function missionControlMonetizationView(tenants: MissionControlTenantUsageV1[]): MissionControlMonetizationViewV1 {
  const planCounts = Object.fromEntries(BILLING_PLAN_IDS.map((id) => [id, 0])) as Record<BillingPlanIdV1, number>;
  const hostedUsage = Object.fromEntries(METERED_RESOURCES.map((id) => [id, 0])) as Record<MeteredResourceV1, number>;
  const companionUsage = Object.fromEntries(METERED_RESOURCES.map((id) => [id, 0])) as Record<MeteredResourceV1, number>;
  let warning70 = 0, warning90 = 0, exhausted = 0;
  for (const tenant of tenants) {
    planCounts[tenant.planId] += 1;
    const warnings = METERED_RESOURCES.map((resource) => { hostedUsage[resource] += tenant.resources[resource].hosted; companionUsage[resource] += tenant.resources[resource].companion; return tenant.resources[resource].warning; });
    if (warnings.includes(100)) exhausted += 1;
    else if (warnings.includes(90)) warning90 += 1;
    else if (warnings.includes(70)) warning70 += 1;
  }
  return { schemaVersion: 1, totalTenants: tenants.length, monthlyRecurringRevenueUsd: Number(tenants.reduce((sum, tenant) => sum + tenant.monthlyPriceUsd, 0).toFixed(2)), planCounts, warning70, warning90, exhausted, hostedUsage, companionUsage };
}

function catalogOrigin(value: string, name: string) {
  const origin = new URL(value);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error(`${name} catalog origin must be a credential-free origin`);
  return origin;
}
