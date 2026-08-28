import type { SpmtClient } from "@spmt/sdk";
import type { StreamWeaverTwitchCommandAdapter, StreamWeaverTwitchUserV1 } from "./twitch-command-adapter.js";
import type { SqliteStreamWeaverShoutoutStore } from "./shoutout-store.js";
import { matchStreamWeaverShoutoutTarget, type StreamWeaverShoutoutAiMatcherV1 } from "./shoutout-matcher.js";
import type { StreamWeaverChatterV1 } from "./username-matcher.js";

export const STREAMWEAVER_SHOUTOUT_AUDIT = "streamweaver.shoutout.audit.v1";
export const STREAMWEAVER_SHOUTOUT_EFFECT_REQUESTED = "streamweaver.shoutout.effect.requested.v1";
export const STREAMWEAVER_SHOUTOUT_ACTIONS = [
  { id:"athena-shoutout", name:"Athena Voice Shoutout", intent:"voice" },
  { id:"8a6e2cfb-a55b-424c-acdc-f775c74c4758", name:"!so - Custom Shout out", intent:"manual" },
  { id:"2936fced-41e5-4894-bd73-04f70a5d3ce2", name:"!setso - Set custom shout out", intent:"configuration" },
  { id:"01f58d95-8f37-4359-8943-ca41be5fe1ae", name:"!vso - Video Shout out v2", intent:"video" },
] as const;

export type StreamWeaverShoutoutModeV1 = "full" | "overlay" | "chat";
export type StreamWeaverShoutoutSourceV1 = "auto-welcome" | "manual" | "voice" | "recovery" | "unknown";
export type StreamWeaverShoutoutEffectV1 = "chat-link" | "clip" | "chat-greeting" | "overlay-greeting" | "tts" | "discord";

export interface StreamWeaverShoutoutChatterSourceV1 {
  list(input:{tenantId:string;provider:"twitch";channelId:string}):Promise<readonly StreamWeaverChatterV1[]>|readonly StreamWeaverChatterV1[];
}
export interface StreamWeaverShoutoutGreetingGeneratorV1 {
  generate(input:{tenantId:string;user:StreamWeaverTwitchUserV1;shoutoutCount:number;source:StreamWeaverShoutoutSourceV1}):Promise<string>|string;
}
export interface StreamWeaverShoutoutClipV1 { url:string; thumbnailUrl?:string; durationSeconds:number; }
export interface StreamWeaverShoutoutClipSourceV1 {
  pick(input:{tenantId:string;user:StreamWeaverTwitchUserV1}):Promise<StreamWeaverShoutoutClipV1|undefined>|StreamWeaverShoutoutClipV1|undefined;
}
export interface StreamWeaverShoutoutEffectExecutorV1 {
  execute(input:{tenantId:string;effect:StreamWeaverShoutoutEffectV1;payload:Record<string,unknown>}):Promise<void>|void;
}
export interface StreamWeaverShoutoutModeSourceV1 { get(tenantId:string):Promise<string|undefined>|string|undefined; }

export interface StreamWeaverShoutoutRuntimeOptionsV1 {
  client:Pick<SpmtClient,"publishEvent">;
  twitch:StreamWeaverTwitchCommandAdapter;
  store:SqliteStreamWeaverShoutoutStore;
  chatters:StreamWeaverShoutoutChatterSourceV1;
  aiMatcher?:StreamWeaverShoutoutAiMatcherV1;
  greeting?:StreamWeaverShoutoutGreetingGeneratorV1;
  clips?:StreamWeaverShoutoutClipSourceV1;
  effects?:StreamWeaverShoutoutEffectExecutorV1;
  modes?:StreamWeaverShoutoutModeSourceV1;
}

export interface StreamWeaverShoutoutResultV1 {
  completed:boolean;
  skippedReason?:"known-bot"|"excluded-user"|"cooldown"|"no-match"|"user-not-found";
  matchedLogin?:string;
  mode?:StreamWeaverShoutoutModeV1;
  effects:string[];
}

export class StreamWeaverShoutoutRuntime {
  constructor(private readonly options:StreamWeaverShoutoutRuntimeOptionsV1){}

  async voice(input:{tenantId:string;invocationId:string;spokenName:string;channelId:string}):Promise<StreamWeaverShoutoutResultV1>{
    const tenantId=safeId(input.tenantId,"tenantId"); const invocationId=safeId(input.invocationId,"invocationId");
    const spoken=String(input.spokenName??"").trim().replace(/^(?:out)?\s*/i,"").slice(0,120);
    if(!spoken)return {completed:false,skippedReason:"no-match",effects:[]};
    const chatters=await this.options.chatters.list({tenantId,provider:"twitch",channelId:safeId(input.channelId,"channelId")});
    const candidates=chatters.map(chatter=>chatter.userLogin);
    const match=await matchStreamWeaverShoutoutTarget({tenantId,spokenName:spoken,candidates,...(this.options.aiMatcher?{ai:this.options.aiMatcher}:{})});
    if(!match){await this.audit(tenantId,invocationId,"athena-shoutout","skipped",{reason:"no-match",spokenName:spoken});return {completed:false,skippedReason:"no-match",effects:[]};}
    const user=await this.options.twitch.lookupUser(tenantId,match);
    if(!user){await this.audit(tenantId,invocationId,"athena-shoutout","skipped",{reason:"user-not-found",matchedLogin:match});return {completed:false,skippedReason:"user-not-found",matchedLogin:match,effects:[]};}
    return this.run({tenantId,invocationId,donorActionId:"athena-shoutout",source:"voice",user,skipCooldown:true});
  }

  async manual(input:{tenantId:string;invocationId:string;targetLogin:string;source?:StreamWeaverShoutoutSourceV1;skipCooldown?:boolean;forceMode?:StreamWeaverShoutoutModeV1;donorActionId?:string}):Promise<StreamWeaverShoutoutResultV1>{
    const tenantId=safeId(input.tenantId,"tenantId"); const login=safeLogin(input.targetLogin);
    const user=await this.options.twitch.lookupUser(tenantId,login);
    if(!user)return {completed:false,skippedReason:"user-not-found",matchedLogin:login,effects:[]};
    return this.run({tenantId,invocationId:safeId(input.invocationId,"invocationId"),donorActionId:input.donorActionId??"8a6e2cfb-a55b-424c-acdc-f775c74c4758",source:input.source??"manual",user,skipCooldown:input.skipCooldown??true,...(input.forceMode?{forceMode:input.forceMode}:{})});
  }

  private async run(input:{tenantId:string;invocationId:string;donorActionId:string;source:StreamWeaverShoutoutSourceV1;user:StreamWeaverTwitchUserV1;skipCooldown:boolean;forceMode?:StreamWeaverShoutoutModeV1}):Promise<StreamWeaverShoutoutResultV1>{
    const eligibility=this.options.store.eligibility(input.tenantId,input.user.login,input.skipCooldown);
    if(!eligibility.eligible){
      await this.audit(input.tenantId,input.invocationId,input.donorActionId,"skipped",{reason:eligibility.reason,...("remainingMs" in eligibility&&eligibility.remainingMs!==undefined?{remainingMs:eligibility.remainingMs}:{})});
      return {completed:false,skippedReason:eligibility.reason,matchedLogin:input.user.login,effects:[]};
    }
    const mode=input.forceMode??resolveStreamWeaverShoutoutMode(await this.options.modes?.get(input.tenantId));
    await this.audit(input.tenantId,input.invocationId,input.donorActionId,"started",{username:input.user.login,displayName:input.user.displayName,source:input.source,mode,skipCooldown:input.skipCooldown});
    const greeting=await this.generateGreeting(input.tenantId,input.user,eligibility.count,input.source);
    const effects:string[]=[];

    if(mode==="chat"){
      const text=`${greeting} | Go check out @${input.user.displayName}: https://twitch.tv/${input.user.login}`;
      await this.effect(input,"chat-greeting",{text,username:input.user.login,displayName:input.user.displayName}); effects.push("chat-greeting");
    }else{
      await this.effect(input,"chat-link",{text:`Shoutout: go check out @${input.user.displayName} at https://twitch.tv/${input.user.login}`,username:input.user.login,displayName:input.user.displayName}); effects.push("chat-link");
      const clip=await this.safeClip(input.tenantId,input.user);
      if(clip){await this.effect(input,"clip",{...clip,user:input.user.displayName,profileImage:input.user.profileImageUrl??""});effects.push("clip");}
      if(mode==="full"){await this.effect(input,"chat-greeting",{text:greeting,username:input.user.login,displayName:input.user.displayName});effects.push("chat-greeting");}
      else {await this.effect(input,"overlay-greeting",{text:greeting,username:input.user.login,displayName:input.user.displayName});effects.push("overlay-greeting");}
      await this.effect(input,"tts",{text:greeting,username:input.user.login,displayName:input.user.displayName});effects.push("tts");
    }
    await this.effect(input,"discord",{text:greeting,username:input.user.login,displayName:input.user.displayName,twitchUrl:`https://twitch.tv/${input.user.login}`});effects.push("discord");
    if(!input.skipCooldown)this.options.store.record(input.tenantId,input.user.login,`shoutout:${input.invocationId}`);
    await this.audit(input.tenantId,input.invocationId,input.donorActionId,"completed",{username:input.user.login,displayName:input.user.displayName,source:input.source,mode,effects});
    return {completed:true,matchedLogin:input.user.login,mode,effects};
  }

  private async generateGreeting(tenantId:string,user:StreamWeaverTwitchUserV1,shoutoutCount:number,source:StreamWeaverShoutoutSourceV1):Promise<string>{
    try{const generated=await this.options.greeting?.generate({tenantId,user,shoutoutCount,source});if(generated&&String(generated).trim())return safeText(generated,500);}
    catch{/* donor behavior falls back if AI greeting fails */}
    return shoutoutCount===0?`Welcome, @${user.displayName}! Glad you're here!`:`Welcome back, @${user.displayName}! Glad you're here!`;
  }
  private async safeClip(tenantId:string,user:StreamWeaverTwitchUserV1):Promise<StreamWeaverShoutoutClipV1|undefined>{try{return await this.options.clips?.pick({tenantId,user});}catch{return undefined;}}
  private async effect(input:{tenantId:string;invocationId:string;donorActionId:string},effect:StreamWeaverShoutoutEffectV1,payload:Record<string,unknown>):Promise<void>{
    await this.options.client.publishEvent(input.tenantId,STREAMWEAVER_SHOUTOUT_EFFECT_REQUESTED,{schemaVersion:1,invocationId:input.invocationId,donorActionId:input.donorActionId,effect,payload:sanitize(payload)},`streamweaver-shoutout-effect:${input.invocationId}:${effect}`);
    await this.options.effects?.execute({tenantId:input.tenantId,effect,payload:sanitize(payload)});
  }
  private async audit(tenantId:string,invocationId:string,donorActionId:string,status:string,metadata:Record<string,unknown>):Promise<void>{
    await this.options.client.publishEvent(tenantId,STREAMWEAVER_SHOUTOUT_AUDIT,{schemaVersion:1,invocationId,donorActionId,status:safeToken(status),metadata:sanitize(metadata)},`streamweaver-shoutout-audit:${invocationId}:${safeToken(status)}`);
  }
}

export function resolveStreamWeaverShoutoutMode(value:unknown,legacySkipOverlay=false):StreamWeaverShoutoutModeV1{
  const mode=String(value??"").trim().toLowerCase(); if(mode==="full"||mode==="overlay"||mode==="chat")return mode; if(mode==="on")return"full"; if(mode==="off")return"chat"; return legacySkipOverlay?"chat":"full";
}
function sanitize(input:Record<string,unknown>):Record<string,unknown>{const out:Record<string,unknown>={};for(const[key,value]of Object.entries(input).slice(0,80)){if(/token|secret|password|authorization|cookie|api.?key/i.test(key))continue;const k=key.replace(/[^A-Za-z0-9._:-]/g,"").slice(0,80);if(!k)continue;if(typeof value==="string")out[k]=value.slice(0,2000);else if(typeof value==="number"||typeof value==="boolean"||value===null)out[k]=value;else if(Array.isArray(value))out[k]=value.slice(0,20).map(item=>String(item).slice(0,100));}return out;}
function safeId(value:unknown,field:string){const v=String(value??"").trim().replace(/[^A-Za-z0-9._:-]/g,"").slice(0,200);if(!v)throw new Error(`${field} is required`);return v;}
function safeLogin(value:unknown){const v=String(value??"").trim().replace(/^@/,"").toLowerCase();if(!/^[a-z0-9_]{1,25}$/.test(v))throw new Error("Twitch login is invalid");return v;}
function safeText(value:unknown,max:number){return String(value??"").trim().replace(/[\r\n\u0000-\u001f]+/g," ").slice(0,max);}
function safeToken(value:unknown){return String(value??"").trim().replace(/[^A-Za-z0-9._:-]/g,"").slice(0,80)||"unknown";}
