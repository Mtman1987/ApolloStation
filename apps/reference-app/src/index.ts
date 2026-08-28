import { type AppSettingsDefinitionV1, type ExecutionTargetV1, type MeteredResourceV1, type OverlayWidgetManifestV1, type ShellLayoutMetricsV1, type SurfaceModeV1 } from "@spmt/contracts";
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

/** Reference definition for app-owned advanced settings. Account data never belongs here. */
export const REFERENCE_APP_SETTINGS: AppSettingsDefinitionV1 = {
  schemaVersion: 1,
  appId: "reference-app",
  settingsVersion: 1,
  subject: "user",
  fields: [
    { key: "notifications.enabled", label: "Job notifications", description: "Show a notification when a reference job finishes.", type: "boolean", sensitive: false, defaultValue: true },
    { key: "provider.secret", label: "Example provider secret", description: "Demonstrates encrypted write-only app secret storage.", type: "string", sensitive: true },
  ],
};

export function submitReferenceJob(client: SpmtClient, input: { tenantId: string; userId: string; idempotencyKey: string; correlationId: string; executionTarget?: ExecutionTargetV1; meteredResource?: MeteredResourceV1 }) {
  const executionTarget = input.executionTarget ?? "sprite";
  return client.createExecutionJob(input.tenantId, {
    ownerAppId: "reference-app",
    capabilityId: "reference-app.integration-conformance",
    executionOwner: "reference-app",
    billedUserId: input.userId,
    meteredResource: input.meteredResource ?? "hosted-worker-minutes",
    usageQuantity: 1,
    executionTarget,
    meteringTarget: executionTarget === "companion" ? "companion" : "hosted",
    input: { fixture: "public-contract-only" },
  }, input.idempotencyKey, input.correlationId);
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
