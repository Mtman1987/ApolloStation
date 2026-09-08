import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthDeniedError, type AuthService, type AuthPrincipalV1 } from "@spmt/auth-core";
import type { ControlService } from "@spmt/control-core";
import type { ExecutionJobV1, MediaAssetV1, MediaAssetUploadV1 } from "@spmt/contracts";
import { MEDIA_ASSET_MAX_BYTES } from "@spmt/contracts";
import { MediaAssetError, type SqliteMediaAssetStore, type SqlitePlatformDataStore } from "@spmt/platform-data-sqlite";

export class SpmtMediaApi {
  constructor(private readonly options: { assets: SqliteMediaAssetStore; auth: AuthService; control: ControlService; jobs: SqlitePlatformDataStore; publicBaseUrl: string; limitBytes(tenantId:string):number; accessToken(request:IncomingMessage):string|undefined }) {}
  async handle(request:IncomingMessage,response:ServerResponse,url:URL):Promise<boolean> {
    if(!url.pathname.startsWith("/v1/media/"))return false;
    try { await this.dispatch(request,response,url); }
    catch(error) { const status=error instanceof MediaAssetError?error.status:error instanceof AuthDeniedError?403:500;json(response,status,{error:status===500?"internal":"media_request_failed",message:status===500?"Media storage is temporarily unavailable":error instanceof Error?error.message:"Media request failed"}); }
    return true;
  }
  private async dispatch(request:IncomingMessage,response:ServerResponse,url:URL) {
    const method=request.method??"GET",publicMatch=/^\/v1\/media\/public\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
    if(publicMatch&&["GET","HEAD"].includes(method)) { const content=this.options.assets.publicContent(publicMatch[1]!);if(!content)throw new MediaAssetError(404,"Published media was not found or has expired");if(this.options.control.getTenant(content.asset.tenantId).status!=="active")throw new MediaAssetError(404,"Published media was not found");return sendContent(request,response,content.asset,content.bytes,true); }
    const match=/^\/v1\/media\/assets(?:\/([a-f0-9-]{36})(?:\/(content|publication))?)?$/.exec(url.pathname);
    if(!match)throw new MediaAssetError(404,"Media route was not found");
    const tenantId=header(request,"x-spmt-tenant")??url.searchParams.get("tenantId")??"";
    if(!tenantId||tenantId.length>200)throw new MediaAssetError(400,"tenantId is required");
    const token=this.options.accessToken(request);if(!token)throw new MediaAssetError(401,"Sign in to use your media");
    const principal=this.options.auth.authorize(token,["GET","HEAD"].includes(method)?"media:read":"media:write",tenantId);
    if(this.options.control.getTenant(tenantId).status!=="active")throw new MediaAssetError(403,"This workspace is suspended");
    const job=principal.actorType==="service"?this.activeJob(request,principal,tenantId):undefined;
    const ownerUserId=job?.billedUserId??principal.actorId;
    if(!match[1]) {
      if(method==="GET") { if(job)throw new MediaAssetError(403,"Workers can read only assets explicitly referenced by their active job");return json(response,200,{...this.options.assets.list(tenantId,ownerUserId,url.searchParams.get("cursor")??undefined),usedBytes:this.options.assets.usedBytes(tenantId),limitBytes:this.options.limitBytes(tenantId)}); }
      if(method!=="POST")throw new MediaAssetError(405,"Use POST to upload media");
      const sourceAppId=job?.ownerAppId??url.searchParams.get("sourceAppId")??header(request,"x-spmt-app")??"";
      this.requireApp(tenantId,sourceAppId);
      const purpose=(url.searchParams.get("purpose")??"attachment") as MediaAssetUploadV1["purpose"],expiry=url.searchParams.get("expiresInSeconds");
      const expiresInSeconds=expiry!==null?Number(expiry):purpose==="recording"?3600:undefined;
      if(purpose==="recording"&&(expiresInSeconds===undefined||expiresInSeconds>86400))throw new MediaAssetError(400,"Private recordings expire within 24 hours");
      const contentType=(header(request,"content-type")??"").split(";")[0]!.trim().toLowerCase();
      const bytes=await readBytes(request);if(job)this.activeJob(request,principal,tenantId);const asset=this.options.assets.upload({tenantId,ownerUserId,sourceAppId,purpose,name:url.searchParams.get("name")??"media",contentType,...(expiresInSeconds===undefined?{}:{expiresInSeconds}),...(job?{jobId:job.id}:{}),idempotencyKey:header(request,"idempotency-key")??"",limitBytes:this.options.limitBytes(tenantId)},bytes);
      return json(response,201,asset);
    }
    const asset=this.options.assets.get(match[1]);if(!asset||asset.tenantId!==tenantId||asset.ownerUserId!==ownerUserId)throw new MediaAssetError(404,"Media asset was not found");
    if(job) {
      const ids=Array.isArray(job.input.mediaAssetIds)?job.input.mediaAssetIds:[];
      if(asset.jobId!==job.id&&!ids.includes(asset.id))throw new MediaAssetError(403,"This media asset is not an input or output of the active job");
      if(!["GET","HEAD"].includes(method)&&asset.jobId!==job.id)throw new MediaAssetError(403,"A worker cannot change an input asset");
    }
    if(match[2]==="content"&&["GET","HEAD"].includes(method)) { const content=this.options.assets.content(asset.id);if(!content)throw new MediaAssetError(404,"Media asset has expired");return sendContent(request,response,content.asset,content.bytes); }
    if(match[2]==="publication") {
      if(method==="POST") { if(job&&(job.input.mediaVisibility!=="public"||job.input.simulation===true||typeof job.input.simulationRoomId==="string"))throw new MediaAssetError(403,"This job has no explicit permission to publish its media");return json(response,200,this.options.assets.publish(asset.id,this.options.publicBaseUrl)); }
      if(method==="DELETE")return json(response,200,this.options.assets.revoke(asset.id));
    }
    if(!match[2]&&method==="GET")return json(response,200,asset);
    if(!match[2]&&method==="DELETE"){this.options.assets.delete(asset.id);response.writeHead(204);response.end();return;}
    throw new MediaAssetError(405,"Media method is not supported");
  }
  private activeJob(request:IncomingMessage,principal:AuthPrincipalV1,tenantId:string):ExecutionJobV1 {
    const id=header(request,"x-spmt-job-id"),job=id?this.options.jobs.getExecutionJob(id):undefined;
    if(!job||job.tenantId!==tenantId||job.executionOwner!==principal.actorId||!["leased","running"].includes(job.state)||!job.leaseExpiresAt||Date.parse(job.leaseExpiresAt)<=Date.now()||job.leaseId!==header(request,"x-spmt-job-lease")||String(job.fencingEpoch)!==header(request,"x-spmt-job-epoch"))throw new MediaAssetError(403,"Media workers require the current lease of their own active job");
    this.requireApp(tenantId,job.ownerAppId);return job;
  }
  private requireApp(tenantId:string,appId:string) { if(!this.options.control.listApps().some(app=>app.appId===appId)||!this.options.control.listInstalls(tenantId).some(install=>install.appId===appId&&install.enabled))throw new MediaAssetError(403,"The media source app must be enabled in this workspace"); }
}
function header(request:IncomingMessage,name:string) { const value=request.headers[name];return typeof value==="string"?value:undefined; }
async function readBytes(request:IncomingMessage) { const declared=Number(header(request,"content-length")??0);if(declared>MEDIA_ASSET_MAX_BYTES)throw new MediaAssetError(413,"Media cannot exceed 64 MiB");const chunks:Buffer[]=[];let total=0;for await(const chunk of request){const bytes=Buffer.from(chunk);total+=bytes.length;if(total>MEDIA_ASSET_MAX_BYTES)throw new MediaAssetError(413,"Media cannot exceed 64 MiB");chunks.push(bytes);}return Buffer.concat(chunks); }
function json(response:ServerResponse,status:number,value:unknown) { response.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});response.end(JSON.stringify(value)); }
function sendContent(request:IncomingMessage,response:ServerResponse,asset:MediaAssetV1,bytes:Uint8Array,published=false) {
  const headers:Record<string,string>={"content-type":asset.contentType,"cache-control":"private, no-store","accept-ranges":"bytes","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; sandbox","content-disposition":`inline; filename*=UTF-8''${encodeURIComponent(asset.name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`};
  headers["cross-origin-resource-policy"]=published?"cross-origin":"same-origin";
  if(published){headers["access-control-allow-origin"]="*";headers["access-control-expose-headers"]="content-length, content-range, accept-ranges";}
  let start=0,end=bytes.byteLength-1,status=200;
  const range=header(request,"range");if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||(!match[1]&&!match[2]))return invalidRange(response,headers,bytes.byteLength);if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)return invalidRange(response,headers,bytes.byteLength);start=Math.max(0,bytes.byteLength-suffix);}else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.byteLength)return invalidRange(response,headers,bytes.byteLength);status=206;headers["content-range"]=`bytes ${start}-${end}/${bytes.byteLength}`;}
  headers["content-length"]=String(end-start+1);response.writeHead(status,headers);response.end(request.method==="HEAD"?undefined:bytes.subarray(start,end+1));
}
function invalidRange(response:ServerResponse,headers:Record<string,string>,size:number) { response.writeHead(416,{...headers,"content-range":`bytes */${size}`,"content-length":"0"});response.end(); }
