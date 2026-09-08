import {readFile} from "node:fs/promises";
import type {ExecutionJobV1} from "@spmt/contracts";
import type {SpmtClient} from "@spmt/sdk";
import type {StreamWeaverAvatarGeometryV1} from "./avatar-geometry.js";
import type {KeenToolsAvatarProvider} from "./keentools-avatar-provider.js";
import type {MeshyAvatarProvider} from "./meshy-avatar-provider.js";

export const STREAMWEAVER_AVATAR_BUILD_CAPABILITY="streamweaver.avatar.build.v1";
export interface StreamWeaverAvatarWorkerClientV1 {claimAnyExecutionJob:SpmtClient["claimAnyExecutionJob"];heartbeatExecutionJob:SpmtClient["heartbeatExecutionJob"];succeedExecutionJob:SpmtClient["succeedExecutionJob"];failExecutionJob:SpmtClient["failExecutionJob"];reportExecutionWorker:SpmtClient["reportExecutionWorker"];getMediaAsset:SpmtClient["getMediaAsset"];readMediaAsset:SpmtClient["readMediaAsset"];uploadMediaAsset:SpmtClient["uploadMediaAsset"];publishMediaAsset:SpmtClient["publishMediaAsset"];publishEvent:SpmtClient["publishEvent"];}

export class StreamWeaverAvatarWorker {
  private completed=0;private failed=0;private lastReport=0;private readonly startedAt=new Date().toISOString();
  constructor(private readonly client:StreamWeaverAvatarWorkerClientV1,private readonly meshy:MeshyAvatarProvider,private readonly keen:KeenToolsAvatarProvider,private readonly geometry:StreamWeaverAvatarGeometryV1,private readonly options:{workerId:string;genericBodyPaths:string[];tenantIds?:string[];activate:(tenantId:string,input:{modelUrl:string;modelAssetId:string;previewUrl?:string})=>Promise<void>}){}
  addTenant(tenantId:string){if(this.options.tenantIds&&!this.options.tenantIds.includes(tenantId))this.options.tenantIds.push(tenantId);}
  report(){this.lastReport=Date.now();return this.client.reportExecutionWorker({executionOwner:"streamweaver",workerId:this.options.workerId,executionTarget:"sprite",state:"ready",capabilityIds:[STREAMWEAVER_AVATAR_BUILD_CAPABILITY],...(this.options.tenantIds?{tenantIds:this.options.tenantIds}:{}),providerHealthy:true,startedAt:this.startedAt,leaseMs:30_000,metrics:{completedJobs:this.completed,failedJobs:this.failed,inputUnits:0,outputUnits:0}});}
  async run(signal:AbortSignal,pollMs=1_000){while(!signal.aborted){if(!await this.runOnce())await wait(pollMs,signal);}}
  async runOnce(){if(Date.now()-this.lastReport>=15_000)await this.report();const job=await this.client.claimAnyExecutionJob(this.options.workerId,"sprite",{executionOwner:"streamweaver",capabilityIds:[STREAMWEAVER_AVATAR_BUILD_CAPABILITY],leaseMs:30*60_000});if(!job)return undefined;await this.execute(job);return job.id;}
  private async execute(job:ExecutionJobV1){if(!job.leaseId)throw Error("Claimed avatar job has no lease");const lease=[job.tenantId,job.id,this.options.workerId,job.leaseId,job.fencingEpoch] as const,context={jobId:job.id,leaseId:job.leaseId,fencingEpoch:job.fencingEpoch};try{
    if(job.capabilityId!==STREAMWEAVER_AVATAR_BUILD_CAPABILITY||job.input.simulation===true)throw Error("StreamWeaver avatar job mismatch");
    const portraitAssetId=String(job.input.portraitAssetId??"");if(!/^[a-f0-9-]{36}$/.test(portraitAssetId))throw Error("Choose a valid portrait from Media Files");
    const portrait=await this.client.getMediaAsset(job.tenantId,portraitAssetId,context);if(portrait.ownerUserId!==job.billedUserId||!["image/png","image/jpeg"].includes(portrait.contentType))throw Error("Avatar portrait ownership or format mismatch");
    const source=new Uint8Array(await this.client.readMediaAsset(job.tenantId,portraitAssetId,context));
    await this.progress(lease,8,"Meshy is generating the high-fidelity head and separate hair");const meshy=await this.meshy.generate({bytes:source,contentType:portrait.contentType as "image/png"|"image/jpeg"});
    await this.progress(lease,30,"Separating the Meshy hair and rendering ten hairless head views");const prepared=await this.geometry.prepare(meshy.glb);if(prepared.views.length!==10)throw Error("Avatar geometry did not produce ten hairless head views");
    await this.progress(lease,50,"KeenTools is reconstructing and facially rigging the hairless head");const keen=await this.keen.reconstruct(prepared.views);
    await this.progress(lease,75,"Binding the Meshy hair and attaching the KeenTools head to the reusable body");const body=new Uint8Array(Buffer.concat(await Promise.all(this.options.genericBodyPaths.map(path=>readFile(path))))),assembled=await this.geometry.assemble({bodyGlb:body,keenHeadGlb:keen.glb,hairGlb:prepared.hairGlb,alignment:prepared.alignment});
    if(!assembled.validation.bodySkinPreserved||assembled.validation.headBone!=="Head"||assembled.validation.blendshapeCount<51)throw Error("Final avatar rig validation failed");
    await this.progress(lease,92,"Saving and activating the completed rigged avatar");const asset=await this.client.uploadMediaAsset(job.tenantId,{name:"Rigged StreamWeaver avatar.glb",contentType:"model/gltf-binary",purpose:"avatar"},assembled.glb,`avatar:${job.id}`,context),published=await this.client.publishMediaAsset(job.tenantId,asset.id,context);if(!published.publicUrl)throw Error("Avatar publication is unavailable");
    await this.options.activate(job.tenantId,{modelUrl:published.publicUrl,modelAssetId:asset.id,...(portrait.publicUrl?{previewUrl:portrait.publicUrl}:{})});
    await this.client.publishEvent(job.tenantId,"streamweaver.avatar.model.updated.v1",{schemaVersion:1,modelUrl:published.publicUrl,modelAssetId:asset.id,sourcePortraitAssetId:portraitAssetId,meshyTaskId:meshy.taskId,keenAvatarId:keen.avatarId,validation:assembled.validation},`streamweaver-avatar-model:${job.id}`);
    await this.client.succeedExecutionJob(...lease,{schemaVersion:1,kind:"rigged-avatar",modelUrl:published.publicUrl,modelAssetId:asset.id,sourcePortraitAssetId:portraitAssetId,validation:assembled.validation});this.completed++;
  }catch(error){this.failed++;const message=safe(error);await this.client.failExecutionJob(...lease,/timeout|temporar|HTTP 429|HTTP 5\d\d/i.test(message)?"avatar-provider-unavailable":"avatar-build-invalid",message,/timeout|temporar|HTTP 429|HTTP 5\d\d/i.test(message));}}
  private progress(lease:readonly[string,string,string,string,number],percent:number,message:string){return this.client.heartbeatExecutionJob(...lease,{percent,message},30*60_000);}
}
function safe(error:unknown){return(error instanceof Error?error.message:String(error)).replace(/(?:token|secret|authorization|password)\s*[:=]?\s*\S+/gi,"$1=[redacted]").replace(/[\r\n]+/g," ").slice(0,900);}
function wait(ms:number,signal:AbortSignal){return new Promise<void>(resolve=>{if(signal.aborted)return resolve();const timer=setTimeout(resolve,ms);signal.addEventListener("abort",()=>{clearTimeout(timer);resolve();},{once:true});});}
