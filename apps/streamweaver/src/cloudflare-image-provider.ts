import type {SeaArtImageRequestV1} from './seaart-cli.js';
import type {StreamWeaverGeneratedMediaV1} from './image-generation.js';
import {decodeBinaryImage,type StreamWeaverBinaryImage} from './binary-image.js';
export const CLOUDFLARE_IMAGE_MODELS=[{provider:'cloudflare',id:'@cf/black-forest-labs/flux-1-schnell',label:'FLUX.1 Schnell (provider default size)'}];
export class CloudflareStreamWeaverImageProvider {
 readonly id='cloudflare';
 constructor(private readonly accountId:string,private readonly token:string,private readonly fetchImpl:typeof fetch=fetch){if(!/^[a-f0-9]{32}$/i.test(accountId)||!token.trim())throw Error('Cloudflare image credentials are invalid')}
 async listModels(){return CLOUDFLARE_IMAGE_MODELS.map(m=>({...m}))}
 async generateImage(input:SeaArtImageRequestV1):Promise<StreamWeaverGeneratedMediaV1>{
  const model=input.cloudflareModel||CLOUDFLARE_IMAGE_MODELS[0]!.id,count=input.count??1,steps=Number(input.providerParams?.steps??4);
  if(!CLOUDFLARE_IMAGE_MODELS.some(m=>m.id===model)||!input.prompt.trim()||input.prompt.length>2048||!Number.isInteger(count)||count<1||count>4||!Number.isInteger(steps)||steps<1||steps>8)throw Error('Cloudflare requires a supported model, 1–4 images, 1–8 steps and a prompt up to 2048 characters');
  if(Object.keys(input.providerParams??{}).some(k=>k!=='steps'))throw Error('Cloudflare FLUX.1 supports only the steps advanced parameter');
  const binaryImages:StreamWeaverBinaryImage[]=[];
  for(let i=0;i<count;i++){
   const response=await this.fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${model}`,{method:'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},body:JSON.stringify({prompt:input.prompt,steps,...(input.seed?{seed:(input.seed+i)%2147483647}:{})}),redirect:'error',signal:AbortSignal.timeout(180000)});
   if(!response.ok)throw Error(`Cloudflare image generation returned HTTP ${response.status}`);
   const reader=response.body?.getReader();if(!reader)throw Error('Cloudflare returned no image');const chunks:Uint8Array[]=[];let size=0;
   try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>12*1024*1024)throw Error('Cloudflare image response exceeded 12 MiB');chunks.push(chunk.value)}}finally{await reader.cancel()}
   let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Cloudflare returned invalid JSON')};if(value.success===false||typeof value.result?.image!=='string')throw Error('Cloudflare returned an invalid image result');
   const base64=value.result.image,head=Buffer.from(base64.slice(0,24),'base64'),contentType=head[0]===255?'image/jpeg':head[0]===137?'image/png':'image/webp',image={contentType,base64};decodeBinaryImage(image);binaryImages.push(image);
  }
  return {provider:this.id,kind:'image',resourceUrl:'',resourceUrls:[],binaryImages};
 }
}
