export * from "./web-server-v2.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startHearMeOutWebServerFromEnvironment } from "./web-server-v2.js";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startHearMeOutWebServerFromEnvironment();
}
