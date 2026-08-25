import type { StreamWeaverDonorCommandExecutionV1, StreamWeaverDonorCommandInvocationV1, StreamWeaverDonorCommandServicesV1 } from "./donor-command-runtime.js";
import type { StreamWeaverTwitchCommandAdapter } from "./twitch-command-adapter.js";

export interface StreamWeaverTenantLinksV1 { discord?:string; hover?:string; instagram?:string; merch?:string; tiktok?:string; twitter?:string; webpage?:string; youtube?:string; }
export interface StreamWeaverLinkSourceV1 { getLinks(tenantId:string):Promise<StreamWeaverTenantLinksV1>|StreamWeaverTenantLinksV1; }
export interface StreamWeaverTwitchIdentitySourceV1 { resolveTwitchUserId(input:{tenantId:string;canonicalUserId?:string;provider:string;providerUserId:string}):Promise<string|undefined>|string|undefined; }
export interface StreamWeaverCapabilityExecutorV1 { execute(input:StreamWeaverDonorCommandInvocationV1):Promise<string|undefined>|string|undefined; }
export interface StreamWeaverTranslationServiceV1 { translate(input:{tenantId:string;text:string;requestedByUserId?:string;provider:string}):Promise<string>|string; }

export interface DefaultStreamWeaverDonorServicesOptionsV1 {
  twitch?:StreamWeaverTwitchCommandAdapter;
  twitchIdentities?:StreamWeaverTwitchIdentitySourceV1;
  links?:StreamWeaverLinkSourceV1;
  bic?:StreamWeaverCapabilityExecutorV1;
  socialEffects?:StreamWeaverCapabilityExecutorV1;
  moderation?:StreamWeaverCapabilityExecutorV1;
  community?:StreamWeaverCapabilityExecutorV1;
  watchtime?:StreamWeaverCapabilityExecutorV1;
  music?:StreamWeaverCapabilityExecutorV1;
  redeems?:StreamWeaverCapabilityExecutorV1;
  system?:StreamWeaverCapabilityExecutorV1;
  persona?:StreamWeaverCapabilityExecutorV1;
  pokemon?:StreamWeaverCapabilityExecutorV1;
  secrets?:StreamWeaverCapabilityExecutorV1;
  translation?:StreamWeaverTranslationServiceV1;
}

export class DefaultStreamWeaverDonorCommandServices implements StreamWeaverDonorCommandServicesV1 {
  constructor(private readonly options:DefaultStreamWeaverDonorServicesOptionsV1){}

  async execute(invocation:StreamWeaverDonorCommandInvocationV1):Promise<StreamWeaverDonorCommandExecutionV1|undefined>{
    switch(invocation.command.family){
      case "links": return this.links(invocation);
      case "twitch": return this.twitch(invocation);
      case "moderation": return this.moderation(invocation);
      case "community": return this.community(invocation);
      case "watchtime": return this.delegate(this.options.watchtime,invocation);
      case "music": return this.delegate(this.options.music,invocation);
      case "redeem": return this.delegate(this.options.redeems,invocation);
      case "system": return this.delegate(this.options.system,invocation);
      case "persona": return this.delegate(this.options.persona,invocation);
      case "pokemon": return this.delegate(this.options.pokemon,invocation);
      case "secret": return this.delegate(this.options.secrets,invocation);
      case "social": return this.delegate(this.options.socialEffects,invocation,true);
      case "economy": return undefined;
    }
  }

  private async links(invocation:StreamWeaverDonorCommandInvocationV1){
    if(!this.options.links)return unavailable("Tenant link settings are not configured.");
    const links=await this.options.links.getLinks(invocation.tenantId);
    const key=invocation.canonicalTrigger.slice(1) as keyof StreamWeaverTenantLinksV1;
    const value=links[key]; if(!value)return unavailable(`${key} link is not configured.`);
    return {handled:true,text:value};
  }

  private async twitch(invocation:StreamWeaverDonorCommandInvocationV1){
    if(!this.options.twitch)return unavailable("Twitch command service is unavailable.");
    try{
      switch(invocation.canonicalTrigger){
        case "!clip": { const clip=await this.options.twitch.createClip(invocation.tenantId); return {handled:true,text:`Clip created: ${clip.url}`}; }
        case "!followers": { const total=await this.options.twitch.followers(invocation.tenantId); return {handled:true,text:`This channel has ${total.toLocaleString("en-US")} followers.`}; }
        case "!uptime": { const stream=await this.options.twitch.uptime(invocation.tenantId); if(!stream)return {handled:true,text:"The channel is offline."}; return {handled:true,text:`Live for ${formatDuration(Date.now()-Date.parse(stream.startedAt))} • ${stream.viewerCount.toLocaleString("en-US")} viewers • ${stream.gameName||"No category"}`}; }
        case "!followage":
        case "!followed": {
          const twitchUserId=await this.resolveTwitchUserId(invocation); if(!twitchUserId)return unavailable("A linked Twitch identity is required for follow history.");
          const follow=await this.options.twitch.followed(invocation.tenantId,twitchUserId); if(!follow)return {handled:true,text:`@${invocation.actor.displayName} is not currently following this channel.`};
          if(invocation.canonicalTrigger==="!followed")return {handled:true,text:`@${invocation.actor.displayName} followed on ${new Date(follow.followedAt).toISOString().slice(0,10)}.`};
          return {handled:true,text:`@${invocation.actor.displayName} has followed for ${formatDuration(Date.now()-Date.parse(follow.followedAt))}.`};
        }
      }
    }catch(error){return unavailable(error instanceof Error?error.message:"Twitch command failed.");}
    return undefined;
  }

  private async moderation(invocation:StreamWeaverDonorCommandInvocationV1){
    if(!invocation.actor.isModerator)return {handled:true,text:`@${invocation.actor.displayName}, only mods can use that!`};
    if(this.options.twitch){
      try{
        if(invocation.canonicalTrigger==="!settitle"){const title=invocation.args.join(" ").trim();if(!title)return {handled:true,text:"Usage: !settitle <title>"};const result=await this.options.twitch.setTitle(invocation.tenantId,title);return {handled:true,text:`Title updated: ${result.title}`};}
        if(invocation.canonicalTrigger==="!setgame"){const game=invocation.args.join(" ").trim();if(!game)return {handled:true,text:"Usage: !setgame <category>"};const result=await this.options.twitch.setGame(invocation.tenantId,game);return {handled:true,text:`Category updated: ${result.name}`};}
        if(invocation.canonicalTrigger==="!so"){const login=(invocation.target?.username??invocation.args[0]??"").replace(/^@/,"");if(!login)return {handled:true,text:"Usage: !so @user"};const user=await this.options.twitch.sendShoutout(invocation.tenantId,login);return {handled:true,text:`Go check out @${user.displayName}: https://twitch.tv/${user.login}`};}
      }catch(error){return unavailable(error instanceof Error?error.message:"Twitch moderation command failed.");}
    }
    return this.delegate(this.options.moderation,invocation);
  }

  private async community(invocation:StreamWeaverDonorCommandInvocationV1){
    if(invocation.canonicalTrigger==="!bic"&&this.options.bic)return this.delegate(this.options.bic,invocation);
    if(invocation.canonicalTrigger==="!t"&&this.options.translation){
      const text=invocation.args.join(" ").trim(); if(!text)return {handled:true,text:"Usage: !T <text to translate>"};
      try{return {handled:true,text:await this.options.translation.translate({tenantId:invocation.tenantId,text,...(invocation.actor.userId?{requestedByUserId:invocation.actor.userId}:{}),provider:invocation.provider})};}
      catch(error){return unavailable(error instanceof Error?error.message:"Translation failed.");}
    }
    return this.delegate(this.options.community,invocation);
  }

  private async resolveTwitchUserId(invocation:StreamWeaverDonorCommandInvocationV1){
    if(invocation.provider==="twitch")return invocation.actor.providerUserId;
    return this.options.twitchIdentities?.resolveTwitchUserId({tenantId:invocation.tenantId,...(invocation.actor.userId?{canonicalUserId:invocation.actor.userId}:{}),provider:invocation.provider,providerUserId:invocation.actor.providerUserId});
  }

  private async delegate(executor:StreamWeaverCapabilityExecutorV1|undefined,invocation:StreamWeaverDonorCommandInvocationV1,builtinIsEnough=false){
    if(!executor)return builtinIsEnough?{handled:true}:unavailable(`${invocation.command.family} command service is unavailable.`);
    try{const text=await executor.execute(invocation);return {handled:true,...(text?{text}:{})};}
    catch(error){return unavailable(error instanceof Error?error.message:`${invocation.command.family} command failed.`);}
  }
}

function unavailable(text:string):StreamWeaverDonorCommandExecutionV1{return{handled:true,text};}
function formatDuration(ms:number){if(!Number.isFinite(ms)||ms<0)return"0m";const totalMinutes=Math.floor(ms/60_000);const days=Math.floor(totalMinutes/1440);const hours=Math.floor((totalMinutes%1440)/60);const minutes=totalMinutes%60;return[days?`${days}d`:"",hours?`${hours}h`:"",`${minutes}m`].filter(Boolean).join(" ");}
