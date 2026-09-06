import type {SeaArtImageRequestV1} from './seaart-cli.js';
import type {StreamWeaverGeneratedMediaV1} from './image-generation.js';
import {decodeBinaryImage,type StreamWeaverBinaryImage} from './binary-image.js';
export const CLOUDFLARE_IMAGE_MODELS = [
 {provider:'cloudflare',id:'@cf/black-forest-labs/flux-1-schnell',label:'FLUX.1 Schnell (provider default size)'},
 {provider:'cloudflare',id:'@cf/black-forest-labs/flux-2-klein-4b',label:'FLUX.2 Klein 4B'},
 {provider:'cloudflare',id:'@cf/leonardo/lucid-origin',label:'Lucid Origin'},
 {provider:'cloudflare',id:'@cf/leonardo/phoenix-1.0',label:'Phoenix 1.0'},
 {provider:'cloudflare',id:'@cf/black-forest-labs/flux-2-klein-9b',label:'FLUX.2 Klein 9B (private only)'},
];
export const CLOUDFLARE_PRIVATE_IMAGE_MODEL='@cf/black-forest-labs/flux-2-klein-9b';
export class CloudflareStreamWeaverImageProvider {
 readonly id='cloudflare';
 constructor(private readonly accountId:string,private readonly token:string,private readonly fetchImpl:typeof fetch=fetch){if(!/^[a-f0-9]{32}$/i.test(accountId)||!token.trim())throw Error('Cloudflare image credentials are invalid')}
 async listModels(){return CLOUDFLARE_IMAGE_MODELS.map(m=>({...m}))}
 async generateImage(input:SeaArtImageRequestV1):Promise<StreamWeaverGeneratedMediaV1>{
  const model=input.cloudflareModel||CLOUDFLARE_IMAGE_MODELS[0]!.id,count=input.count??1;
  if(!CLOUDFLARE_IMAGE_MODELS.some(m=>m.id===model)||!input.prompt.trim()||input.prompt.length>2048||!Number.isInteger(count)||count<1||count>4)throw Error('Cloudflare requires a supported model, 1–4 images and a prompt up to 2048 characters');
  if(model===CLOUDFLARE_PRIVATE_IMAGE_MODEL&&input.surface!=="private")throw Error('Cloudflare Klein 9B is restricted to private generation');
  const klein=model.includes('/flux-2-'),schnell=model.endsWith('/flux-1-schnell'),phoenix=model.endsWith('/phoenix-1.0'),params=input.providerParams??{};
  const allowed=schnell?['steps']:phoenix?['steps','guidance_scale','negative_prompt']:['steps','guidance_scale'];
  if(Object.keys(params).some(k=>!allowed.includes(k)))throw Error(schnell?'Cloudflare FLUX.1 supports only the steps advanced parameter':'Unsupported advanced parameter for the selected Cloudflare model');
  const steps=Number(params.steps??(klein||schnell?4:25)),maxSteps=schnell?8:klein?4:phoenix?50:40;
  if(!Number.isInteger(steps)||steps<1||steps>maxSteps||(klein&&steps!==4))throw Error(klein?'Cloudflare Klein uses exactly 4 steps':`Cloudflare model supports 1–${maxSteps} steps`);
  const guidance=params.guidance_scale===undefined?undefined:Number(params.guidance_scale);
  if(guidance!==undefined&&(!Number.isFinite(guidance)||guidance<(phoenix?2:0)||guidance>10))throw Error('Cloudflare guidance is out of range');
  if(params.negative_prompt!==undefined&&(typeof params.negative_prompt!=='string'||!params.negative_prompt.trim()||params.negative_prompt.length>1500))throw Error('Cloudflare negative prompt is invalid');
  if(input.seed!==undefined&&(!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>2147483647))throw Error('Cloudflare seed is invalid');
  const resolution=input.resolution||'1024x1024';
  if(!['512x512','768x768','1024x1024','1024x768','768x1024'].includes(resolution))throw Error('Cloudflare resolution is invalid');
  const [width,height]=resolution.split('x').map(Number),binaryImages:StreamWeaverBinaryImage[]=[];
  for(let i=0;i<count;i++){
   const payload:Record<string,string|number>={prompt:input.prompt,...(!schnell?{width:width!,height:height!}:{}),...(input.seed?{seed:(input.seed+i)%2147483647}:{}),...(guidance===undefined?{}:{guidance}),...(params.negative_prompt===undefined?{}:{negative_prompt:String(params.negative_prompt)})};
   const headers:Record<string,string>={authorization:`Bearer ${this.token}`};let body:FormData|string;
   if(klein){const form=new FormData();for(const [key,value] of Object.entries(payload))form.set(key,String(value));body=form;}
   else{payload[schnell?'steps':'num_steps']=steps;headers['content-type']='application/json';body=JSON.stringify(payload);}
   const response=await this.fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${model}`,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(180000)});
   if(!response.ok)throw Error(`Cloudflare image generation returned HTTP ${response.status}`);
   const reader=response.body?.getReader();if(!reader)throw Error('Cloudflare returned no image');const chunks:Uint8Array[]=[];let size=0;
   try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>12*1024*1024)throw Error('Cloudflare image response exceeded 12 MiB');chunks.push(chunk.value)}}finally{await reader.cancel()}
   const bytes=Buffer.concat(chunks),responseType=response.headers.get('content-type')?.split(';')[0]?.toLowerCase();
   if(responseType?.startsWith('image/')){const image={contentType:responseType,base64:bytes.toString('base64')};decodeBinaryImage(image);binaryImages.push(image);continue;}
   let value;try{value=JSON.parse(bytes.toString('utf8'))}catch{throw Error('Cloudflare returned invalid JSON')};if(value.success===false||typeof value.result?.image!=='string')throw Error('Cloudflare returned an invalid image result');
   const base64=value.result.image,head=Buffer.from(base64.slice(0,24),'base64'),contentType=head[0]===255?'image/jpeg':head[0]===137?'image/png':'image/webp',image={contentType,base64};decodeBinaryImage(image);binaryImages.push(image);
  }
  return {provider:this.id,kind:'image',resourceUrl:'',resourceUrls:[],binaryImages};
 }
}
