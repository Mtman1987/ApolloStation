import { assertAppModuleManifestV1, createAppCatalogRegistrationV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
export * from "./live-chat.js";

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

export function commlinkCatalogRegistration(launchUrl: string): AppCatalogRegistrationV1 {
  return createAppCatalogRegistrationV1(manifest, { version: "0.1.0-green", launchUrl, surfaces: ["shell", "standalone", "popout"] });
}
