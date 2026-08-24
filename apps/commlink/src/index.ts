import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";

export const manifest = assertAppModuleManifestV1({
  schemaVersion: 1,
  manifestVersion: "spmt.app-manifest/v1",
  id: "commlink",
  name: "Commlink",
  description: "Canonical desks, ChatSpaces, mail, notifications, IRC-compatible live chat, and application events.",
  capabilities: ["desks", "chat-spaces", "mail", "notifications", "live-chat", "app-events", "irc"],
  surfaces: ["shell", "standalone", "popout"],
  requiredScopes: ["commlink:read", "commlink:write", "notifications:read", "notifications:write", "events:read", "workspace:read", "workspace:write"],
  eventTypes: ["commlink.message.created.v1", "commlink.notification.created.v1"],
  integration: { identity: "connected", events: "connected", workspace: "connected", chatGateway: "connected" },
  workers: [],
} satisfies AppModuleManifestV1);

export function commlinkCatalogRegistration(publicOrigin: string): AppCatalogRegistrationV1 {
  const origin = catalogOrigin(publicOrigin, "Commlink");
  return {
    appId: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: "0.1.0-green",
    launchUrl: new URL("/apps/commlink?surface=workspace", origin).toString(),
    allowedScopes: [...manifest.requiredScopes],
    surfaces: ["shell", "standalone", "popout"],
    status: "active",
  };
}

function catalogOrigin(value: string, name: string) {
  const origin = new URL(value);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error(`${name} catalog origin must be a credential-free origin`);
  return origin;
}
