import type {ExecutionJobV1} from "@spmt/contracts";
import type {SpmtClient} from "@spmt/sdk";
import type {StreamWeaverAvatarGeometryV1} from "./avatar-geometry.js";

export const STREAMWEAVER_AVATAR_BUILD_CAPABILITY="streamweaver.avatar.build.v1";
export interface StreamWeaverAvatarWorkerClientV1 {claimAnyExecutionJob:SpmtClient["claimAnyExecutionJob"];heartbeatExecutionJob:SpmtClient["heartbeatExecutionJob"];succeedExecutionJob:SpmtClient["succeedExecutionJob"];failExecutionJob:SpmtClient["failExecutionJob"];reportExecutionWorker:SpmtClient["reportExecutionWorker"];getMediaAsset:SpmtClient["getMediaAsset"];readMediaAsset:SpmtClient["readMediaAsset"];uploadMediaAsset:SpmtClient["uploadMediaAsset"];publishMediaAsset:SpmtClient["publishMediaAsset"];publishEvent:SpmtClient["publishEvent"];}

/**
 * Rig a model already in GLB form. Deliberately avoids turning it into a set of
 * photographs and reconstructing a second head from those photographs.
 */
export class StreamWeaverAvatarWorker {
  private completed=0;private failed=0;private lastReport=0;private readonly startedAt=new Date().toISOString();
  constructor(private readonly client:StreamWeaverAvatarWorkerClientV1,private readonly geometry:StreamWeaverAvatarGeometryV1,private readonly options:{workerId:string;tenantIds?:string[];activate:(tenantId:string,input:{modelUrl:string;modelAssetId:string;previewUrl?:string})=>Promise<void>}){}
  addTenant(tenantId:string){if(this.options.tenantIds&&!this.options.tenantIds.includes(tenantId))this.options.tenantIds.push(tenantId);}
  report(){this.lastReport=Date.now();return this.client.reportExecutionWorker({executionOwner:"streamweaver",workerId:this.options.workerId,executionTarget:"fly",state:"ready",capabilityIds:[STREAMWEAVER_AVATAR_BUILD_CAPABILITY],...(this.options.tenantIds?{tenantIds:this.options.tenantIds}:{}),providerHealthy:true,startedAt:this.startedAt,leaseMs:30_000,metrics:{completedJobs:this.completed,failedJobs:this.failed,inputUnits:0,outputUnits:0}});}
  async run(signal:AbortSignal,pollMs=1_000){while(!signal.aborted){if(!await this.runOnce())await wait(pollMs,signal);}}
  async runOnce(){if(Date.now()-this.lastReport>=15_000)await this.report();const job=await this.client.claimAnyExecutionJob(this.options.workerId,"fly",{executionOwner:"streamweaver",capabilityIds:[STREAMWEAVER_AVATAR_BUILD_CAPABILITY],leaseMs:30*60_000});if(!job)return undefined;await this.execute(job);return job.id;}
  private async execute(job:ExecutionJobV1){
    if(!job.leaseId)throw Error("Claimed avatar job has no lease");
    const lease=[job.tenantId,job.id,this.options.workerId,job.leaseId,job.fencingEpoch] as const,context={jobId:job.id,leaseId:job.leaseId,fencingEpoch:job.fencingEpoch};
    try{
      if(job.capabilityId!==STREAMWEAVER_AVATAR_BUILD_CAPABILITY||job.input.simulation===true)throw Error("StreamWeaver avatar job mismatch");
      const modelAssetId=String(job.input.modelAssetId??"");
      if(!/^[a-f0-9-]{36}$/i.test(modelAssetId))throw Error("Choose a valid GLB model from Media Files");
      const sourceAsset=await this.client.getMediaAsset(job.tenantId,modelAssetId,context);
      if(sourceAsset.tenantId!==job.tenantId||sourceAsset.ownerUserId!==job.billedUserId||sourceAsset.contentType!=="model/gltf-binary")throw Error("Avatar model ownership or GLB format mismatch");
      const source=new Uint8Array(await this.client.readMediaAsset(job.tenantId,modelAssetId,context));
      if(!source.byteLength||source.byteLength>64*1024*1024)throw Error("Avatar GLB must be between 1 byte and 64 MiB");
      await this.progress(lease,10,"Opening the uploaded GLB directly in Blender; no photo-turnaround reconstruction");
      const result=await this.geometry.rig(source);
      const validation=result.validation;
      if(!validation.headBone||!validation.jawBone||validation.jawWeightedVertices<1)throw Error("Direct rig validation failed: a usable head and weighted jaw are required");
      if(!result.glb.byteLength||result.glb.byteLength>64*1024*1024)throw Error("Rigged GLB has an invalid size");
      await this.progress(lease,85,"Publishing the directly rigged GLB and activating it for the tenant");
      const asset=await this.client.uploadMediaAsset(job.tenantId,{name:"Rigged StreamWeaver avatar.glb",contentType:"model/gltf-binary",purpose:"avatar"},result.glb,`avatar:${job.id}`,context);
      const published=await this.client.publishMediaAsset(job.tenantId,asset.id,context);
      if(!published.publicUrl)throw Error("Avatar publication is unavailable");
      await this.options.activate(job.tenantId,{modelUrl:published.publicUrl,modelAssetId:asset.id,...(sourceAsset.publicUrl?{previewUrl:sourceAsset.publicUrl}:{})});
      await this.client.publishEvent(job.tenantId,"streamweaver.avatar.model.updated.v1",{schemaVersion:1,modelUrl:published.publicUrl,modelAssetId:asset.id,sourceModelAssetId:modelAssetId,validation},`streamweaver-avatar-model:${job.id}`);
      await this.client.succeedExecutionJob(...lease,{schemaVersion:1,kind:"rigged-avatar",modelUrl:published.publicUrl,modelAssetId:asset.id,sourceModelAssetId:modelAssetId,validation});
      this.completed++;
    }catch(error){
      this.failed++;
      const message=safe(error),retryable=/timeout|temporar|HTTP 429|HTTP 5\\d\\d/i.test(message);
      await this.client.failExecutionJob(...lease,retryable?"avatar-rigging-unavailable":"avatar-build-invalid",message,retryable);
    }
  }
  private progress(lease:readonly[string,string,string,string,number],percent:number,message:string){return this.client.heartbeatExecutionJob(...lease,{percent,message},30*60_000);}
}
function safe(error:unknown){return(error instanceof Error?error.message:String(error)).replace(/(?:token|secret|authorization|password)\s*[:=]?\s*\S+/gi,"[redacted]").replace(/[\r\n]+/g," ").slice(0,900);}
function wait(ms:number,signal:AbortSignal){return new Promise<void>(resolve=>{if(signal.aborted)return resolve();const timer=setTimeout(resolve,ms);signal.addEventListener("abort",()=>{clearTimeout(timer);resolve();},{once:true});});}
