import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1, type FleetProjectionV1 } from "@spmt/contracts";

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

function catalogOrigin(value: string, name: string) {
  const origin = new URL(value);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error(`${name} catalog origin must be a credential-free origin`);
  return origin;
}
