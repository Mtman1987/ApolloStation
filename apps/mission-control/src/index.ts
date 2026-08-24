import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";

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
    launchUrl: new URL("/apps/mission-control", origin).toString(),
    allowedScopes: [...manifest.requiredScopes],
    surfaces: ["shell", "standalone"],
    status: "active",
  };
}

function catalogOrigin(value: string, name: string) {
  const origin = new URL(value);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error(`${name} catalog origin must be a credential-free origin`);
  return origin;
}
