import { assertSpmtSuiteActionJobInputV1, spmtSuiteActionCapabilityId, type ExecutionJobV1, type SpmtSuiteActionJobInputV1 } from "@spmt/contracts";
import { HEARMEOUT_BOT_ACTIONS, type HearMeOutBotActionIdV1 } from "./bot-action-adapter.js";

export interface HearMeOutSuiteActionExecutorV1 { execute(input: SpmtSuiteActionJobInputV1 & { action: HearMeOutBotActionIdV1 }, context: { tenantId: string; idempotencyKey: string }): Promise<Record<string, unknown>>; }
export interface HearMeOutSuiteActionWorkerClientV1 {
  claimAnyExecutionJob(workerId: string, executionTarget: "sprite", options: { executionOwner: string; capabilityIds: string[]; leaseMs: number }): Promise<ExecutionJobV1 | null>;
  succeedExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, result: Record<string, unknown>): Promise<unknown>;
  failExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, code: string, message: string, retryable: boolean): Promise<unknown>;
  reportExecutionWorker(input: Record<string, unknown>): Promise<unknown>;
}

export class HearMeOutSuiteActionWorker {
  private completedJobs = 0;
  private failedJobs = 0;
  private readonly startedAt = new Date().toISOString();
  private lastReportAt = 0;
  private readonly capabilities: string[];
  constructor(private readonly client: HearMeOutSuiteActionWorkerClientV1, private readonly executor: HearMeOutSuiteActionExecutorV1, private readonly options: { workerId: string; actions: HearMeOutBotActionIdV1[]; tenantIds?: string[] }) { this.capabilities = options.actions.map(spmtSuiteActionCapabilityId); }
  async runOnce() {
    await this.reportIfDue();
    const job = await this.client.claimAnyExecutionJob(this.options.workerId, "sprite", { executionOwner: "hearmeout", capabilityIds: this.capabilities, leaseMs: 60_000 });
    if (!job) return undefined;
    if (!job.leaseId) throw new Error("Claimed HearMeOut suite-action job has no lease");
    const lease = [job.tenantId, job.id, this.options.workerId, job.leaseId, job.fencingEpoch] as const;
    try {
      const input = assertSpmtSuiteActionJobInputV1(job.input);
      if (!input.action.startsWith("hmo.") || job.capabilityId !== spmtSuiteActionCapabilityId(input.action) || !this.options.actions.includes(input.action as HearMeOutBotActionIdV1)) throw new Error("HearMeOut suite-action job route is invalid");
      const result = await this.executor.execute(input as SpmtSuiteActionJobInputV1 & { action: HearMeOutBotActionIdV1 }, { tenantId: job.tenantId, idempotencyKey: job.idempotencyKey });
      await this.client.succeedExecutionJob(...lease, { schemaVersion: 1, text: resultText(input.action, result), ...result });
      this.completedJobs += 1;
    } catch (error) {
      this.failedJobs += 1;
      await this.client.failExecutionJob(...lease, "hearmeout_suite_action_failed", safe(error), false);
    }
    return job.id;
  }
  async run(signal: AbortSignal, pollMs = 500) { while (!signal.aborted) { if (!await this.runOnce()) await pause(pollMs, signal); } }
  async report() { this.lastReportAt = Date.now(); return this.client.reportExecutionWorker({ executionOwner: "hearmeout", workerId: this.options.workerId, executionTarget: "sprite", state: "ready", capabilityIds: this.capabilities, ...(this.options.tenantIds ? { tenantIds: this.options.tenantIds } : {}), providerHealthy: true, startedAt: this.startedAt, leaseMs: 30_000, metrics: { completedJobs: this.completedJobs, failedJobs: this.failedJobs, inputUnits: 0, outputUnits: 0 } }); }
  private reportIfDue() { return Date.now() - this.lastReportAt >= 15_000 ? this.report() : Promise.resolve(undefined); }
}

export const ALL_HEARMEOUT_SUITE_ACTIONS = [...HEARMEOUT_BOT_ACTIONS];
function resultText(action: string, result: Record<string, unknown>) { if (typeof result.text === "string" && result.text.trim()) return result.text.trim().slice(0, 8_000); return `${action} completed.`; }
function safe(error: unknown) { return (error instanceof Error ? error.message : "HearMeOut suite action failed").replace(/(bearer|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/[\r\n]+/g, " ").slice(0, 900); }
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((done) => { if (signal.aborted) return done(); const timer = setTimeout(done, ms); signal.addEventListener("abort", () => { clearTimeout(timer); done(); }, { once: true }); }); }
