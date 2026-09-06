import type { IncomingMessage, ServerResponse } from "node:http";
import { DshApplicationControls } from "./application-controls.js";
import type { DiscordStreamHubWebServerOptionsV1 } from "./web-server-legacy.js";

// Preserve the proven DSH surface byte-for-byte while layering the completed
// application workflow in front of only the routes it owns. Suppress the
// legacy module's environment auto-start while importing it; this wrapper owns
// the single production listener.
const startupSpmtOrigin = process.env.SPMT_ORIGIN;
if (startupSpmtOrigin) delete process.env.SPMT_ORIGIN;
const legacy = await import("./web-server-legacy.js");
if (startupSpmtOrigin) process.env.SPMT_ORIGIN = startupSpmtOrigin;

export const DISCORD_STREAM_HUB_WEB_DESCRIPTOR = legacy.DISCORD_STREAM_HUB_WEB_DESCRIPTOR;
export type { DiscordStreamHubWebServerOptionsV1 } from "./web-server-legacy.js";

const APPLICATION_ACTIONS = new Set(["reviews", "agreement", "vote", "decide", "notify", "templates"]);
const APP_API_PREFIX = "/apps/discord-stream-hub/api/";
const APPLICATION_PREFIX = "/api/discord-stream-hub/control/applications/";

export function createDiscordStreamHubWebServer(options: DiscordStreamHubWebServerOptionsV1) {
  const host = legacy.createDiscordStreamHubWebServer(options);
  const applications = options.databasePath && options.runtimeConfigPath
    ? new DshApplicationControls({
        spmtOrigin: options.spmtOrigin,
        publicOrigin: options.publicOrigin,
        databasePath: options.databasePath,
        runtimeConfigPath: options.runtimeConfigPath,
        credential: options.credential,
        operationMode: options.operationMode,
        fetchImpl: options.fetchImpl,
      })
    : undefined;

  if (applications) {
    const listeners = host.server.listeners("request");
    if (listeners.length !== 1) {
      applications.close();
      throw new Error("DSH application dispatcher expected exactly one product-server request listener");
    }
    const fallback = listeners[0]!;
    host.server.removeAllListeners("request");
    host.server.on("request", (request: IncomingMessage, response: ServerResponse) => {
      void dispatchApplicationRequest(applications, fallback, host.server, request, response);
    });
  }

  const closeLegacy = host.close.bind(host);
  host.close = async () => {
    applications?.close();
    await closeLegacy();
  };
  return host;
}

async function dispatchApplicationRequest(
  applications: DshApplicationControls,
  fallback: (...args: unknown[]) => unknown,
  server: unknown,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://spmt.app");
  if (url.pathname.startsWith(APP_API_PREFIX)) {
    url.pathname = `/api/discord-stream-hub/${url.pathname.slice(APP_API_PREFIX.length)}`;
  }
  if (url.pathname.startsWith(APPLICATION_PREFIX)) {
    const action = url.pathname.slice(APPLICATION_PREFIX.length);
    if (APPLICATION_ACTIONS.has(action) && await applications.handle(request, response, url)) return;
  }
  await Promise.resolve(Reflect.apply(fallback, server, [request, response]));
}

if (startupSpmtOrigin) {
  const discordClientId = process.env.DSH_DISCORD_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID;
  const host = createDiscordStreamHubWebServer({
    spmtOrigin: startupSpmtOrigin,
    port: Number(process.env.PORT ?? 3201),
    host: process.env.HOST ?? "127.0.0.1",
    buildSha: process.env.BUILD_SHA ?? "dev",
    operationMode: process.env.SPMT_OUTBOUND_MODE === "disabled" ? "read-only" : "active",
    ...(process.env.DSH_DATABASE_PATH ? { databasePath: process.env.DSH_DATABASE_PATH } : {}),
    ...(process.env.DSH_RUNTIME_CONFIG_PATH ? { runtimeConfigPath: process.env.DSH_RUNTIME_CONFIG_PATH } : {}),
    ...(process.env.DSH_WORKER_CREDENTIAL ? { credential: process.env.DSH_WORKER_CREDENTIAL } : {}),
    ...(process.env.SPMT_PUBLIC_ORIGIN ? { publicOrigin: process.env.SPMT_PUBLIC_ORIGIN } : {}),
    ...(process.env.DSH_DISCORD_PUBLIC_KEY ? { discordPublicKey: process.env.DSH_DISCORD_PUBLIC_KEY } : {}),
    ...(discordClientId ? { discordClientId } : {}),
  });
  await host.listen();
}
