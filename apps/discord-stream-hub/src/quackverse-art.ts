export const DSH_QUACKVERSE_ART_PROFILE = Object.freeze({
  master: { width: 2048, height: 1280, mimeType: "image/webp", quality: 94, fit: "cover", sharpen: 0.8 },
  hover: { width: 640, height: 400, fps: 10, forwardSeconds: 5, durationSeconds: 10, frameCount: 100, pingPong: true, loop: true, paletteLevels: [128, 96, 80, 64] as const, dither: "bayer", bayerScale: 4, diffMode: "rectangle" },
  maxBytes: 50 * 1_024 * 1_024,
});

export interface DshQuackverseArtRendererV1 {
  enhanceAndAnimate(input: { source: Uint8Array; profile: typeof DSH_QUACKVERSE_ART_PROFILE }): Promise<{ master: Uint8Array; hover: Uint8Array; paletteColors: 128 | 96 | 80 | 64 }>;
}

export async function renderDshQuackverseArt(renderer: DshQuackverseArtRendererV1, sourceValue: Uint8Array) {
  const source = Uint8Array.from(sourceValue);
  if (!source.byteLength || source.byteLength > DSH_QUACKVERSE_ART_PROFILE.maxBytes) throw new Error("Quackverse source image must be between 1 byte and 50 MB");
  const result = await renderer.enhanceAndAnimate({ source, profile: DSH_QUACKVERSE_ART_PROFILE });
  const master = Uint8Array.from(result.master), hover = Uint8Array.from(result.hover);
  if (!master.byteLength || master.byteLength > DSH_QUACKVERSE_ART_PROFILE.maxBytes) throw new Error("Quackverse enhanced image exceeded 50 MB");
  if (hover.byteLength < 6 || hover.byteLength > DSH_QUACKVERSE_ART_PROFILE.maxBytes || new TextDecoder().decode(hover.subarray(0, 6)) !== "GIF89a") throw new Error("Quackverse hover renderer returned an invalid or oversized GIF");
  if (![128, 96, 80, 64].includes(result.paletteColors)) throw new Error("Quackverse hover palette is invalid");
  return { schemaVersion: 1 as const, renderer: "dsh-image-ffmpeg-pingpong", master: { bytes: master, ...DSH_QUACKVERSE_ART_PROFILE.master }, hover: { bytes: hover, ...DSH_QUACKVERSE_ART_PROFILE.hover, paletteColors: result.paletteColors, firstAndLastFrameMatch: true } };
}

export const DSH_QUACKVERSE_ART_RENDER_CAPABILITY="dsh.quackverse.art.render.v1";
export interface DshQuackverseArtExecutionClientV1{claimAnyExecutionJob(workerId:string,target:"sprite",options:{executionOwner:string;capabilityIds:string[];leaseMs:number}):Promise<import("@spmt/contracts").ExecutionJobV1|null>;heartbeatExecutionJob(tenantId:string,jobId:string,workerId:string,leaseId:string,fencingEpoch:number,progress:{percent:number;message:string},leaseMs:number):Promise<unknown>;succeedExecutionJob(tenantId:string,jobId:string,workerId:string,leaseId:string,fencingEpoch:number,result:Record<string,unknown>):Promise<unknown>;failExecutionJob(tenantId:string,jobId:string,workerId:string,leaseId:string,fencingEpoch:number,code:string,message:string,retryable:boolean):Promise<unknown>;}
export interface DshQuackverseArtSourceV1{load(url:string):Promise<Uint8Array>;}
export interface DshQuackverseArtPublisherV1{publish(input:{tenantId:string;cardId:number;master:Uint8Array;hover:Uint8Array}):Promise<{masterUrl:string;hoverUrl:string}>;}
export class DshQuackverseArtExecutionWorker{
  constructor(private readonly client:DshQuackverseArtExecutionClientV1,private readonly source:DshQuackverseArtSourceV1,private readonly renderer:DshQuackverseArtRendererV1,private readonly publisher:DshQuackverseArtPublisherV1,private readonly workerId:string){}
  async runOnce(){const job=await this.client.claimAnyExecutionJob(this.workerId,"sprite",{executionOwner:"discord-stream-hub",capabilityIds:[DSH_QUACKVERSE_ART_RENDER_CAPABILITY],leaseMs:20*60_000});if(!job)return undefined;await this.execute(job);return job.id;}
  private async execute(job:import("@spmt/contracts").ExecutionJobV1){if(!job.leaseId)throw new Error("Claimed Quackverse art job has no lease");const lease=[job.tenantId,job.id,this.workerId,job.leaseId,job.fencingEpoch]as const;try{const cardId=Math.trunc(Number(job.input.cardId)),sourceImageUrl=safeSourceUrl(job.input.sourceImageUrl);if(!Number.isSafeInteger(cardId)||cardId<1||cardId>100_000)throw new Error("Quackverse art card id is invalid");await this.client.heartbeatExecutionJob(...lease,{percent:10,message:"Loading the canonical Quackverse source"},20*60_000);const source=await this.source.load(sourceImageUrl);await this.client.heartbeatExecutionJob(...lease,{percent:30,message:"Enhancing master art and rendering hover animation"},20*60_000);const rendered=await renderDshQuackverseArt(this.renderer,source);await this.client.heartbeatExecutionJob(...lease,{percent:90,message:"Publishing Quackverse art outputs"},20*60_000);const published=await this.publisher.publish({tenantId:job.tenantId,cardId,master:rendered.master.bytes,hover:rendered.hover.bytes});await this.client.succeedExecutionJob(...lease,{schemaVersion:1,cardId,masterUrl:safeOutputUrl(published.masterUrl),hoverUrl:safeOutputUrl(published.hoverUrl),masterBytes:rendered.master.bytes.byteLength,hoverBytes:rendered.hover.bytes.byteLength,paletteColors:rendered.hover.paletteColors});}catch(error){const message=safeExecutionError(error),retryable=/temporar|timeout|unavailable|publish|load|network/i.test(message);await this.client.failExecutionJob(...lease,retryable?"quackverse-art-unavailable":"quackverse-art-invalid",message,retryable);}}
}
function safeSourceUrl(value:unknown){const url=new URL(String(value??""));if(url.protocol!=="https:"||url.username||url.password||url.hash)throw new Error("Quackverse source image URL is invalid");return url.toString();}
function safeOutputUrl(value:string){const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password)throw new Error("Quackverse published art URL is invalid");return url.toString();}
function safeExecutionError(value:unknown){return(value instanceof Error?value.message:String(value)).replace(/(?:authorization|token|secret|password)\s*[:=]?\s*\S+/gi,"$1=[redacted]").slice(0,500);}
