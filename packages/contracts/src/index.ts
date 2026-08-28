export const SPMT_PROTOCOL_VERSION = 1 as const;

export const SURFACE_MODES = ["shell", "standalone", "overlay", "popout"] as const;
export type SurfaceModeV1 = (typeof SURFACE_MODES)[number];

export type RuntimeStateV1 = "starting" | "ready" | "degraded" | "draining" | "unavailable";

export const WORKLOAD_CLASSES = ["core", "elastic-http", "queue-worker", "bot-socket", "room-session", "heavy-job"] as const;
export type WorkloadClassV1 = (typeof WORKLOAD_CLASSES)[number];
export const EXECUTION_TARGETS = ["sprite", "fly", "companion"] as const;
export type ExecutionTargetV1 = (typeof EXECUTION_TARGETS)[number];

export interface RuntimePolicyV1 {
  schemaVersion: 1;
  revision: string;
  workloadId: string;
  ownerAppId: string;
  class: WorkloadClassV1;
  executionTarget: ExecutionTargetV1;
  minimumCapacity: number;
  maximumCapacity: number;
  idleSeconds: number;
  targetConcurrency: number;
  maximumHourlyCostUsd: number;
  stopMode: "stop" | "suspend";
  uniqueConsumer: boolean;
  maximumLeaseSeconds?: number;
  restartIntervalSeconds?: number;
  productionMutationEnabled: boolean;
}

export interface RuntimeObservationV1 {
  schemaVersion: 1;
  workloadId: string;
  generation: string;
  observedAt: string;
  runningCapacity: number;
  healthyCapacity: number;
  stoppedCapacity: number;
  activeRequests: number;
  requestRate: number;
  queueDepth: number;
  activeSessions: number;
  activeConnections: number;
  activeLeases: number;
  oldestDemandSeconds: number;
  uncheckpointedWork: boolean;
  duplicateConsumers: boolean;
  estimatedHourlyCostUsd: number;
  circuitBreakerOpen: boolean;
}

export const FLEET_ACTIONS = ["none", "start", "create", "drain-stop", "restart", "blocked", "external"] as const;
export type FleetActionV1 = (typeof FLEET_ACTIONS)[number];
export interface FleetDecisionV1 {
  schemaVersion: 1;
  workloadId: string;
  generation: string;
  policyRevision: string;
  observedCapacity: number;
  desiredCapacity: number;
  action: FleetActionV1;
  reason: string;
  idempotencyKey: string;
  decidedAt: string;
  productionMutationAllowed: boolean;
}

export function assertRuntimePolicyV1(value: RuntimePolicyV1): RuntimePolicyV1 {
  if (value.schemaVersion !== 1 || !(WORKLOAD_CLASSES as readonly string[]).includes(value.class) || !(EXECUTION_TARGETS as readonly string[]).includes(value.executionTarget)) throw new Error("Runtime policy version, class, or target is invalid");
  for (const field of [value.revision, value.workloadId, value.ownerAppId]) if (!field || field.trim() !== field || field.length > 200) throw new Error("Runtime policy identity is invalid");
  for (const count of [value.minimumCapacity, value.maximumCapacity, value.idleSeconds, value.targetConcurrency]) if (!Number.isSafeInteger(count) || count < 0) throw new Error("Runtime policy capacity or timing is invalid");
  if (value.minimumCapacity > value.maximumCapacity || value.targetConcurrency < 1 || !Number.isFinite(value.maximumHourlyCostUsd) || value.maximumHourlyCostUsd < 0) throw new Error("Runtime policy bounds are invalid");
  if (value.stopMode === "suspend" && value.executionTarget !== "fly") throw new Error("Only a measured Fly workload may use suspend mode");
  if (value.executionTarget === "companion" && value.productionMutationEnabled) throw new Error("Rotator cannot mutate Companion capacity");
  return value;
}

export const CHAT_PROVIDERS = ["twitch", "discord", "kick"] as const;
export type ChatProviderV1 = (typeof CHAT_PROVIDERS)[number];

export interface NormalizedChatMessageV1 {
  schemaVersion: 1;
  tenantId: string;
  provider: ChatProviderV1;
  connectionId: string;
  channelId: string;
  sourceChannelId?: string;
  messageId: string;
  text: string;
  occurredAt: string;
  actor: {
    providerUserId: string;
    canonicalUserId?: string;
    username: string;
    displayName?: string;
    isBot: boolean;
    roles: Array<"broadcaster" | "moderator" | "member">;
  };
  mentions: Array<{ token: string; providerUserId: string; canonicalUserId?: string; username: string }>;
}

export interface NormalizedChatDeliveryV1 {
  schemaVersion: 1;
  deliveryId: string;
  consumerId: string;
  message: NormalizedChatMessageV1;
  attempts: number;
}

export interface OutboundChatMessageV1 {
  schemaVersion: 1;
  tenantId: string;
  provider: ChatProviderV1;
  connectionId: string;
  channelId: string;
  text: string;
  idempotencyKey: string;
  replyToMessageId?: string;
}

export const DEVICE_COMMAND_CAPABILITIES = ["obs.scene", "obs.stream", "overlay.window", "media.playback", "local.transcode"] as const;
export type DeviceCommandCapabilityV1 = (typeof DEVICE_COMMAND_CAPABILITIES)[number];

export interface DeviceRelayCommandV1 {
  schemaVersion: 1;
  tenantId: string;
  commandId: string;
  idempotencyKey: string;
  sourceAppId: string;
  targetDeviceId: string;
  capability: DeviceCommandCapabilityV1;
  action: string;
  payload: Record<string, unknown>;
  requestedByUserId: string;
  requestedAt: string;
  requiresConfirmation: boolean;
  confirmed: boolean;
}

export interface DeviceRelayReceiptV1 {
  schemaVersion: 1;
  tenantId: string;
  commandId: string;
  targetDeviceId: string;
  status: "completed" | "rejected" | "unavailable";
  detail: string;
  completedAt: string;
}

export function assertDeviceRelayCommandV1(value: DeviceRelayCommandV1): DeviceRelayCommandV1 {
  if (value.schemaVersion !== 1 || !(DEVICE_COMMAND_CAPABILITIES as readonly string[]).includes(value.capability)) throw new Error("Device relay command version or capability is invalid");
  for (const [name, field] of [["tenantId", value.tenantId], ["commandId", value.commandId], ["idempotencyKey", value.idempotencyKey], ["sourceAppId", value.sourceAppId], ["targetDeviceId", value.targetDeviceId], ["action", value.action], ["requestedByUserId", value.requestedByUserId]] as const) if (!field || field.trim() !== field || field.length > 200) throw new Error(`${name} is invalid`);
  if (!Number.isFinite(Date.parse(value.requestedAt)) || typeof value.payload !== "object" || value.payload === null || Array.isArray(value.payload) || typeof value.requiresConfirmation !== "boolean" || typeof value.confirmed !== "boolean") throw new Error("Device relay command body is invalid");
  if (value.requiresConfirmation && !value.confirmed) throw new Error("Device relay command requires confirmation");
  return value;
}

export function assertNormalizedChatMessageV1(value: NormalizedChatMessageV1): NormalizedChatMessageV1 {
  if (value.schemaVersion !== 1 || !(CHAT_PROVIDERS as readonly string[]).includes(value.provider)) throw new Error("Normalized chat message version or provider is invalid");
  for (const [name, field] of [["tenantId", value.tenantId], ["connectionId", value.connectionId], ["channelId", value.channelId], ["messageId", value.messageId], ["actor.providerUserId", value.actor?.providerUserId], ["actor.username", value.actor?.username]] as const) {
    if (!field || field.trim() !== field || field.length > 200) throw new Error(`${name} is invalid`);
  }
  if (!value.text || value.text.length > 8_000) throw new Error("Chat message text is invalid");
  if (!Number.isFinite(Date.parse(value.occurredAt))) throw new Error("Chat message occurredAt is invalid");
  if (typeof value.actor.isBot !== "boolean" || !Array.isArray(value.actor.roles) || value.actor.roles.some((role) => !["broadcaster", "moderator", "member"].includes(role)) || !Array.isArray(value.mentions)) throw new Error("Chat actor, roles, and mentions are invalid");
  for (const mention of value.mentions) if (!mention.token || !mention.providerUserId || !mention.username) throw new Error("Chat mention is invalid");
  return value;
}

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

/** Public catalog record supplied by an app through the SPMT SDK. */
export interface AppCatalogRegistrationV1 {
  appId: string;
  name: string;
  description: string;
  version: string;
  launchUrl: string;
  iconUrl?: string;
  allowedScopes: string[];
  surfaces: Array<"shell" | "standalone" | "overlay" | "popout">;
  status: "active" | "disabled";
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

export interface RegisteredOverlayWidgetV1 {
  schemaVersion: 1;
  tenantId: string;
  manifest: OverlayWidgetManifestV1;
  createdAt: string;
  updatedAt: string;
}

export interface OverlayOutputGrantV1 {
  schemaVersion: 1;
  grantId: string;
  tenantId: string;
  appId: string;
  widgetId: string;
  viewerUserId?: string;
  createdByUserId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

/** Returned only when a grant is issued. The opaque browser-source URL cannot be recovered later. */
export interface IssuedOverlayOutputGrantV1 {
  schemaVersion: 1;
  grant: OverlayOutputGrantV1;
  browserSourceUrl: string;
}

/** Verified server-side identity passed to an overlay renderer; never accepted from URL parameters. */
export interface OverlayOutputPrincipalV1 {
  schemaVersion: 1;
  grantId: string;
  tenantId: string;
  appId: string;
  widgetId: string;
  viewerUserId?: string;
}

/** Internal mount result. The output gateway renders this target instead of redirecting the browser. */
export interface OverlayOutputResolutionV1 {
  schemaVersion: 1;
  principal: OverlayOutputPrincipalV1;
  rendererUrl: string;
}

export interface AppRuntimeProjectionV1 {
  schemaVersion: 1;
  tenantId: string;
  appId: string;
  state: RuntimeStateV1;
  detail?: string;
  updatedAt: string;
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
  if (!["iframe", "native", "media", "text", "status"].includes(value.kind)) throw new Error("Overlay widget kind is invalid");
  if (!Array.isArray(value.requiredScopes) || value.requiredScopes.some((scope) => typeof scope !== "string" || !scope.trim())) throw new Error("Overlay widget requiredScopes are invalid");
  if (typeof value.supportsAudio !== "boolean" || typeof value.supportsInteraction !== "boolean") throw new Error("Overlay widget capabilities are invalid");
  if (!value.rendererUrl.startsWith("https://") && !value.rendererUrl.startsWith("http://localhost")) {
    throw new Error("Overlay rendererUrl must be HTTPS outside local development");
  }
  if (value.previewUrl && !value.previewUrl.startsWith("https://") && !value.previewUrl.startsWith("http://localhost")) throw new Error("Overlay previewUrl must be HTTPS outside local development");
  return value;
}
