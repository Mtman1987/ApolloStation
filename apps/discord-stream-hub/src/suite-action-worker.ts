import { assertSpmtSuiteActionJobInputV1, spmtSuiteActionCapabilityId, type ExecutionJobV1 } from "@spmt/contracts";
import type { PublishSimulationRoomEventInputV1 } from "@spmt/sdk";
import { DSH_BOT_ACTIONS, DshBotActionAdapter, type DshBotActionIdV1 } from "./bot-action-adapter.js";

const DSH_SUITE_ACTION_CAPABILITIES = DSH_BOT_ACTIONS.map(spmtSuiteActionCapabilityId);

export interface DshSuiteActionWorkerClientV1 {
  claimAnyExecutionJob(workerId: string, executionTarget: "sprite", options: { executionOwner: string; capabilityIds: string[]; leaseMs: number }): Promise<ExecutionJobV1 | null>;
  succeedExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, result: Record<string, unknown>): Promise<unknown>;
  failExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, code: string, message: string, retryable: boolean): Promise<unknown>;
  reportExecutionWorker(input: Record<string, unknown>): Promise<unknown>;
  publishSimulationRoomEvent?(tenantId: string, input: PublishSimulationRoomEventInputV1, idempotencyKey: string): Promise<unknown>;
}

export class DshSuiteActionWorker {
  private completedJobs = 0;
  private failedJobs = 0;
  private readonly startedAt = new Date().toISOString();
  private lastReportAt = 0;
  constructor(private readonly client: DshSuiteActionWorkerClientV1, private readonly adapter: DshBotActionAdapter, private readonly options: { workerId: string; tenantIds: string[] }) {}
  async runOnce() {
    await this.reportIfDue();
    const job = await this.client.claimAnyExecutionJob(this.options.workerId, "sprite", { executionOwner: "discord-stream-hub", capabilityIds: DSH_SUITE_ACTION_CAPABILITIES, leaseMs: 60_000 });
    if (!job) return undefined;
    if (!job.leaseId) throw new Error("Claimed DSH suite-action job has no lease");
    const lease = [job.tenantId, job.id, this.options.workerId, job.leaseId, job.fencingEpoch] as const;
    try {
      if (!DSH_SUITE_ACTION_CAPABILITIES.includes(job.capabilityId) || job.executionOwner !== "discord-stream-hub") throw new Error("DSH suite-action job route is invalid");
      const input = assertSpmtSuiteActionJobInputV1(job.input);
      if (!input.action.startsWith("dsh.")) throw new Error("DSH worker received an action owned by another app");
      const args = { ...input.args, ...(!input.args.channelId && input.source.channelId ? { channelId: input.source.channelId } : {}), ...(!input.args.roomId && input.source.roomId ? { roomId: input.source.roomId } : {}) };
      const result = await this.adapter.execute({ action: input.action as DshBotActionIdV1, tenantId: job.tenantId, actorUserId: input.actor.userId, actorRole: input.actor.role, args, idempotencyKey: job.idempotencyKey, ...(input.source.simulation === true ? { simulation: true } : {}) });
      await this.client.succeedExecutionJob(...lease, { schemaVersion: 1, text: resultText(input.action, result), ...result });
      if (input.source.simulation === true && this.client.publishSimulationRoomEvent) await this.client.publishSimulationRoomEvent(job.tenantId, simulationResult(input, resultText(input.action, result)), `dsh-suite-simulation:${job.id}`).catch(() => undefined);
      this.completedJobs += 1;
    } catch (error) {
      this.failedJobs += 1;
      await this.client.failExecutionJob(...lease, "dsh_suite_action_failed", safe(error), false);
    }
    return job.id;
  }
  async run(signal: AbortSignal, pollMs = 500) { while (!signal.aborted) { if (!await this.runOnce()) await pause(pollMs, signal); } }
  async report() { this.lastReportAt = Date.now(); return this.client.reportExecutionWorker({ executionOwner: "discord-stream-hub", workerId: this.options.workerId, executionTarget: "sprite", state: "ready", capabilityIds: DSH_SUITE_ACTION_CAPABILITIES, ...(this.options.tenantIds.length ? { tenantIds: this.options.tenantIds } : {}), providerHealthy: true, startedAt: this.startedAt, leaseMs: 30_000, metrics: { completedJobs: this.completedJobs, failedJobs: this.failedJobs, inputUnits: 0, outputUnits: 0 } }); }
  private reportIfDue() { return Date.now() - this.lastReportAt >= 15_000 ? this.report() : Promise.resolve(undefined); }
}

function resultText(action: string, result: Record<string, unknown>) { if (typeof result.text === "string" && result.text.trim()) return result.text.trim().slice(0, 8_000); if (typeof result.message === "string" && result.message.trim()) return result.message.trim().slice(0, 8_000); return `${action} completed.`; }
function simulationResult(input: ReturnType<typeof assertSpmtSuiteActionJobInputV1>, body: string): PublishSimulationRoomEventInputV1 { const guildId = input.args.guildId || input.args.serverId, channelId = input.args.channelId || input.source.channelId, roomId = guildId && channelId ? `discord:${guildId}:${channelId}` : input.source.provider && channelId ? `${input.source.provider}:${input.source.connectionId ?? input.source.kind}:${channelId}` : `streamweaver:${input.source.kind}:${input.actor.userId}`; return { roomId, lane: "app", direction: "preview", title: `${input.action} simulation completed`, body, ...(input.source.provider ? { provider: input.source.provider } : {}), ...(input.source.connectionId ? { connectionId: input.source.connectionId } : {}), ...(channelId ? { channelId } : {}), data: { action: input.action, phase: "completed", executionOwner: "discord-stream-hub" } }; }
function safe(error: unknown) { return (error instanceof Error ? error.message : "DSH suite action failed").replace(/(bearer|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/[\r\n]+/g, " ").slice(0, 900); }
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((done) => { if (signal.aborted) return done(); const timer = setTimeout(done, ms); signal.addEventListener("abort", () => { clearTimeout(timer); done(); }, { once: true }); }); }
