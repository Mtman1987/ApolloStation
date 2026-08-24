import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";

export const manifest = assertAppModuleManifestV1({
  schemaVersion: 1,
  manifestVersion: "spmt.app-manifest/v1",
  id: "stellar-core",
  name: "Stellar Core",
  description: "Persona-neutral ecosystem AI with Stella as the default Community Assistant presentation.",
  capabilities: ["stella", "conversation", "model-routing", "memory", "rag", "tools", "voice-jobs", "usage"],
  surfaces: ["shell", "standalone"],
  requiredScopes: ["assistants:read", "assistants:invoke", "stellar:context:read", "stellar:context:write", "stellar:capabilities:read"],
  eventTypes: ["stellar.job.accepted.v1", "stellar.job.completed.v1", "stellar.job.failed.v1"],
  integration: { identity: "connected", events: "connected", workspace: "connected", inference: "declared" },
  workers: [],
} satisfies AppModuleManifestV1);

export function stellarCoreCatalogRegistration(publicOrigin: string): AppCatalogRegistrationV1 {
  const origin = catalogOrigin(publicOrigin, "Stellar Core");
  return {
    appId: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: "0.1.0-green",
    launchUrl: new URL("/apps/stellar-core", origin).toString(),
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
