import type { SpmtClient } from "@spmt/sdk";
import { StellarSpeechError, StellarSpeechProvider } from "./speech-provider.js";

export const STELLAR_SPEECH_CAPABILITIES = ["stellar.speech.synthesize.v1", "stellar.speech.transcribe.v1"];
export class StellarSpeechWorker {
  private lastReport = 0;
  private readonly metrics={completedJobs:0,failedJobs:0,inputUnits:0,outputUnits:0};
  private readonly startedAt = new Date().toISOString();
  constructor(private readonly client: SpmtClient, private readonly provider: StellarSpeechProvider, private readonly workerId: string) {}
  async runOnce() {
    if (!this.provider.configured()) return;
    if (Date.now() - this.lastReport > 10_000) {
      await this.client.reportExecutionWorker({ executionOwner: "stellar-core", workerId: this.workerId, executionTarget: "sprite", state: "ready", providerHealthy: true, capabilityIds: STELLAR_SPEECH_CAPABILITIES, leaseMs: 30_000, startedAt: this.startedAt, metrics: {...this.metrics} });
      this.lastReport = Date.now();
    }
    const job = await this.client.claimAnyExecutionJob(this.workerId, "sprite", { executionOwner: "stellar-core", capabilityIds: STELLAR_SPEECH_CAPABILITIES, leaseMs: 900_000 });
    if (!job?.leaseId) return;
    const lease = [job.tenantId, job.id, this.workerId, job.leaseId, job.fencingEpoch] as const;
    const mediaLease = { jobId: job.id, leaseId: job.leaseId, fencingEpoch: job.fencingEpoch };
    try {
      if (job.input.simulation === true || typeof job.input.simulationRoomId === "string") throw new StellarSpeechError("Speech providers are disabled for simulation jobs");
      await this.client.heartbeatExecutionJob(...lease, { percent: 10, message: "Processing speech" }, 900_000);
      if (job.capabilityId === "stellar.speech.synthesize.v1") {
        const result = await this.provider.synthesize(String(job.input.text ?? ""), String(job.input.voice ?? "deepgram:aura-2:athena"), job.tenantId);
        this.metrics.inputUnits+=String(job.input.text??"").length;this.metrics.outputUnits+=result.bytes.byteLength;
        const asset = await this.client.uploadMediaAsset(job.tenantId, { name: "spoken-reply.mp3", contentType: result.contentType, purpose: "speech", expiresInSeconds: 3600 }, result.bytes, `speech:${job.id}`, mediaLease);
        await this.client.succeedExecutionJob(...lease, { kind: "stellar.speech.result.v1", mediaAssetId: asset.id, voice: result.voice, providers: result.providers, contentType: result.contentType });
      } else {
        const ids = job.input.mediaAssetIds;
        if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") throw new StellarSpeechError("Transcription requires one recording asset");
        const asset = await this.client.getMediaAsset(job.tenantId, ids[0], mediaLease);
        const bytes = await this.client.readMediaAsset(job.tenantId, asset.id, mediaLease);
        const result = await this.provider.transcribe(bytes, asset.contentType);
        this.metrics.inputUnits+=bytes.byteLength;this.metrics.outputUnits+=result.transcription.length;
        await this.client.succeedExecutionJob(...lease, { kind: "stellar.transcription.result.v1", ...result });
      }
      this.metrics.completedJobs++;
    } catch (error) {
      this.metrics.failedJobs++;
      await this.client.failExecutionJob(...lease, "speech-failed", error instanceof StellarSpeechError ? error.message : "Speech processing could not complete", error instanceof StellarSpeechError && error.retryable);
    }
    return job.id;
  }
  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try { if (await this.runOnce()) continue; } catch { /* Reconnect on the next bounded poll; leases remain canonical. */ }
      await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }; const timer = setTimeout(done, 1000); signal.addEventListener("abort", done, { once: true }); if (signal.aborted) done(); });
    }
  }
}
