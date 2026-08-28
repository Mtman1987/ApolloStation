import type { ExecutionJobV1 } from "@spmt/contracts";
import { ExecutionJobService } from "@spmt/execution-core";
import { PlatformDataService } from "@spmt/platform-data-core";
import { STELLAR_CHAT_CAPABILITY_ID, STELLAR_CHAT_REQUEST_KIND } from "./contracts.js";

export const STELLAR_RAW_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const STELLAR_EPHEMERAL_RETENTION_MS = 60 * 60 * 1_000;
export const STELLAR_METADATA_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const STELLAR_CHAT_METADATA_KIND = "stellar-chat-metadata.v1";

export class StellarDataPrivacyService {
  private readonly now: () => string;
  constructor(private readonly jobs: ExecutionJobService, private readonly data: PlatformDataService, options: { now?: () => string } = {}) { this.now = options.now ?? (() => new Date().toISOString()); }

  exportForUser(tenantId: string, userId: string) {
    const exportedAt = this.now();
    return {
      schemaVersion: 1 as const,
      tenantId,
      userId,
      exportedAt,
      retention: { rawDays: 7, doNotRememberHours: 1, metadataDays: 30 },
      context: this.data.listPersonalStellarContext(tenantId, userId),
      jobs: this.jobs.listForMaintenance(tenantId, { ownerAppId: "stellar-core", billedUserId: userId }).map(publicStellarJob),
    };
  }

  deleteForUser(tenantId: string, userId: string) {
    const jobs = this.jobs.listForMaintenance(tenantId, { ownerAppId: "stellar-core", billedUserId: userId });
    let deletedJobs = 0;
    for (const job of jobs) {
      if (!terminal(job)) this.jobs.cancel(tenantId, job.id);
      this.jobs.delete(tenantId, job.id);
      deletedJobs += 1;
    }
    return { schemaVersion: 1 as const, tenantId, userId, deletedJobs, deletedContext: this.data.deletePersonalStellarContext(tenantId, userId), deletedAt: this.now() };
  }

  sweep(tenantIds: string[]) {
    const now = Date.parse(this.now());
    let minimized = 0, deleted = 0;
    for (const tenantId of [...new Set(tenantIds)]) {
      const jobs = this.jobs.listForMaintenance(tenantId, { ownerAppId: "stellar-core" });
      for (const job of jobs) {
        if (!terminal(job) || !job.completedAt) continue;
        const age = now - Date.parse(job.completedAt);
        if (age >= STELLAR_METADATA_RETENTION_MS) { this.jobs.delete(tenantId, job.id); deleted += 1; continue; }
        if (job.input.kind !== STELLAR_CHAT_REQUEST_KIND) continue;
        const remember = job.input.remember !== false;
        if (age < (remember ? STELLAR_RAW_RETENTION_MS : STELLAR_EPHEMERAL_RETENTION_MS)) continue;
        this.jobs.redactPayloads(tenantId, job.id, metadataInput(job, remember), metadataResult(job));
        minimized += 1;
      }
    }
    return { schemaVersion: 1 as const, minimized, deleted, sweptAt: this.now() };
  }
}

function terminal(job: ExecutionJobV1) { return ["succeeded", "failed", "cancelled", "dead-letter"].includes(job.state); }
function metadataInput(job: ExecutionJobV1, remember: boolean) { const presentation=publicPresentation(job.input.presentation); return { kind: STELLAR_CHAT_METADATA_KIND, capabilityId: STELLAR_CHAT_CAPABILITY_ID, userId: job.billedUserId, surface: typeof job.input.surface === "string" ? job.input.surface : "unknown", routingPreference: typeof job.input.routingPreference === "string" ? job.input.routingPreference : "automatic", remember, ...(presentation?{presentation}:{}), ...(typeof job.input.conversationId === "string" ? { conversationId: job.input.conversationId } : {}), contentMinimized: true }; }
function metadataResult(job: ExecutionJobV1) { const usage = job.result?.usage; return { kind: STELLAR_CHAT_METADATA_KIND, contentMinimized: true, state: job.state, ...(usage && typeof usage === "object" && !Array.isArray(usage) ? { usage } : {}), ...(typeof job.result?.finishReason === "string" ? { finishReason: job.result.finishReason } : {}) }; }
function publicStellarJob(job:ExecutionJobV1):ExecutionJobV1{const presentation=publicPresentation(job.input.presentation);return presentation?{...job,input:{...job.input,presentation}}:job;}
function publicPresentation(value:unknown){if(!value||typeof value!=="object"||Array.isArray(value))return undefined;const input=value as Record<string,unknown>;return{...(typeof input.sourceAppId==="string"?{sourceAppId:input.sourceAppId}:{}),...(typeof input.personaId==="string"?{personaId:input.personaId}:{}),...(typeof input.displayName==="string"?{displayName:input.displayName}:{}),...(typeof input.memoryPolicy==="string"?{memoryPolicy:input.memoryPolicy}:{}),instructionsConfigured:input.instructionsConfigured===true||(typeof input.instructions==="string"&&Boolean(input.instructions))};}
