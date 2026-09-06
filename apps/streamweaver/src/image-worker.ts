import { assertSpmtSuiteActionJobInputV1, type ExecutionJobV1 } from "@spmt/contracts";
import { StreamWeaverGenerationStore, normalizeGenerationSettings } from "./generation-settings.js";
import { downloadGeneratedImage } from "./generated-media-download.js";
import type { SpmtClient } from "@spmt/sdk";
import { StreamWeaverImageGenerationService } from "./image-generation.js";

export const STREAMWEAVER_IMAGE_GENERATION_CAPABILITY = "streamweaver.image.generate.v1";
export interface StreamWeaverImageWorkerClientV1 { claimAnyExecutionJob(workerId: string, target: "sprite", options: { executionOwner: string; capabilityIds: string[]; leaseMs: number }): Promise<ExecutionJobV1 | null>; heartbeatExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, progress: { percent: number; message: string }, leaseMs: number): Promise<unknown>; succeedExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, result: Record<string, unknown>): Promise<unknown>; failExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, code: string, message: string, retryable: boolean): Promise<unknown>; reportExecutionWorker(input:Record<string,unknown>):Promise<unknown>; uploadMediaAsset?:SpmtClient["uploadMediaAsset"]; }
export class StreamWeaverImageWorker {
  private completedJobs=0;private failedJobs=0;private readonly startedAt=new Date().toISOString();private lastReportAt=0;private lastCatalogAt=0;
  constructor(private readonly client: StreamWeaverImageWorkerClientV1, private readonly service: StreamWeaverImageGenerationService, private readonly options: { workerId: string; modelNo: string; modelVerNo: string; tenantIds?:string[];settings?:StreamWeaverGenerationStore;fetchImpl?:typeof fetch }) {}
  async runOnce() { if(this.options.settings&&typeof this.service.catalog==="function"&&Date.now()-this.lastCatalogAt>=3600000){this.lastCatalogAt=Date.now();const models=await this.service.catalog();if(models.length)this.options.settings.saveCatalog(models);}if(Date.now()-this.lastReportAt>=15_000)await this.report();const job = await this.client.claimAnyExecutionJob(this.options.workerId, "sprite", { executionOwner: "streamweaver", capabilityIds: [STREAMWEAVER_IMAGE_GENERATION_CAPABILITY], leaseMs: 15 * 60_000 }); if (!job) return undefined; await this.execute(job); return job.id; }
  async run(signal: AbortSignal, pollMs = 1_000) { while (!signal.aborted) { if (!await this.runOnce()) await wait(pollMs, signal); } }
  report(){this.lastReportAt=Date.now();return this.client.reportExecutionWorker({executionOwner:"streamweaver",workerId:this.options.workerId,executionTarget:"sprite",state:"ready",capabilityIds:[STREAMWEAVER_IMAGE_GENERATION_CAPABILITY],...(this.options.tenantIds?{tenantIds:this.options.tenantIds}:{}),providerHealthy:true,startedAt:this.startedAt,leaseMs:30_000,metrics:{completedJobs:this.completedJobs,failedJobs:this.failedJobs,inputUnits:0,outputUnits:0}});}
  private async execute(job: ExecutionJobV1) {
    if (!job.leaseId) throw new Error("Claimed StreamWeaver image job has no lease");
    const lease = [job.tenantId, job.id, this.options.workerId, job.leaseId, job.fencingEpoch] as const;
    try {
      if(job.input.simulation===true||typeof job.input.simulationRoomId==="string")throw new Error("External images are disabled for simulation jobs");
      if (job.capabilityId !== STREAMWEAVER_IMAGE_GENERATION_CAPABILITY) throw new Error("StreamWeaver image job capability mismatch");
      let prompt=String(job.input.prompt??"").trim(),count=1,actorRole="guest";
      if(job.input.kind==="spmt.suite-action.v1"||job.input.action){const suite=assertSpmtSuiteActionJobInputV1(job.input);if(suite.action!=="sw.image.generate"||suite.source.simulation)throw new Error("StreamWeaver image action mismatch");actorRole=suite.actor.role;prompt=suite.args.prompt??"";count=Math.max(1,Math.min(4,Math.trunc(Number(suite.args.count)||1)));}
      if(job.input.mediaVisibility!=="private"){const access=this.options.settings?.read(job.tenantId).publicAccess??"everyone";if(access==="off"||(access==="mods"&&!["owner","admin","moderator"].includes(actorRole)))throw new Error("The streamer has restricted public image generation");}
      const scope=job.input.mediaVisibility==="private"?`private:${job.billedUserId}`:"public",settings=normalizeGenerationSettings({contentModeration:scope==="public",...this.options.settings?.read(job.tenantId,scope),...(job.input.generationSettings&&typeof job.input.generationSettings==="object"?job.input.generationSettings:{})});
      const contentModeration=scope==="public"?(this.options.settings?.read(job.tenantId).contentModeration??true):settings.contentModeration===true;
      await this.client.heartbeatExecutionJob(...lease, { percent: 10, message: "Generating image with the configured provider chain" }, 15 * 60_000);
      let media=this.options.settings?.generated<Awaited<ReturnType<StreamWeaverImageGenerationService["image"]>>>(job.tenantId,job.id);
      if(!media){media=await this.service.image({ prompt, modelNo:settings.modelNo||String(job.input.model||this.options.modelNo),modelVerNo:settings.modelVerNo||String(job.input.modelVerNo||this.options.modelVerNo),count:job.input.generationSettings?settings.count:count,seed:settings.seed,resolution:settings.resolution,provider:settings.provider,contentModeration,...(settings.edenModel?{edenModel:settings.edenModel}:{}),providerParams:settings.providerParams,enhancePrompt:settings.enhance,tenantId:job.tenantId,userId:job.billedUserId,requestId:job.id,promptTemplate:settings.promptTemplate });this.options.settings?.saveGenerated(job.tenantId,job.id,media);}else if(contentModeration)await this.service.moderatePrompt(media.prompt);
      const mediaAssetIds:string[]=[];
      if(job.input.mediaVisibility==="private") {
        if(!this.client.uploadMediaAsset)throw new Error("Private image storage is unavailable");
        for(const [index,url] of media.resourceUrls.entries()) {
          const image=await downloadGeneratedImage(url,this.options.fetchImpl);
          const asset=await this.client.uploadMediaAsset(job.tenantId,{name:`Generated image ${index+1}`,contentType:image.contentType,purpose:"image"},image.bytes,`image:${job.id}:${index}`,{jobId:job.id,leaseId:job.leaseId,fencingEpoch:job.fencingEpoch});mediaAssetIds.push(asset.id);
        }
        await this.client.succeedExecutionJob(...lease,{schemaVersion:1,text:`Saved ${mediaAssetIds.length} private images to Media Files.`,kind:"image",provider:media.provider,prompt:media.prompt,attemptedProviders:media.attemptedProviders,mediaAssetIds});
      }else await this.client.succeedExecutionJob(...lease, { schemaVersion: 1,text:`${media.resourceUrls.length===1?"Generated image":"Generated images"}: ${media.resourceUrls.join(" ")}`, ...media });
      this.completedJobs+=1;
    }catch(error){this.failedJobs+=1;const message=safe(error);await this.client.failExecutionJob(...lease,/unavailable|timeout|temporar|polling/i.test(message)?"image-provider-unavailable":"image-generation-invalid",message,/unavailable|timeout|temporar|polling/i.test(message));}
  }
}
function safe(error: unknown) { return (error instanceof Error ? error.message : String(error)).replace(/(?:token|secret|authorization|password)\s*[:=]?\s*\S+/gi, "$1=[redacted]").replace(/[\r\n]+/g, " ").slice(0, 900); }
function wait(ms: number, signal: AbortSignal) { return new Promise<void>((resolve) => { if (signal.aborted) return resolve(); const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
