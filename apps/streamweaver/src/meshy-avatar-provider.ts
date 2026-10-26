export interface MeshyAvatarSourceV1 { bytes:Uint8Array;contentType:"image/png"|"image/jpeg"; }
export interface MeshyAvatarModelV1 { taskId:string;glb:Uint8Array; }

export class MeshyAvatarProvider {
  constructor(private readonly apiKey:string,private readonly fetchImpl:typeof fetch=fetch,private readonly delay:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){if(!apiKey.trim())throw Error("Meshy API key is required");}
  async generate(source:MeshyAvatarSourceV1):Promise<MeshyAvatarModelV1>{
    if(!source.bytes.byteLength||source.bytes.byteLength>8*1024*1024)throw Error("Meshy avatar source must contain between one byte and 8 MiB");
    const created=await this.json("https://api.meshy.ai/openapi/v1/image-to-3d",{method:"POST",headers:this.headers(true),body:JSON.stringify({image_url:`data:${source.contentType};base64,${Buffer.from(source.bytes).toString("base64")}`,model_type:"standard",ai_model:"latest",ultra_mode:true,should_texture:true,enable_pbr:true,texture_resolution:"4k",should_remesh:false,image_enhancement:false,target_formats:["glb"]})}) as {result?:unknown};
    const taskId=id(created.result,"Meshy task id");
    for(let attempt=0;attempt<180;attempt++){
      const task=await this.json(`https://api.meshy.ai/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`,{headers:this.headers(false)}) as Record<string,unknown>;
      const status=String(task.status??"");
      if(status==="SUCCEEDED"){
        const modelUrls=record(task.model_urls),url=meshyAssetUrl(modelUrls.glb,"Meshy GLB URL");
        return{taskId,glb:await binary(this.fetchImpl,url,"Meshy GLB",64*1024*1024)};
      }
      if(status==="FAILED"||status==="CANCELED")throw Error(`Meshy avatar generation failed: ${safe(record(task.task_error).message)||status}`);
      await this.delay(2_000);
    }
    throw Error("Meshy avatar generation timed out");
  }
  private headers(json:boolean){return{authorization:`Bearer ${this.apiKey}`,...(json?{"content-type":"application/json"}:{})};}
  private async json(url:string,init:RequestInit){const response=await this.fetchImpl(url,{...init,redirect:"error",signal:AbortSignal.timeout(180_000)});const value=await response.json().catch(()=>({}));if(!response.ok)throw Error(`Meshy returned HTTP ${response.status}: ${safe(record(value).message)||"request failed"}`);return value;}
}

export async function binary(fetchImpl:typeof fetch,url:string,label:string,maximum:number){const response=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(180_000)});if(!response.ok)throw Error(`${label} returned HTTP ${response.status}`);const declared=Number(response.headers.get("content-length")??0);if(declared>maximum)throw Error(`${label} exceeds the ${Math.floor(maximum/1024/1024)} MiB limit`);const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.byteLength||bytes.byteLength>maximum)throw Error(`${label} has an invalid size`);return bytes;}
function id(value:unknown,label:string){const text=String(value??"").trim();if(!/^[A-Za-z0-9-]{8,128}$/.test(text))throw Error(`${label} is invalid`);return text;}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function meshyAssetUrl(value:unknown,label:string){const url=new URL(String(value??""));if(url.protocol!=="https:"||url.username||url.password||url.hostname!=="assets.meshy.ai")throw Error(`${label} is invalid`);return url.toString();}
function safe(value:unknown){return String(value??"").replace(/[\r\n]+/g," ").slice(0,300);}
