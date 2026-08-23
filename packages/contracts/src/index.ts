export const SPMT_PROTOCOL_VERSION = 1 as const;

export const SURFACE_MODES = ["shell", "standalone", "overlay", "popout"] as const;
export type SurfaceModeV1 = (typeof SURFACE_MODES)[number];

export type RuntimeStateV1 = "starting" | "ready" | "degraded" | "draining" | "unavailable";

export type AppIntegrationStateV1 = "native" | "connected" | "declared" | "unavailable" | "not-applicable";

export interface AppWorkerManifestV1 {
  id: string;
  role: string;
  execution: "anchored" | "leased" | "elastic" | "local";
  canonicalAuthority: false;
}

export interface AppModuleManifestV1 {
  schemaVersion: 1;
  manifestVersion: "spmt.app-manifest/v1";
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  surfaces: SurfaceModeV1[];
  requiredScopes: string[];
  eventTypes: string[];
  integration: Record<string, AppIntegrationStateV1>;
  workers: AppWorkerManifestV1[];
}

export function assertAppModuleManifestV1(value: AppModuleManifestV1): AppModuleManifestV1 {
  if (value.schemaVersion !== 1 || value.manifestVersion !== "spmt.app-manifest/v1") throw new Error("Unsupported app manifest version");
  if (!value.id || !value.name || !value.description) throw new Error("App manifest identity is incomplete");
  for (const field of [value.capabilities, value.surfaces, value.requiredScopes, value.eventTypes]) {
    if (!Array.isArray(field) || new Set(field).size !== field.length) throw new Error("App manifest arrays must contain unique values");
  }
  if (value.workers.some((worker) => worker.canonicalAuthority !== false)) throw new Error("Workers cannot own canonical ecosystem state");
  return value;
}

export const COMMUNITY_ASSISTANT_ID = "spmt.community-assistant" as const;
export const COMMUNITY_ASSISTANT_DISPLAY_NAME = "Stella" as const;
export const ASSISTANT_SURFACES = ["app", "commlink", "stream", "standalone", "developer"] as const;
export type AssistantSurfaceV1 = (typeof ASSISTANT_SURFACES)[number];

export interface CommunityAssistantDescriptorV1 {
  schemaVersion: 1;
  id: typeof COMMUNITY_ASSISTANT_ID;
  displayName: typeof COMMUNITY_ASSISTANT_DISPLAY_NAME;
  role: "community-assistant";
  executionOwner: "stellar-core";
  availability: "available" | "unavailable";
  requiredScopes: ["assistants:invoke"];
  unavailableReason?: string;
}

export interface CommunityAssistantInvocationV1 {
  schemaVersion: 1;
  tenantId: string;
  userId: string;
  callerAppId: string;
  message: string;
  surface: AssistantSurfaceV1;
  idempotencyKey: string;
  conversationId?: string;
  correlationId?: string;
}

export type CommunityAssistantInvocationResultV1 =
  | {
      schemaVersion: 1;
      assistantId: typeof COMMUNITY_ASSISTANT_ID;
      displayName: typeof COMMUNITY_ASSISTANT_DISPLAY_NAME;
      status: "accepted";
      jobId: string;
    }
  | {
      schemaVersion: 1;
      assistantId: typeof COMMUNITY_ASSISTANT_ID;
      displayName: typeof COMMUNITY_ASSISTANT_DISPLAY_NAME;
      status: "unavailable";
      reason: string;
    };

export const OPERATIONS_LOG_LEVELS = ["info", "warn", "error", "critical"] as const;
export type OperationsLogLevelV1 = (typeof OPERATIONS_LOG_LEVELS)[number];

export interface OperationsLogV1 {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  sourceAppId: string;
  reporterId: string;
  level: OperationsLogLevelV1;
  kind: string;
  summary: string;
  detail?: string;
  labels: string[];
  correlationId?: string;
  occurredAt: string;
  recordedAt: string;
}

export interface CoderEvidenceV1 {
  logId: string;
  sourceAppId: string;
  level: OperationsLogLevelV1;
  kind: string;
  summary: string;
  occurredAt: string;
  correlationId?: string;
}

export const CODER_JOB_STATES = ["draft", "queued", "running", "succeeded", "failed", "cancelled"] as const;
export type CoderJobStateV1 = (typeof CODER_JOB_STATES)[number];

export interface CoderJobV1 {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  targetAppId: string;
  requestedByType: "user" | "service";
  requestedById: string;
  prompt: string;
  evidence: CoderEvidenceV1[];
  state: CoderJobStateV1;
  runtimeJobId?: string;
  unavailableReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CoderDescriptorV1 {
  schemaVersion: 1;
  id: "spmt.operations.coder";
  executionOwner: "mtman-machine-rotator";
  availability: "available" | "unavailable";
  requiredScopes: ["operations:logs:read", "operations:coder:invoke"];
  unavailableReason?: string;
}

export interface ShellLayoutMetricsV1 {
  schemaVersion: 1;
  headerHeight: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
  availableWidth: number;
  availableHeight: number;
  measuredAt: string;
}

export interface ThemeTokensV1 {
  schemaVersion: 1;
  background: string;
  surface: string;
  text: string;
  accent: string;
  radius: string;
  density: "compact" | "comfortable" | "spacious";
  motion: "full" | "reduced" | "none";
}

export interface ScopeGrantV1 {
  scope: string;
  granted: boolean;
}

export interface AppFrameLaunchV1 {
  schemaVersion: 1;
  launchId: string;
  appId: string;
  surfaceMode: SurfaceModeV1;
  tenantId?: string;
  requestedScopes: string[];
}

export type OverlayWidgetKindV1 = "iframe" | "native" | "media" | "text" | "status";

export interface OverlayWidgetManifestV1 {
  schemaVersion: 1;
  appId: string;
  widgetId: string;
  title: string;
  kind: OverlayWidgetKindV1;
  rendererUrl: string;
  previewUrl?: string;
  requiredScopes: string[];
  supportsAudio: boolean;
  supportsInteraction: boolean;
  defaultAspectRatio?: string;
}

export type EmbedBridgeMessageV1 =
  | { protocol: "spmt.embed"; version: 1; type: "host.hello"; launch: AppFrameLaunchV1 }
  | { protocol: "spmt.embed"; version: 1; type: "child.ready"; appId: string }
  | { protocol: "spmt.embed"; version: 1; type: "session.changed"; authenticated: boolean; userId?: string; tenantId?: string }
  | { protocol: "spmt.embed"; version: 1; type: "theme.changed"; theme: ThemeTokensV1 }
  | { protocol: "spmt.embed"; version: 1; type: "layout.changed"; layout: ShellLayoutMetricsV1 }
  | { protocol: "spmt.embed"; version: 1; type: "capabilities.changed"; grants: ScopeGrantV1[] }
  | { protocol: "spmt.embed"; version: 1; type: "runtime.changed"; state: RuntimeStateV1; detail?: string }
  | { protocol: "spmt.embed"; version: 1; type: "navigation.open"; url: string; target: "shell" | "direct" | "popout" };

export function isSurfaceModeV1(value: unknown): value is SurfaceModeV1 {
  return typeof value === "string" && (SURFACE_MODES as readonly string[]).includes(value);
}

export function isShellLayoutMetricsV1(value: unknown): value is ShellLayoutMetricsV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1 &&
    ["headerHeight", "safeTop", "safeRight", "safeBottom", "safeLeft", "availableWidth", "availableHeight"].every(
      (key) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]) && (candidate[key] as number) >= 0,
    ) && typeof candidate.measuredAt === "string";
}

export function isEmbedBridgeMessageV1(value: unknown): value is EmbedBridgeMessageV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.protocol !== "spmt.embed" || candidate.version !== 1 || typeof candidate.type !== "string") return false;
  switch (candidate.type) {
    case "host.hello":
      return !!candidate.launch && typeof candidate.launch === "object";
    case "child.ready":
      return typeof candidate.appId === "string";
    case "session.changed":
      return typeof candidate.authenticated === "boolean";
    case "theme.changed":
      return !!candidate.theme && typeof candidate.theme === "object";
    case "layout.changed":
      return isShellLayoutMetricsV1(candidate.layout);
    case "capabilities.changed":
      return Array.isArray(candidate.grants);
    case "runtime.changed":
      return typeof candidate.state === "string";
    case "navigation.open":
      return typeof candidate.url === "string" && typeof candidate.target === "string";
    default:
      return false;
  }
}

export function assertOverlayWidgetManifestV1(value: OverlayWidgetManifestV1): OverlayWidgetManifestV1 {
  if (value.schemaVersion !== 1) throw new Error("Unsupported overlay widget manifest version");
  if (!value.appId || !value.widgetId || !value.title || !value.rendererUrl) throw new Error("Overlay widget manifest is incomplete");
  if (!value.rendererUrl.startsWith("https://") && !value.rendererUrl.startsWith("http://localhost")) {
    throw new Error("Overlay rendererUrl must be HTTPS outside local development");
  }
  return value;
}
