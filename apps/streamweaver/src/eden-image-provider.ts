import type { SeaArtImageRequestV1 } from "./seaart-cli.js";
import type { StreamWeaverGeneratedMediaV1 } from "./image-generation.js";

/** Eden's documented V3 image contract; credentials stay on the worker. */
export class EdenStreamWeaverImageProvider {
  readonly id="edenai";
  constructor(private readonly key:string,private readonly model="image/generation/stabilityai",private readonly fetchImpl:typeof fetch=fetch) {
    if(!key||!/^image\/generation\/[a-z0-9_-]+(?:\/[A-Za-z0-9._ -]+)?$/.test(model))throw new Error("Eden image configuration is invalid");
  }
  async generateImage(input:SeaArtImageRequestV1):Promise<StreamWeaverGeneratedMediaV1> {
    const response=await this.fetchImpl("https://api.edenai.run/v3/universal-ai",{method:"POST",headers:{authorization:`Bearer ${this.key}`,"content-type":"application/json"},body:JSON.stringify({model:this.model,input:{text:input.prompt,resolution:input.resolution??"1024x1024",num_images:input.count??1},...(input.providerParams||input.seed!==undefined?{provider_params:{...input.providerParams,...(input.seed===undefined?{}:{seed:input.seed})}}:{})}),redirect:"error",signal:AbortSignal.timeout(180_000)});
    if(!response.ok)throw new Error(`Eden image generation returned HTTP ${response.status}`);
    const value=await response.json() as {status?:string;output?:unknown};
    if(value.status!=="success")throw new Error("Eden image generation did not succeed");
    const urls:string[]=[];
    const visit=(v:unknown,depth=0)=>{if(depth>5)return;if(Array.isArray(v)){for(const x of v.slice(0,4))visit(x,depth+1);}else if(v&&typeof v==="object"){const o=v as Record<string,unknown>;if(typeof o.image_resource_url==="string")urls.push(o.image_resource_url);for(const name of ["items","images"])if(o[name])visit(o[name],depth+1);}};visit(value.output);
    if(!urls.length)throw new Error("Eden returned no image URLs");
    return {provider:this.id,kind:"image",resourceUrl:urls[0]!,resourceUrls:urls.slice(0,4)};
  }
}
