import type { SpmtClient } from "@spmt/sdk";
import type { OutboundChatMessageV1 } from "@spmt/contracts";
import { StreamWeaverCommunityStore } from "./community-store.js";
import { StreamWeaverShoutoutRuntime, StreamWeaverGreetingPending } from "./donor-shoutout-actions.js";
import { SqliteStreamWeaverShoutoutStore } from "./shoutout-store.js";
import type { StreamWeaverTwitchCommandAdapter } from "./twitch-command-adapter.js";
import type { StreamWeaverPersonaSettingsStore } from "./persona-settings.js";

/** Production adapters for the donor shoutout behavior and a durable BRB clip program. */
export class StreamWeaverPresentationRuntime {
  private readonly shoutouts:StreamWeaverShoutoutRuntime;
  constructor(private readonly options:{store:StreamWeaverCommunityStore;shoutoutStore:SqliteStreamWeaverShoutoutStore;twitch:StreamWeaverTwitchCommandAdapter;client:SpmtClient;personas:StreamWeaverPersonaSettingsStore;connections:Array<{tenantId:string;provider:string;connectionId:string;channelId:string;desired:boolean}>;egress:{send(message:OutboundChatMessageV1):Promise<unknown>}}) {
    this.shoutouts=new StreamWeaverShoutoutRuntime({client:options.client,twitch:options.twitch,store:options.shoutoutStore,
      greeting:{generate:async({tenantId,invocationId,user,shoutoutCount})=>{
        const settings=options.shoutoutStore.settings(tenantId),fallback=settings.greeting.replaceAll("{user}",user.displayName).replaceAll("{count}",String(shoutoutCount));
        const prior=options.shoutoutStore.greeting(tenantId,invocationId);
        if(prior?.text)return prior.text;if(prior?.failed||!settings.aiEnabled)return fallback;
        const owner=options.personas.get(tenantId)?.ownerCanonicalUserId;if(!owner)return fallback;
        let jobId=prior?.jobId;
        if(!jobId){
          const result=await options.client.invokeCommunityAssistant(tenantId,{userId:owner,surface:"app",remember:false,routingPreference:"automatic",conversationId:`streamweaver:shoutout:${invocationId}`,message:`Write a public shoutout under 400 characters. Never include private context or unsupported claims. Owner style: ${settings.prompt}\nProfile data: ${JSON.stringify({login:user.login,displayName:user.displayName,previousShoutouts:shoutoutCount})}`},`shoutout-greeting:${invocationId}`);
          if(!("jobId" in result)||typeof result.jobId!=="string"){options.shoutoutStore.saveGreeting(tenantId,invocationId,{failed:true});return fallback;}
          jobId=result.jobId;options.shoutoutStore.saveGreeting(tenantId,invocationId,{jobId});
        }
        const job=await options.client.getExecutionJob(tenantId,jobId);
        if(job.tenantId!==tenantId||job.billedUserId!==owner||job.ownerAppId!=="stellar-core"||job.input.conversationId!==`streamweaver:shoutout:${invocationId}`)throw new Error("Shoutout greeting job was not found");
        if(job.state==="succeeded"){const text=String(job.result?.text??"").trim().slice(0,400)||fallback;options.shoutoutStore.saveGreeting(tenantId,invocationId,{jobId,text});return text;}
        if(["failed","cancelled","dead-letter"].includes(job.state)){options.shoutoutStore.saveGreeting(tenantId,invocationId,{jobId,failed:true});return fallback;}
        throw new StreamWeaverGreetingPending("Preparing shoutout greeting");
      }},
      modes:{get:tenant=>options.store.settings(tenant).shoutoutMode},
      chatters:{list:async({tenantId})=>(await options.twitch.chatters(tenantId)).map(c=>({userId:c.id,userLogin:c.username,userName:c.username}))},
      clips:{pick:async({tenantId,user})=>{const clip=(await options.twitch.clips(tenantId,user.id))[0];return clip?{url:clip.embed_url,thumbnailUrl:clip.thumbnail_url,durationSeconds:clip.duration}:undefined;}},
      effects:{execute:async({tenantId,effect,payload})=>{
        const key=`shoutout:${payload.invocationId}:${effect}`;
        if(effect==="tts") {const userId=options.personas.get(tenantId)?.ownerCanonicalUserId;if(!userId)throw new Error("Configure the persona owner before playing spoken shoutouts");await options.client.createExecutionJob(tenantId,{ownerAppId:"streamweaver",executionOwner:"stellar-core",capabilityId:"stellar.speech.synthesize.v1",billedUserId:userId,meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"sprite",meteringTarget:"hosted",input:{kind:"stellar.speech.request.v1",text:String(payload.text),voice:options.shoutoutStore.settings(tenantId).voice,remember:false,mediaVisibility:"public"}},key);return;}
        if(effect==="clip"||effect==="overlay-greeting"){options.store.enqueue(tenantId,key,effect==="clip"?"streamweaver.media.playback.v1":"streamweaver.welcome.v1",effect==="clip"?{kind:"shoutout-player",mediaUrl:payload.url,text:payload.user,durationMs:Number(payload.durationSeconds)*1000}:{text:payload.text,displayName:payload.displayName});return;}
        if(effect==="discord"&&!options.shoutoutStore.settings(tenantId).discordEnabled)return;
        const provider=effect==="discord"?"discord":"twitch",connection=options.connections.find(c=>c.tenantId===tenantId&&c.provider===provider&&c.desired);
        if(!connection){if(provider==="discord")return;throw new Error("Choose a Twitch chat destination for shoutouts");}
        await options.egress.send({schemaVersion:1,tenantId,provider,connectionId:connection.connectionId,channelId:connection.channelId,text:String(payload.text),idempotencyKey:key});
      }}});
  }
  async runOnce() {
    const {store,twitch}=this.options;
    for(const task of store.pendingTasks())try{
      if(task.body.action==="say") {
        const userId=this.options.personas.get(task.tenant)?.ownerCanonicalUserId;if(!userId)throw new Error("Configure the persona owner before speaking on stream");
        await this.options.client.createExecutionJob(task.tenant,{ownerAppId:"streamweaver",executionOwner:"stellar-core",capabilityId:"stellar.speech.synthesize.v1",billedUserId:userId,meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"sprite",meteringTarget:"hosted",input:{kind:"stellar.speech.request.v1",text:String(task.body.text),voice:String(task.body.voice||"deepgram:aura-2:athena"),remember:false,mediaVisibility:"public"}},`stream-say:${task.id}`);
      }else if(task.body.action==="shoutout")await this.shoutouts.manual({tenantId:task.tenant,invocationId:task.id,targetLogin:String(task.body.username),source:task.body.source==="auto-welcome"?"auto-welcome":"manual",skipCooldown:task.body.source!=="auto-welcome"});
      else if(task.body.action==="voice-shoutout") {
        const channel=this.options.connections.find(c=>c.tenantId===task.tenant&&c.provider==="twitch"&&c.desired);
        if(!channel)throw new Error("Choose a Twitch channel for voice shoutouts");
        const result=await this.shoutouts.voice({tenantId:task.tenant,invocationId:task.id,spokenName:String(task.body.username),channelId:channel.channelId});
        if(!result.completed)throw new Error(`No shoutout played: ${result.skippedReason}`);
      }else if(task.body.action==="brb-stop") {store.stopProgram(task.tenant);store.enqueue(task.tenant,task.id,"streamweaver.media.playback.v1",{kind:"brb-player",operation:"stop"});}
      else if(task.body.action==="brb-start") {
        const settings=store.settings(task.tenant),userIds=settings.brbMode==="viewer"?(await twitch.chatters(task.tenant)).slice(0,10).map(u=>u.id):[undefined];
        const clips=[];for(const userId of userIds)for(const clip of (await twitch.clips(task.tenant,userId)).slice(0,5))clips.push({url:clip.embed_url,duration:Math.min(120,Math.max(5,clip.duration)),text:clip.title});
        if(!clips.length)throw new Error("No clips are available for this BRB source");store.saveProgram(task.tenant,{clips,index:0,nextAt:0,requestId:task.id});
      }else if(task.body.action==="create-twitch-reward") {
        const reward=store.redeems(task.tenant).find(r=>r.id===task.body.rewardId);if(!reward)throw new Error("Reward was removed before Twitch creation");
        if(!reward.rewardId){const entry=await twitch.createRewardEntry(task.tenant,reward.title.slice(0,45),`Requires ${reward.price} streamer points. Awards ${reward.award} streamer points.`);store.saveRedeem(task.tenant,{...reward,rewardId:entry.id});}
      }else throw new Error("Unknown stream presentation action");
      store.finishTask(task.tenant,task.id);
    }catch(error){if(error instanceof StreamWeaverGreetingPending){store.deferTask(task.tenant,task.id);continue;}store.finishTask(task.tenant,task.id,error instanceof Error?error.message:"Stream presentation failed");}
    for(const tenant of store.configuredTenants()) {
      const program=store.program(tenant);if(!program||program.nextAt>Date.now())continue;
      const clip=program.clips[program.index%program.clips.length];if(!clip)continue;
      store.enqueue(tenant,`brb:${program.requestId}:${program.index}`,"streamweaver.media.playback.v1",{kind:"brb-player",mediaUrl:clip.url,text:clip.text,durationMs:clip.duration*1000});
      program.index++;program.nextAt=Date.now()+clip.duration*1000;store.saveProgram(tenant,program);
    }
  }
}
