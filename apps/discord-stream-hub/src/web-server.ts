import type { IncomingMessage, ServerResponse } from "node:http";
import { appSurfaceBrowserJs, productSurfaceManifest } from "@spmt/app-foundation/surface-client";
import { DshApplicationControls } from "./application-controls.js";
import { DSH_APPLICATION_BROWSER_JS } from "./application-ui.js";
import { DshProposalControls } from "./proposal-controls.js";
import { DSH_PROPOSAL_BROWSER_JS } from "./proposal-ui.js";
import type { DiscordStreamHubWebServerOptionsV1 } from "./web-server-legacy.js";

// Preserve the proven DSH surface byte-for-byte while layering the completed
// community workflows in front of only the routes they own. Suppress the
// legacy module's environment auto-start while importing it; this wrapper owns
// the single production listener.
const startupSpmtOrigin = process.env.SPMT_ORIGIN;
if (startupSpmtOrigin) delete process.env.SPMT_ORIGIN;
const legacy = await import("./web-server-legacy.js");
if (startupSpmtOrigin) process.env.SPMT_ORIGIN = startupSpmtOrigin;

export const DISCORD_STREAM_HUB_WEB_DESCRIPTOR = legacy.DISCORD_STREAM_HUB_WEB_DESCRIPTOR;
export type { DiscordStreamHubWebServerOptionsV1 } from "./web-server-legacy.js";

// Keep the app-owned public surface explicit at the production entrypoint even
// while the established renderer lives in web-server-legacy.ts. This is also a
// runtime guard against the wrapper silently drifting away from Discord Stream Hub.
const ENTRYPOINT_SURFACE = productSurfaceManifest({
  appId: DISCORD_STREAM_HUB_WEB_DESCRIPTOR.appId,
  sceneUrl: DISCORD_STREAM_HUB_WEB_DESCRIPTOR.sceneUrl,
  sections: DISCORD_STREAM_HUB_WEB_DESCRIPTOR.sections,
});
const ENTRYPOINT_SURFACE_BROWSER_JS = appSurfaceBrowserJs(ENTRYPOINT_SURFACE);
if (DISCORD_STREAM_HUB_WEB_DESCRIPTOR.name !== "Discord Stream Hub" || !ENTRYPOINT_SURFACE_BROWSER_JS) {
  throw new Error("Discord Stream Hub public surface contract is invalid");
}

type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;
const APP_API_PREFIX = "/apps/discord-stream-hub/api/";
const APPLICATION_PREFIX = "/api/discord-stream-hub/control/applications/";
const PROPOSAL_PREFIX = "/api/discord-stream-hub/control/proposals/";

export function createDiscordStreamHubWebServer(options: DiscordStreamHubWebServerOptionsV1) {
  const host = legacy.createDiscordStreamHubWebServer(options);
  const workflowOptions = options.databasePath && options.runtimeConfigPath ? {
    spmtOrigin: options.spmtOrigin,
    databasePath: options.databasePath,
    runtimeConfigPath: options.runtimeConfigPath,
    ...(options.credential ? { credential: options.credential } : {}),
    ...(options.operationMode ? { operationMode: options.operationMode } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  } : undefined;
  const applications = workflowOptions ? new DshApplicationControls({ ...workflowOptions, ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}) }) : undefined;
  const proposals = workflowOptions ? new DshProposalControls(workflowOptions) : undefined;

  if (applications && proposals) {
    const listeners = host.server.listeners("request");
    if (listeners.length !== 1) {
      applications.close();
      proposals.close();
      throw new Error("DSH community dispatcher expected exactly one product-server request listener");
    }
    const fallback = listeners[0] as RequestListener;
    host.server.removeAllListeners("request");
    host.server.on("request", (request: IncomingMessage, response: ServerResponse) => {
      void dispatchCommunityRequest(applications, proposals, fallback, host.server, request, response);
    });
  }

  const closeLegacy = host.close.bind(host);
  host.close = async () => {
    applications?.close();
    proposals?.close();
    await closeLegacy();
  };
  return host;
}

async function dispatchCommunityRequest(
  applications: DshApplicationControls,
  proposals: DshProposalControls,
  fallback: RequestListener,
  server: unknown,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://spmt.app");
  if (url.pathname.startsWith(APP_API_PREFIX)) url.pathname = `/api/discord-stream-hub/${url.pathname.slice(APP_API_PREFIX.length)}`;
  if (url.pathname.startsWith(APPLICATION_PREFIX) && await applications.handle(request, response, url)) return;
  if (url.pathname.startsWith(PROPOSAL_PREFIX) && await proposals.handle(request, response, url)) return;
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/apps/discord-stream-hub")) injectCommunityUi(response);
  Reflect.apply(fallback, server, [request, response]);
}

function injectCommunityUi(response: ServerResponse) {
  const writeHead = response.writeHead.bind(response);
  const end = response.end.bind(response);
  response.writeHead = ((statusCode: number, ...args: unknown[]) => {
    for (const arg of args) {
      if (!arg || typeof arg !== "object" || Array.isArray(arg)) continue;
      const headers = arg as Record<string, unknown>;
      for (const key of Object.keys(headers)) if (key.toLowerCase() === "content-length") delete headers[key];
    }
    return Reflect.apply(writeHead, response, [statusCode, ...args]);
  }) as typeof response.writeHead;
  response.end = ((chunk?: unknown, ...args: unknown[]) => {
    if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
      const html = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      if (html.includes("</body>")) {
        const next = html.replace("</body>", `<script>${DSH_APPLICATION_BROWSER_JS}</script><script>${DSH_PROPOSAL_BROWSER_JS}</script></body>`);
        return Reflect.apply(end, response, [next, ...args]);
      }
    }
    return Reflect.apply(end, response, [chunk, ...args]);
  }) as typeof response.end;
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
