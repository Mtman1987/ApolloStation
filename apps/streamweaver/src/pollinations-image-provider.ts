import {randomInt} from 'node:crypto';
import type {SeaArtImageRequestV1} from './seaart-cli.js';
import type {StreamWeaverGeneratedMediaV1} from './image-generation.js';
import {decodeBinaryImage,type StreamWeaverBinaryImage} from './binary-image.js';
export class PollinationsStreamWeaverImageProvider {
 readonly id='pollinations';
 constructor(private readonly token:string,private readonly fetchImpl:typeof fetch=fetch){if(!token.trim())throw Error('A Pollinations worker API key is required')}
 async listModels(){
  const response=await this.fetchImpl('https://gen.pollinations.ai/image/models?community=false',{headers:{authorization:`Bearer ${this.token}`,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`Pollinations catalog returned HTTP ${response.status}`);
  let rows;try{rows=JSON.parse((await boundedBody(response,1024*1024)).toString('utf8'))}catch{throw Error('Pollinations model catalog is invalid or too large')}
  if(!Array.isArray(rows))throw Error('Pollinations model catalog is invalid');const seen=new Set<string>();
  return rows.slice(0,2000).flatMap((row:Record<string,unknown>)=>{const id=row?.name??row?.id;if(typeof id!=='string'||!validModel(id)||seen.has(id)||!Array.isArray(row.output_modalities)||!row.output_modalities.includes('image'))return [];seen.add(id);return [{provider:this.id,id,label:typeof row.description==='string'?`${id} — ${row.description.slice(0,120)}`:id}]});
 }
 async generateImage(input:SeaArtImageRequestV1):Promise<StreamWeaverGeneratedMediaV1>{
  const model=input.pollinationsModel||'flux',count=input.count??1,resolution=input.resolution??'1024x1024';
  if(!validModel(model)||!input.prompt.trim()||input.prompt.length>3000||encodeURIComponent(input.prompt).length>8000||!Number.isInteger(count)||count<1||count>4||!['512x512','768x768','1024x1024','1024x768','768x1024'].includes(resolution))throw Error('Pollinations image settings are invalid');
  if(Object.keys(input.providerParams??{}).length)throw Error('Pollinations advanced parameters are not supported by this adapter');
  const [width,height]=resolution.split('x'),binaryImages:StreamWeaverBinaryImage[]=[],seed=input.seed||randomInt(1,2147483643);
  for(let i=0;i<count;i++){
   const url=new URL(`https://gen.pollinations.ai/image/${encodeURIComponent(input.prompt)}`);url.search=new URLSearchParams({model,width:width!,height:height!,seed:String((seed+i)%2147483647)}).toString();
   const response=await this.fetchImpl(url,{headers:{authorization:`Bearer ${this.token}`,accept:'image/png,image/jpeg,image/webp,image/gif'},redirect:'error',signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error(`Pollinations image generation returned HTTP ${response.status}`);
   const contentType=(response.headers.get('content-type')??'').split(';')[0]!,bytes=await boundedBody(response,8*1024*1024),image={contentType,base64:bytes.toString('base64')};decodeBinaryImage(image);binaryImages.push(image);
  }
  return {provider:this.id,kind:'image',resourceUrl:'',resourceUrls:[],binaryImages};
 }
}
function validModel(value:string){return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,119})?$/.test(value)}
async function boundedBody(response:Response,max:number){const reader=response.body?.getReader();if(!reader)throw Error('Pollinations returned no content');let size=0;const chunks:Uint8Array[]=[];try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max)throw Error('Pollinations response exceeded the size limit');chunks.push(part.value)}}finally{await reader.cancel()}return Buffer.concat(chunks)}
