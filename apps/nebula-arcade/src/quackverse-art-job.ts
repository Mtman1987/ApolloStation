import { getQuackverseVisualCanon } from "./quackverse-visual-canon.js";
import { quackversePresentationDirection,quackversePresentationNegativePrompt } from "./quackverse-presentation.js";

export const NEBULA_QUACKVERSE_ART_RENDER_CAPABILITY="dsh.quackverse.art.render.v1";
export interface NebulaQuackverseArtJobClientV1{createExecutionJob(tenantId:string,input:Record<string,unknown>,idempotencyKey:string,correlationId?:string):Promise<{job:unknown;duplicate:boolean}>;}
export interface NebulaQuackverseArtCardV1{id:number;name:string;type:string;role?:string;family?:string;flavor?:string;sourceImageUrl:string;}

/** Nebula supplies canon; DSH owns enhancement, animation, and media publication. */
export class NebulaQuackverseArtCoordinator{
  constructor(private readonly client:NebulaQuackverseArtJobClientV1){}
  async request(tenantId:string,userId:string,card:NebulaQuackverseArtCardV1){const sourceImageUrl=https(card.sourceImageUrl),canon=getQuackverseVisualCanon(card),presentationDirection=quackversePresentationDirection(card,canon),negativePrompt=quackversePresentationNegativePrompt(card,canon),correlationId=`quackverse-art:${card.id}`;const result=await this.client.createExecutionJob(clean(tenantId,"tenantId"),{ownerAppId:"nebula-arcade",capabilityId:NEBULA_QUACKVERSE_ART_RENDER_CAPABILITY,executionOwner:"discord-stream-hub",billedUserId:clean(userId,"userId"),meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"sprite",meteringTarget:"hosted",input:{schemaVersion:1,cardId:card.id,cardName:label(card.name),sourceImageUrl,canon,presentationDirection,negativePrompt}},`nebula-quackverse-art:${tenantId}:${card.id}`,correlationId);return{canon,presentationDirection,negativePrompt,job:result.job,duplicate:result.duplicate};}
}
function https(value:string){const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password||url.hash)throw new Error("Quackverse source image URL is invalid");return url.toString();}
function clean(value:string,name:string){const result=String(value??"").trim();if(!/^[A-Za-z0-9._:@/-]{1,200}$/.test(result))throw new Error(`Quackverse ${name} is invalid`);return result;}
function label(value:string){const result=String(value??"").trim();if(!result||result.length>100||/[\r\n\0]/.test(result))throw new Error("Quackverse card name is invalid");return result;}
