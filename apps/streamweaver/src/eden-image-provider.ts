import type { SeaArtImageRequestV1 } from "./seaart-cli.js";
import type { StreamWeaverGeneratedMediaV1 } from "./image-generation.js";

/** Eden's documented V3 image contract; credentials stay on the worker. */
export class EdenStreamWeaverImageProvider {
  readonly id="edenai";
  constructor(private readonly key:string,private readonly model="image/generation/stabilityai",private readonly fetchImpl:typeof fetch=fetch) {
    if(!key||!/^image\/generation\/[a-z0-9_-]+(?:\/[A-Za-z0-9._ -]+)?$/.test(model))throw new Error("Eden image configuration is invalid");
  }
  async moderatePrompt(prompt:string){
    const response=await this.fetchImpl("https://api.edenai.run/v3/moderations",{method:"POST",headers:{authorization:`Bearer ${this.key}`,"content-type":"application/json"},body:JSON.stringify({model:"openai/omni-moderation-latest",input:prompt}),redirect:"error",signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Image prompt moderation unavailable (HTTP ${response.status})`);
    const value=await response.json() as {results?:Array<{flagged?:boolean}>};
    if(!Array.isArray(value.results)||!value.results.length||value.results.some(r=>!r||typeof r.flagged!=="boolean"))throw new Error("Image prompt moderation returned an invalid result");
    if(value.results.some(r=>r.flagged))throw new Error("Image prompt blocked by the configured content moderation");
  }
  async listModels(){
    const response=await this.fetchImpl("https://api.edenai.run/v3/info/image/generation",{headers:{authorization:`Bearer ${this.key}`,accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Eden model catalog returned HTTP ${response.status}`);
    const reader=response.body?.getReader();if(!reader)throw new Error("Eden model catalog is empty");let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1024*1024)throw new Error("Eden model catalog exceeded 1 MiB");chunks.push(chunk.value)}}finally{await reader.cancel()}
    const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!Array.isArray(value.models))throw new Error("Eden model catalog is invalid");
    const seen=new Set<string>();return value.models.slice(0,2000).flatMap((row:{model?:unknown})=>{if(typeof row?.model!=="string"||!validModel(row.model)||seen.has(row.model))return [];seen.add(row.model);return [{provider:this.id,id:row.model,label:row.model.replace("image/generation/","")}];});
  }
  async generateImage(input:SeaArtImageRequestV1):Promise<StreamWeaverGeneratedMediaV1> {
    const model=input.edenModel||this.model;if(!validModel(model))throw new Error("Eden image model is invalid");
    const response=await this.fetchImpl("https://api.edenai.run/v3/universal-ai",{method:"POST",headers:{authorization:`Bearer ${this.key}`,"content-type":"application/json"},body:JSON.stringify({model,input:{text:input.prompt,resolution:input.resolution??"1024x1024",num_images:input.count??1},...(input.providerParams||input.seed!==undefined?{provider_params:{...input.providerParams,...(input.seed===undefined?{}:{seed:input.seed})}}:{})}),redirect:"error",signal:AbortSignal.timeout(180_000)});
    if(!response.ok)throw new Error(`Eden image generation returned HTTP ${response.status}`);
    const value=await response.json() as {status?:string;output?:unknown};
    if(value.status!=="success")throw new Error("Eden image generation did not succeed");
    const urls:string[]=[];
    const visit=(v:unknown,depth=0)=>{if(depth>5)return;if(Array.isArray(v)){for(const x of v.slice(0,4))visit(x,depth+1);}else if(v&&typeof v==="object"){const o=v as Record<string,unknown>;if(typeof o.image_resource_url==="string")urls.push(o.image_resource_url);for(const name of ["items","images"])if(o[name])visit(o[name],depth+1);}};visit(value.output);
    if(!urls.length)throw new Error("Eden returned no image URLs");
    return {provider:this.id,kind:"image",resourceUrl:urls[0]!,resourceUrls:urls.slice(0,4)};
  }
}

function validModel(value:string){return value.length<=220&&/^image\/generation\/[a-z0-9_-]+(?:\/[A-Za-z0-9._ -]{1,160})?$/.test(value)}
