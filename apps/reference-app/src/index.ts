import { type OverlayWidgetManifestV1, type ShellLayoutMetricsV1, type SurfaceModeV1 } from "@spmt/contracts";
import { applyShellLayoutMetrics, createBridgeEndpoint } from "@spmt/embed";
import { SpmtClient } from "@spmt/sdk";
import { configureSurfaceRoot, installDefaultPortalRoots, installSharedSurfaceStyles } from "@spmt/ui";

export interface ReferenceAppOptions {
  appId: string;
  tenantId: string;
  spmtBaseUrl: string;
  hostOrigin: string;
  surfaceMode: SurfaceModeV1;
}

export function startReferenceApp(options: ReferenceAppOptions) {
  installSharedSurfaceStyles(document);
  configureSurfaceRoot(document.documentElement, options.surfaceMode);
  if (options.surfaceMode !== "overlay") installDefaultPortalRoots(document);

  const client = new SpmtClient({ baseUrl: options.spmtBaseUrl, appId: options.appId });
  const bridge = createBridgeEndpoint({
    allowedOrigin: options.hostOrigin,
    targetWindow: window.parent,
    sourceWindow: window.parent,
    onMessage(message) {
      if (message.type === "layout.changed") applyLayout(options.surfaceMode, message.layout);
      if (message.type === "runtime.changed") document.documentElement.dataset.spmtRuntime = message.state;
      if (message.type === "theme.changed") document.documentElement.dataset.spmtTheme = "connected";
      if (message.type === "session.changed") document.documentElement.dataset.spmtSession = message.authenticated ? "authenticated" : "anonymous";
    },
  });

  bridge.start();
  bridge.send({ protocol: "spmt.embed", version: 1, type: "child.ready", appId: options.appId });

  const widget: OverlayWidgetManifestV1 = {
    schemaVersion: 1,
    appId: options.appId,
    widgetId: "reference-status",
    title: "Reference App Status",
    kind: "status",
    rendererUrl: `${location.origin}/overlay/reference-status`,
    previewUrl: `${location.origin}/preview/reference-status`,
    requiredScopes: ["workspace:read"],
    supportsAudio: false,
    supportsInteraction: false,
  };

  return { client, bridge, widget };
}

function applyLayout(mode: SurfaceModeV1, layout: ShellLayoutMetricsV1) {
  applyShellLayoutMetrics(document.documentElement, mode, layout);
}
