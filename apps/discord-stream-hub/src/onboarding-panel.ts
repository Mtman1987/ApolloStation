import {createHash,randomUUID} from "node:crypto";
import type {SpmtClient} from "@spmt/sdk";
import type {DshLiveRuntimeConfigV1} from "./live-worker.js";
import {SqliteDshCalendarStore} from "./calendar.js";
import {DshDiscordError,SqliteDshDiscordMessageStore,type DshDiscordTransportV1} from "./discord-live-publisher.js";
const key=(guild:string)=>`onboarding:${guild}`;
type Target={channelId:string;error?:string;checkedAt?:string};
export const DSH_ONBOARDING_CUSTOM_ID="spmt_join_recover";
export function dshOnboardingPanel(){return {embeds:[{title:"Welcome aboard",description:"Connect Discord and Twitch to your SPMT account. The same sign-in flow helps you join, claim an existing account or recover access.",color:0xffd700,fields:[{name:"One identity",value:"Discord · Twitch · SPMT",inline:true}]}],components:[{type:1,components:[{type:2,style:3,label:"Join or recover SPMT with Twitch",custom_id:DSH_ONBOARDING_CUSTOM_ID}]}],allowed_mentions:{parse:[]}};}
/** Only destination and delivery receipts live in DSH; SPMT owns accounts and setup tickets. */
export class DshOnboardingPanel {
  constructor(private readonly state:SqliteDshCalendarStore,private readonly messages:SqliteDshDiscordMessageStore,private readonly discord:DshDiscordTransportV1,private readonly client:SpmtClient,private readonly config:DshLiveRuntimeConfigV1,private readonly publicOrigin:string,private readonly now=()=>new Date().toISOString()){}
  private tenant(tenant:string,guild:string){const result=this.config.tenants.find(t=>t.tenantId===tenant);if(!result?.discordGuildIds?.includes(guild))throw Error("Choose a Discord server configured for this tenant");return result;}
  view(tenant:string,guild:string){this.tenant(tenant,guild);return {guildId:guild,target:this.state.state<Target>(tenant,key(guild))??null,message:this.messages.get(tenant,"onboarding",guild)??null};}
  async publish(tenant:string,guild:string,channel:string){
    this.tenant(tenant,guild);const owner=randomUUID(),lease=`panel:${guild}`;if(!this.state.acquire(tenant,lease,owner))throw Error("The linking panel is being updated");
    try{
      const channels=await this.discord.listGuildChannels(tenant,guild);if(!channels.some(c=>c.id===channel))throw Error("Choose an existing channel in this server to restore the linking panel");
      this.state.renew(tenant,lease,owner);this.state.setState(tenant,key(guild),{channelId:channel} satisfies Target);
      const previous=this.messages.get(tenant,"onboarding",guild),payload=dshOnboardingPanel();let id:string|undefined;
      if(previous?.channelId===channel)try{await this.discord.editMessage(tenant,channel,previous.messageId,payload);id=previous.messageId;}catch(error){if(!(error instanceof DshDiscordError)||error.status!==404)throw error;}
      else if(previous)try{await this.discord.deleteMessage(tenant,previous.channelId,previous.messageId);}catch(error){if(!(error instanceof DshDiscordError)||error.status!==404)throw error;}
      this.state.renew(tenant,lease,owner);id??=await this.discord.createMessage(tenant,channel,{...payload,nonce:createHash("sha256").update(JSON.stringify([tenant,guild,channel,previous?.messageId??"initial"])).digest("hex").slice(0,24),enforce_nonce:true});
      this.messages.put({tenantId:tenant,kind:"onboarding",key:guild,channelId:channel,messageId:id,updatedAt:this.now()});this.state.setState(tenant,key(guild),{channelId:channel,checkedAt:this.now()} satisfies Target);return {messageId:id,channelId:channel};
    }catch(error){const target=this.state.state<Target>(tenant,key(guild));if(target){this.state.renew(tenant,lease,owner);this.state.setState(tenant,key(guild),{...target,checkedAt:this.now(),error:"Linking panel delivery is pending. If the channel was removed, choose its replacement in DSH Settings."});}throw error;}
    finally{this.state.release(tenant,lease,owner);}
  }
  async flush(tenant:string){for(const guild of this.config.tenants.find(t=>t.tenantId===tenant)?.discordGuildIds??[]){const target=this.state.state<Target>(tenant,key(guild));if(target&&(!target.checkedAt||Date.parse(this.now())-Date.parse(target.checkedAt)>=60000))await this.publish(tenant,guild,target.channelId).catch(()=>undefined);}}
  async interaction(input:Record<string,any>){const id=String(input.data?.custom_id??""),aliases=new Set([DSH_ONBOARDING_CUSTOM_ID,"spmt_onboard","link_twitch_account"]);if(!aliases.has(id)&&!id.startsWith("link_twitch_")&&!this.config.tenants.some(t=>t.branding?.onboardingCustomId===id))return undefined;
    const reply=(content:string,components:unknown[]=[])=>({type:4,data:{flags:64,content,components,allowed_mentions:{parse:[]}}});
    try{
      if(input.type!==3)throw Error("Use the join or recover button to continue");
      const guild=String(input.guild_id??""),tenant=this.config.tenants.find(t=>t.discordGuildIds?.includes(guild));if(!tenant)throw Error("This Discord server is not connected to SPMT");
      const actor=input.member?.user??input.user;if(!/^\d{5,30}$/.test(String(actor?.id??"")))throw Error("Discord could not verify your identity");
      const result=await this.client.request<{welcome:{setupUrl:string;actionLabel:string}}>("/v1/onboarding/discord-invite",{method:"POST",tenantId:tenant.tenantId,headers:{"content-type":"application/json"},body:JSON.stringify({tenantId:tenant.tenantId,discord:{id:String(actor.id),username:String(actor.username??actor.id)},displayName:String(input.member?.nick??actor.global_name??actor.username??actor.id)})});
      const url=new URL(result.welcome.setupUrl),origin=new URL(this.publicOrigin);if(url.origin!==origin.origin||url.pathname!=="/v1/onboarding/twitch/start"||url.username||url.password)throw Error("SPMT returned an invalid account setup destination");
      return reply("Continue with Twitch to join, claim or recover your existing SPMT account. This link is private to you.",[{type:1,components:[{type:2,style:5,label:result.welcome.actionLabel||"Continue with Twitch",url:url.href}]}]);
    }catch{return reply("SPMT account setup is temporarily unavailable. Try the button again shortly, or open Account in ApolloStation.");}
  }
}
