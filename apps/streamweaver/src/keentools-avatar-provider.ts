import {binary} from "./meshy-avatar-provider.js";

export interface KeenToolsAvatarViewV1 { bytes:Uint8Array;contentType:"image/png"|"image/jpeg"; }
export interface KeenToolsHeadV1 { avatarId:string;glb:Uint8Array; }

export class KeenToolsAvatarProvider {
  constructor(private readonly apiKey:string,private readonly fetchImpl:typeof fetch=fetch,private readonly delay:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){if(!apiKey.trim())throw Error("KeenTools API key is required");}
  async reconstruct(views:KeenToolsAvatarViewV1[]):Promise<KeenToolsHeadV1>{
    if(views.length!==10)throw Error("KeenTools reconstruction requires exactly ten hairless head views");
    const initialized=await this.json("https://api.keentools.io/v1/avatar/init",{method:"POST",headers:this.headers(true),body:JSON.stringify({image_count:views.length})}) as {avatar_id?:unknown;img_urls?:unknown};
    const avatarId=id(initialized.avatar_id),uploads=Array.isArray(initialized.img_urls)?initialized.img_urls.map(url=>signedS3Url(url)):[];
    if(uploads.length!==views.length)throw Error("KeenTools returned an incomplete photo upload set");
    await Promise.all(uploads.map(async(url,index)=>{const view=views[index]!;const response=await this.fetchImpl(url,{method:"PUT",headers:{"content-type":view.contentType},body:new Blob([view.bytes.slice().buffer as ArrayBuffer]),redirect:"error",signal:AbortSignal.timeout(180_000)});if(!response.ok)throw Error(`KeenTools view ${index+1} upload returned HTTP ${response.status}`);}));
    await this.json(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/process`,{method:"POST",headers:this.headers(true),body:JSON.stringify({expressions_enabled:true,focal_length_type:{focal_length_type:"estimate_common"}})});
    for(let attempt=0;attempt<180;attempt++){
      const status=await this.json(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-status`,{headers:this.headers(false)}) as Record<string,unknown>;
      if(status.status==="completed")break;
      if(status.status==="failed"||status.status==="deleted")throw Error(`KeenTools reconstruction failed: ${String(record(status.data).error_message??status.status)}`);
      if(attempt===179)throw Error("KeenTools reconstruction timed out");
      await this.delay(2_000);
    }
    const query=new URLSearchParams({mesh_format:"glb",mesh_lod:"high_poly",blendshapes:"arkit,expression",texture:"png",edges:"false"});
    for(let attempt=0;attempt<30;attempt++){
      const result=await this.json(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-3d-model?${query}`,{headers:this.headers(false)}) as Record<string,unknown>;
      if(result.event==="redirect")return{avatarId,glb:await binary(this.fetchImpl,signedS3Url(record(result.data).url),"KeenTools GLB",64*1024*1024)};
      if(result.event!=="retry-after")throw Error("KeenTools model download returned an invalid event");
      await this.delay(Math.max(1,Math.min(60,Number(record(result.data).time_sec)||2))*1_000);
    }
    throw Error("KeenTools model preparation timed out");
  }
  private headers(json:boolean){return{authorization:`Bearer ${this.apiKey}`,...(json?{"content-type":"application/json"}:{})};}
  private async json(url:string,init:RequestInit){const response=await this.fetchImpl(url,{...init,redirect:"error",signal:AbortSignal.timeout(180_000)});const value=await response.json().catch(()=>({}));if(!response.ok)throw Error(`KeenTools returned HTTP ${response.status}: ${String(record(value).detail??record(value).message??"request failed").slice(0,300)}`);return value;}
}
function id(value:unknown){const text=String(value??"").trim();if(!/^[A-Za-z0-9_-]{4,160}$/.test(text))throw Error("KeenTools avatar id is invalid");return text;}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function signedS3Url(value:unknown){const url=new URL(String(value??"")),host=url.hostname.toLowerCase();if(url.protocol!=="https:"||url.username||url.password||!/^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host)||url.searchParams.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256"||!url.searchParams.has("X-Amz-Credential")||!url.searchParams.has("X-Amz-Signature"))throw Error("KeenTools asset URL is invalid");return url.toString();}
