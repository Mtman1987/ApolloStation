import { assertAppModuleManifestV1, createAppCatalogRegistrationV1, type AppCatalogRegistrationV1, type AppModuleManifestV1, type CommunityAssistantInvocationV1 } from "@spmt/contracts";
import { ExecutionJobError, ExecutionJobService } from "@spmt/execution-core";
import { STELLAR_CHAT_CAPABILITY_ID, STELLAR_CHAT_REQUEST_KIND, type StellarRouteDecisionV1 } from "./contracts.js";

export { STELLAR_CHAT_CAPABILITY_ID, STELLAR_CHAT_REQUEST_KIND, STELLAR_CHAT_RESULT_KIND, type StellarRouteDecisionV1, type StellarRoutingPreferenceV1 } from "./contracts.js";
export { StellarDataPrivacyService, STELLAR_CHAT_METADATA_KIND, STELLAR_EPHEMERAL_RETENTION_MS, STELLAR_METADATA_RETENTION_MS, STELLAR_RAW_RETENTION_MS } from "./privacy.js";

export class StellarCommunityAssistantRuntime {
  constructor(private readonly jobs: ExecutionJobService, private readonly options: { enabled: boolean; resolveRoute?: (input: CommunityAssistantInvocationV1) => StellarRouteDecisionV1 }) {}
  status() { return this.options.enabled && this.jobs.hasReadyWorker({ executionOwner: "stellar-core", executionTarget: "sprite", capabilityId: STELLAR_CHAT_CAPABILITY_ID }) ? { availability: "available" as const } : { availability: "unavailable" as const, unavailableReason: "Stellar Core has no fresh healthy hosted inference worker" }; }
  accept(input: CommunityAssistantInvocationV1) {
    if (!this.options.enabled) throw new Error("Stellar Core inference is unavailable");
    const routingPreference = input.routingPreference ?? "automatic";
    const remember = input.presentation ? input.presentation.memoryPolicy === "conversation" : input.remember !== false;
    const existing = this.jobs.findIdempotent(input.tenantId, "stellar-core", input.requestedById, input.idempotencyKey);
    if (existing) {
      const replayIdentity = [input.requestedByType, input.userId, input.message, input.callerAppId, input.surface, routingPreference, remember, input.conversationId ?? null, input.presentation ?? null, input.correlationId ?? null];
      const originalIdentity = [existing.requestedByType, existing.billedUserId, existing.input.message, existing.input.callerAppId, existing.input.surface, existing.input.routingPreference, existing.input.remember !== false, existing.input.conversationId ?? null, existing.input.presentation ?? null, existing.correlationId ?? null];
      if (JSON.stringify(replayIdentity) !== JSON.stringify(originalIdentity)) throw new ExecutionJobError("conflict", "Stellar chat idempotency key was reused with different input");
      return { jobId: existing.id, executionTarget: existing.executionTarget, meteringTarget: existing.meteringTarget, routingPreference, ...(typeof existing.input.fallbackReason === "string" ? { fallbackReason: existing.input.fallbackReason } : {}) };
    }
    const route = this.options.resolveRoute?.(input) ?? { executionTarget: "sprite" as const, meteringTarget: "hosted" as const };
    const created = this.jobs.create({
      tenantId: input.tenantId, ownerAppId: "stellar-core", capabilityId: STELLAR_CHAT_CAPABILITY_ID, executionOwner: "stellar-core",
      requestedByType: input.requestedByType, requestedById: input.requestedById, billedUserId: input.userId,
      meteredResource: "ai-chat-requests", usageQuantity: 1, executionTarget: route.executionTarget, meteringTarget: route.meteringTarget,
      idempotencyKey: input.idempotencyKey,
      input: { kind: STELLAR_CHAT_REQUEST_KIND, message: input.message, userId: input.userId, callerAppId: input.callerAppId, surface: input.surface, routingPreference, remember, ...(input.presentation ? { presentation: input.presentation } : {}), ...(route.fallbackReason ? { fallbackReason: route.fallbackReason } : {}), ...(input.conversationId ? { conversationId: input.conversationId } : {}) },
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });
    return { jobId: created.job.id, executionTarget: route.executionTarget, meteringTarget: route.meteringTarget, routingPreference, ...(route.fallbackReason ? { fallbackReason: route.fallbackReason } : {}) };
  }
}

export const manifest = assertAppModuleManifestV1({
  schemaVersion: 1,
  manifestVersion: "spmt.app-manifest/v1",
  id: "stellar-core",
  name: "Stellar Core",
  description: "Persona-neutral ecosystem AI with Stella as the default Community Assistant presentation.",
  capabilities: [STELLAR_CHAT_CAPABILITY_ID, "stella", "conversation", "model-routing", "memory", "rag", "tools", "voice-jobs", "usage"],
  surfaces: ["shell", "standalone"],
  requiredScopes: ["assistants:read", "assistants:invoke", "stellar:context:read", "stellar:context:write", "stellar:capabilities:read"],
  eventTypes: ["stellar.job.accepted.v1", "stellar.job.completed.v1", "stellar.job.failed.v1"],
  integration: { identity: "connected", events: "connected", workspace: "connected", inference: "connected" },
  workers: [
    { id: "stellar-qwen-worker", role: "hosted chat inference", execution: "elastic", canonicalAuthority: false },
    { id: "stellar-companion-worker", role: "local chat inference", execution: "local", canonicalAuthority: false },
  ],
} satisfies AppModuleManifestV1);

export function stellarCoreCatalogRegistration(launchUrl: string): AppCatalogRegistrationV1 {
  return createAppCatalogRegistrationV1(manifest, { version: "0.1.0-green", launchUrl, surfaces: ["shell", "standalone"] });
}
