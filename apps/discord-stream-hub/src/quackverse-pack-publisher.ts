import { buildQuackversePackDiscordPayload, type QuackversePackPresentationInputV1 } from "@spmt/nebula-arcade";
import type { DshDiscordApi } from "./discord-live-publisher.js";

export const DSH_QUACKVERSE_PACK_RENDER_TIMEOUT_MS=120_000;
export const DSH_QUACKVERSE_PACK_CLEANUP_DELAY_MS=10*60_000;

export interface DshQuackversePackRenderPortV1 { render(input:{tenantId:string;userId:string;packId:string;username:string;cards:QuackversePackPresentationInputV1["pack"]},timeoutMs:number):Promise<{gifUrl?:string;status:string;attempts:number;error?:string;timedOut?:boolean}>; }

/** Sends the useful static result immediately, then edits that exact message when its GIF is ready. */
export class DshQuackversePackPublisher {
  constructor(private readonly discord:DshDiscordApi,private readonly renderer:DshQuackversePackRenderPortV1,private readonly scheduleCleanup:(task:()=>void,delayMs:number)=>void=defaultSchedule){}
  async present(input:{tenantId:string;userId:string;channelId:string;presentation:QuackversePackPresentationInputV1}){
    const initial=buildQuackversePackDiscordPayload(input.presentation),messageId=await this.discord.createMessage(input.tenantId,input.channelId,initial),base={messageId,channelId:input.channelId,packId:input.presentation.packId};
    try{
      const result=await this.renderer.render({tenantId:input.tenantId,userId:input.userId,packId:input.presentation.packId,username:input.presentation.username,cards:input.presentation.pack},DSH_QUACKVERSE_PACK_RENDER_TIMEOUT_MS);
      if(result.gifUrl){const payload=buildQuackversePackDiscordPayload({...input.presentation,gifUrl:result.gifUrl});await this.discord.editMessage(input.tenantId,input.channelId,messageId,payload);this.cleanup(input.tenantId,input.channelId,messageId);return{...base,success:true as const,gifUrl:result.gifUrl,render:result};}
      await this.discord.editMessage(input.tenantId,input.channelId,messageId,buildQuackversePackDiscordPayload({...input.presentation,animationUnavailable:true}));this.cleanup(input.tenantId,input.channelId,messageId);return{...base,success:false as const,render:result};
    }catch(error){await this.discord.editMessage(input.tenantId,input.channelId,messageId,buildQuackversePackDiscordPayload({...input.presentation,animationUnavailable:true})).catch(()=>undefined);this.cleanup(input.tenantId,input.channelId,messageId);return{...base,success:false as const,render:{status:"failed",attempts:0,error:safeError(error),timedOut:false}};}
  }
  private cleanup(tenantId:string,channelId:string,messageId:string){this.scheduleCleanup(()=>{void this.discord.deleteMessage(tenantId,channelId,messageId).catch(()=>undefined);},DSH_QUACKVERSE_PACK_CLEANUP_DELAY_MS);}
}
function defaultSchedule(task:()=>void,delayMs:number){const timer=setTimeout(task,delayMs);timer.unref?.();}
function safeError(error:unknown){return(error instanceof Error?error.message:String(error)).replace(/(?:authorization|token|secret|password)\s*[:=]?\s*\S+/gi,"$1=[redacted]").slice(0,500);}
