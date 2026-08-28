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
  restartDue?: boolean;
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

export interface FleetActionLeaseV1 {
  schemaVersion: 1;
  workloadId: string;
  holderId: string;
  fencingEpoch: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface FleetProjectionV1 {
  schemaVersion: 1;
  workloadId: string;
  generation: string;
  policyRevision: string;
  state: "observed" | "dry-run" | "applying" | "verified" | "rolled-back" | "blocked";
  observedCapacity: number;
  desiredCapacity: number;
  healthyCapacity: number;
  action: FleetActionV1;
  reason: string;
  fencingEpoch?: number;
  productionMutationAllowed: boolean;
  updatedAt: string;
}

export const BILLING_PLAN_IDS = ["free", "creator", "pro", "agency"] as const;
export type BillingPlanIdV1 = (typeof BILLING_PLAN_IDS)[number];
export const METERED_RESOURCES = ["workspaces", "connected-providers", "hosted-rooms", "hosted-worker-minutes", "ai-chat-requests", "ai-coding-requests", "image-generations", "hosted-voice-minutes", "xbox-session-minutes", "storage-gb"] as const;
export type MeteredResourceV1 = (typeof METERED_RESOURCES)[number];

export interface BillingPlanV1 {
  schemaVersion: 1;
  planId: BillingPlanIdV1;
  name: string;
  monthlyPriceUsd: number;
  limits: Record<MeteredResourceV1, number>;
  companionLocalProcessing: "fair-use" | "unmetered-local";
  hardStopAtLimit: true;
}

export interface BillingManifestV1 {
  schemaVersion: 1;
  revision: string;
  currency: "USD";
  warningThresholds: [0.7, 0.9, 1];
  plans: BillingPlanV1[];
}

export interface UsageEventV1 {
  schemaVersion: 1;
  tenantId: string;
  userId: string;
  planId: BillingPlanIdV1;
  period: string;
  resource: MeteredResourceV1;
  quantity: number;
  operation: "consume" | "release";
  executionTarget: "hosted" | "companion";
  idempotencyKey: string;
  occurredAt: string;
}

export interface PersonalUsageResourceV1 {
  resource: MeteredResourceV1;
  hosted: number;
  companion: number;
  limit: number;
  percent: number;
  warning: 0 | 70 | 90 | 100;
}

export interface PersonalUsageSummaryV1 {
  schemaVersion: 1;
  userId: string;
  period: string;
  plan: { planId: BillingPlanIdV1; name: string; monthlyPriceUsd: number; companionLocalProcessing: "fair-use" | "unmetered-local" };
  resources: PersonalUsageResourceV1[];
}

export interface UsageDecisionV1 {
  schemaVersion: 1;
  tenantId: string;
  planId: BillingPlanIdV1;
  period: string;
  resource: MeteredResourceV1;
  executionTarget: "hosted" | "companion";
  allowed: boolean;
  used: number;
  requested: number;
  limit: number | null;
  warning: 0 | 70 | 90 | 100;
  reason: string;
}

export const EXECUTION_JOB_STATES = ["queued", "leased", "running", "succeeded", "failed", "cancelled", "dead-letter"] as const;
export type ExecutionJobStateV1 = (typeof EXECUTION_JOB_STATES)[number];

export interface ExecutionJobProgressV1 {
  percent: number;
  message?: string;
  updatedAt: string;
}

/**
 * Shared durable envelope for asynchronous work. App-specific payload and result
 * contracts remain owned by the app identified by ownerAppId/capabilityId.
 */
export interface ExecutionJobV1 {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  ownerAppId: string;
  capabilityId: string;
  executionOwner: string;
  requestedByType: "user" | "service";
  requestedById: string;
  billedUserId: string;
  planId: BillingPlanIdV1;
  meteredResource: MeteredResourceV1;
  usageQuantity: number;
  executionTarget: ExecutionTargetV1;
  meteringTarget: "hosted" | "companion";
  idempotencyKey: string;
  input: Record<string, unknown>;
  state: ExecutionJobStateV1;
  attempt: number;
  fencingEpoch: number;
  leaseId?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  progress?: ExecutionJobProgressV1;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
  correlationId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ExecutionWorkerMetricsV1 {
  coldStartMs?: number;
  lastLatencyMs?: number;
  completedJobs: number;
  failedJobs: number;
  inputUnits: number;
  outputUnits: number;
  throughputUnitsPerSecond?: number;
  memoryRssBytes?: number;
}

/** Ephemeral, leased evidence from an authenticated execution worker. */
export interface ExecutionWorkerProjectionV1 {
  schemaVersion: 1;
  executionOwner: string;
  workerId: string;
  executionTarget: ExecutionTargetV1;
  state: RuntimeStateV1;
  capabilityIds: string[];
  tenantIds?: string[];
  providerHealthy: boolean;
  startedAt: string;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
  metrics: ExecutionWorkerMetricsV1;
}

export interface ExecutionJobCreateV1 {
  schemaVersion: 1;
  ownerAppId: string;
  capabilityId: string;
  executionOwner: string;
  billedUserId?: string;
  meteredResource: MeteredResourceV1;
  usageQuantity: number;
  executionTarget: ExecutionTargetV1;
  meteringTarget: "hosted" | "companion";
  input: Record<string, unknown>;
}

export const PROVIDER_GRANT_PROVIDERS = ["discord", "twitch", "kick", "xbox", "github", "livekit"] as const;
export type ProviderGrantProviderV1 = (typeof PROVIDER_GRANT_PROVIDERS)[number];

export interface ProviderGrantRequestV1 {
  schemaVersion: 1;
  tenantId: string;
  requesterAppId: string;
  provider: ProviderGrantProviderV1;
  providerUserId: string;
  capabilityId: string;
  requiredScopes: string[];
  ttlSeconds?: number;
}

/** Returned only to the authorized service that requested it. Never persist or log credential. */
export interface IssuedProviderGrantV1 {
  schemaVersion: 1;
  grantId: string;
  tenantId: string;
  requesterAppId: string;
  provider: ProviderGrantProviderV1;
  providerUserId: string;
  capabilityId: string;
  grantedScopes: string[];
  credential: { accessToken: string; metadata: Record<string, string> };
  issuedAt: string;
  expiresAt: string;
}

export type AppSettingsSubjectV1 = "user" | "tenant";
export type AppSettingsFieldTypeV1 = "boolean" | "string" | "number" | "enum";

export interface AppSettingsFieldV1 {
  key: string;
  label: string;
  description: string;
  type: AppSettingsFieldTypeV1;
  sensitive: boolean;
  required?: boolean;
  defaultValue?: boolean | string | number;
  options?: Array<{ value: string; label: string }>;
  minimum?: number;
  maximum?: number;
}

export interface AppSettingsDefinitionV1 {
  schemaVersion: 1;
  appId: string;
  settingsVersion: number;
  subject: AppSettingsSubjectV1;
  fields: AppSettingsFieldV1[];
}

/** Sensitive values are never returned; configuredSecretKeys reports presence only. */
export interface AppSettingsDocumentV1 {
  schemaVersion: 1;
  appId: string;
  tenantId: string;
  subject: AppSettingsSubjectV1;
  subjectId: string;
  settingsVersion: number;
  revision: number;
  values: Record<string, boolean | string | number>;
  configuredSecretKeys: string[];
  updatedAt: string;
}

export interface AppSettingsPatchV1 {
  schemaVersion: 1;
  expectedRevision: number;
  values?: Record<string, boolean | string | number | null>;
  secrets?: Record<string, string | null>;
}

export const CAPABILITY_ROUTE_MODES = ["green-only", "shadow", "green-primary-with-fallback", "disabled"] as const;
export type CapabilityRouteModeV1 = (typeof CAPABILITY_ROUTE_MODES)[number];
export const CAPABILITY_WIRING_STATES = ["scaffolded", "wired", "verified", "cutover-ready"] as const;
export type CapabilityWiringStateV1 = (typeof CAPABILITY_WIRING_STATES)[number];

export interface CapabilityWiringV1 {
  capabilityId: string;
  ownerAppId: string;
  dataOwner: string;
  executionOwner: string;
  surfaces: SurfaceModeV1[];
  entryPoints: string[];
  contract: string;
  meteredResource: MeteredResourceV1 | null;
  executionTargets: ExecutionTargetV1[];
  routeMode: CapabilityRouteModeV1;
  state: CapabilityWiringStateV1;
  migration: string;
  evidence: string[];
}

export interface CapabilityWiringManifestV1 {
  schemaVersion: 1;
  revision: string;
  capabilities: CapabilityWiringV1[];
}

export function assertBillingManifestV1(value: BillingManifestV1): BillingManifestV1 {
  if (value.schemaVersion !== 1 || value.currency !== "USD" || !value.revision || value.revision.trim() !== value.revision || value.revision.length > 200) throw new Error("Billing manifest identity is invalid");
  if (value.warningThresholds.join(",") !== "0.7,0.9,1" || value.plans.length !== BILLING_PLAN_IDS.length) throw new Error("Billing manifest thresholds or plan count is invalid");
  const seen = new Set<string>();
  for (const plan of value.plans) {
    if (plan.schemaVersion !== 1 || !(BILLING_PLAN_IDS as readonly string[]).includes(plan.planId) || seen.has(plan.planId)) throw new Error("Billing plan identity is invalid");
    seen.add(plan.planId);
    if (!plan.name || !Number.isFinite(plan.monthlyPriceUsd) || plan.monthlyPriceUsd < 0 || plan.hardStopAtLimit !== true) throw new Error("Billing plan price or stop policy is invalid");
    for (const resource of METERED_RESOURCES) if (!Number.isSafeInteger(plan.limits[resource]) || plan.limits[resource] < 0) throw new Error(`Billing limit ${resource} is invalid`);
  }
  if (BILLING_PLAN_IDS.some((id) => !seen.has(id))) throw new Error("Billing manifest is missing a canonical plan");
  return value;
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
  requestedByType: "user" | "service";
  requestedById: string;
  callerAppId: string;
  message: string;
  surface: AssistantSurfaceV1;
  routingPreference?: "automatic" | "hosted" | "companion";
  remember?: boolean;
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
      executionTarget?: ExecutionTargetV1;
      meteringTarget?: "hosted" | "companion";
      routingPreference?: "automatic" | "hosted" | "companion";
      fallbackReason?: string;
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

export function assertAppSettingsDefinitionV1(value: AppSettingsDefinitionV1): AppSettingsDefinitionV1 {
  if (value.schemaVersion !== 1 || !contractId(value.appId) || !Number.isSafeInteger(value.settingsVersion) || value.settingsVersion < 1) throw new Error("App settings definition is invalid");
  if (value.subject !== "user" && value.subject !== "tenant") throw new Error("App settings subject is invalid");
  if (!Array.isArray(value.fields) || value.fields.length > 100) throw new Error("App settings fields are invalid");
  const keys = new Set<string>();
  for (const field of value.fields) {
    if (!contractId(field.key) || keys.has(field.key) || !field.label?.trim() || !field.description?.trim()) throw new Error("App settings field is invalid or duplicated");
    keys.add(field.key);
    if (!["boolean", "string", "number", "enum"].includes(field.type) || typeof field.sensitive !== "boolean") throw new Error("App settings field type is invalid");
    if (field.sensitive && field.defaultValue !== undefined) throw new Error("Sensitive app settings cannot declare defaults");
    if (field.type === "enum" && (!field.options?.length || field.options.some((option) => !option.value || !option.label))) throw new Error("Enum app settings require options");
    if (field.type !== "enum" && field.options !== undefined) throw new Error("Only enum app settings may declare options");
    if ((field.minimum !== undefined && !Number.isFinite(field.minimum)) || (field.maximum !== undefined && !Number.isFinite(field.maximum)) || (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum)) throw new Error("App settings numeric bounds are invalid");
  }
  return value;
}

export function assertCapabilityWiringManifestV1(value: CapabilityWiringManifestV1): CapabilityWiringManifestV1 {
  if (value.schemaVersion !== 1 || !value.revision?.trim() || !Array.isArray(value.capabilities) || !value.capabilities.length) throw new Error("Capability wiring manifest is invalid");
  const ids = new Set<string>();
  for (const capability of value.capabilities) {
    if (!contractId(capability.capabilityId) || ids.has(capability.capabilityId) || !contractId(capability.ownerAppId) || !contractId(capability.dataOwner) || !contractId(capability.executionOwner)) throw new Error("Capability wiring identity is invalid or duplicated");
    ids.add(capability.capabilityId);
    if (!Array.isArray(capability.surfaces) || !capability.surfaces.length || capability.surfaces.some((surface) => !isSurfaceModeV1(surface))) throw new Error("Capability surfaces are invalid");
    if (!contractStrings(capability.entryPoints) || !capability.contract?.trim() || !contractStrings(capability.evidence)) throw new Error("Capability wiring references are invalid");
    if (capability.meteredResource !== null && !(METERED_RESOURCES as readonly string[]).includes(capability.meteredResource)) throw new Error("Capability metered resource is invalid");
    if (!Array.isArray(capability.executionTargets) || !capability.executionTargets.length || capability.executionTargets.some((target) => target !== "sprite" && target !== "fly" && target !== "companion")) throw new Error("Capability execution targets are invalid");
    if (!(CAPABILITY_ROUTE_MODES as readonly string[]).includes(capability.routeMode) || !(CAPABILITY_WIRING_STATES as readonly string[]).includes(capability.state) || !capability.migration?.trim()) throw new Error("Capability wiring state is invalid");
  }
  return value;
}

function contractId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:@/-]{1,200}$/.test(value); }
function contractStrings(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() && item.length <= 500); }
