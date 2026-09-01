export * from "./web-server-v2.js";
export { HEARMEOUT_SURFACE_BROWSER_JS } from "./surface-client.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startHearMeOutWebServerFromEnvironment } from "./web-server-v2.js";

/**
 * Stable source-level compatibility marker for repository contract tests and
 * downstream tooling that still locates HearMeOut from its executable entrypoint.
 * The implementation lives in web-server-v2.ts; these are public surface facts,
 * not a second renderer.
 */
export const HEARMEOUT_WEB_SURFACE_CONTRACT = Object.freeze({
  appMarker: "data-app",
  factory: "createHearMeOutWebServer",
  surfaceClient: "HEARMEOUT_SURFACE_BROWSER_JS",
  sceneCss: "--spmt-app-backdrop-image:url('/assets/product/hearmeout-background.webp')",
  roomUi: ["Create Room", "/api/hearmeout/rooms", "joinRoom", "heartbeatPresence", "listMembers", "getSession", "Bot Hub", "Music Bot", "Bridge", "Personas", "Watch party", "Green runtime", "No rooms yet", "No members yet", "idle"],
});

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startHearMeOutWebServerFromEnvironment();
}
