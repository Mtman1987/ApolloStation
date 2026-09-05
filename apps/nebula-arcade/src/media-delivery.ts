import { SqliteNebulaTabletopRuntime } from './tabletop-runtime.js';
import { createHash } from 'node:crypto';
import type { SpmtClient } from '@spmt/sdk';
import { SqliteNebulaNetwork } from './arcade-network.js';
import { SqliteQuackverseArtStore } from './quackverse-art-store.js';
import { buildQuackversePackDiscordPayload } from './quackverse-pack-presentation.js';
import type { NebulaDiscordDashboardEgressV1,NebulaDiscordDashboardPayloadV1 } from './discord-dashboard.js';
export class NebulaMediaDelivery {
 private readonly network:SqliteNebulaNetwork;private readonly art:SqliteQuackverseArtStore;
 constructor(private readonly options:{databasePath:string;client:SpmtClient;publicOrigin?:string;egress?:NebulaDiscordDashboardEgressV1;now?:()=>string}){this.network=new SqliteNebulaNetwork(options.databasePath);this.art=new SqliteQuackverseArtStore(options.databasePath);}
 close(){this.network.close();this.art.close();}
 async flush(tenantId:string,channels:Array<{provider:string;connectionId:string;channelId:string}>,supportChannelId?:string,packChannelId?:string){let completed=0,failed=0;const now=this.options.now?.()??new Date().toISOString();for(const item of this.network.pending(tenantId)){
  if(item.body.retryAt&&item.body.retryAt>now)continue;
  const body=item.body as Record<string,any>;try{
   if(item.kind==='bingo-generate'){
    if(!body.jobId){const result=await this.options.client.createExecutionJob(tenantId,{ownerAppId:'nebula-arcade',executionOwner:'stellar-core',capabilityId:'stellar-core.ai-chat.v1',billedUserId:body.userId,meteredResource:'hosted-worker-minutes',usageQuantity:1,executionTarget:'sprite',meteringTarget:'hosted',input:{kind:'stellar-chat-request.v1',userId:body.userId,remember:false,message:`Create exactly 24 distinct short family-friendly stream Bingo phrases about ${body.theme}. Reply with only a JSON array of 24 strings, each 2-120 characters. No markdown.`}},item.id);body.jobId=result.job.id;this.network.updateJob(tenantId,item.id,'working',body,now);}
    const job=await this.options.client.getExecutionJob(tenantId,body.jobId);body.progress=job.progress;body.error=job.error?.message;
    if(job.state==='succeeded'){const text=String(job.result?.text||'').replace(/^```(?:json)?\s*|\s*```$/g,''),phrases=JSON.parse(text);if(!Array.isArray(phrases)||phrases.length!==24||phrases.some(value=>typeof value!=='string'||value.length<2||value.length>120||value.includes('|'))||new Set(phrases).size!==24)throw new Error('Generated phrases were invalid; the existing board was retained');const runtime=new SqliteNebulaTabletopRuntime(this.options.databasePath);try{const message={schemaVersion:1 as const,tenantId,provider:'twitch' as const,connectionId:'nebula-generator',channelId:body.channelId,messageId:item.id,text:`spmt bingo phrases ${phrases.join(' | ')}`,occurredAt:now,actor:{providerUserId:body.userId,canonicalUserId:body.userId,username:'Nebula',isBot:false,roles:['moderator' as const]},mentions:[]};const reply=runtime.execute(message);if(!runtime.succeeded(message))throw new Error(reply); }finally{runtime.close();}this.network.updateJob(tenantId,item.id,'done',body,now);completed++;}
    else this.network.updateJob(tenantId,item.id,['failed','cancelled'].includes(job.state)?'failed':'working',body,now);continue;
   }
   if(item.kind==='art-generate'||item.kind==='art-enhance'){
    if(!body.jobId){const capabilityId=item.kind==='art-generate'?'streamweaver.image.generate.v1':'dsh.quackverse.art.render.v1',sourceImageUrl=body.sourceImageUrl|| (this.options.publicOrigin?new URL(`/apps/nebula-arcade?action=card-art&cardId=${body.cardId}`,this.options.publicOrigin).toString():'');const result=await this.options.client.createExecutionJob(tenantId,{ownerAppId:'nebula-arcade',executionOwner:item.kind==='art-generate'?'streamweaver':'discord-stream-hub',capabilityId,billedUserId:body.userId,meteredResource:'hosted-worker-minutes',usageQuantity:1,executionTarget:'sprite',meteringTarget:'hosted',input:{schemaVersion:1,...body,sourceImageUrl}},item.id);body.jobId=result.job.id;}
    const job=await this.options.client.getExecutionJob(tenantId,body.jobId);body.progress=job.progress;body.error=job.error?.message;
    if(job.state==='succeeded'){const urls=job.result?.resourceUrls as string[]|undefined;if(item.kind==='art-generate'){if(!urls?.[0])throw new Error('Generation completed without an image');this.art.link(tenantId,body.cardId,'master',urls[0]);this.network.enqueue(tenantId,`${item.id}:persist`,'art-enhance',{cardId:body.cardId,userId:body.userId,sourceImageUrl:urls[0]},now);}else{this.art.link(tenantId,body.cardId,'master',String(job.result?.masterUrl));this.art.link(tenantId,body.cardId,'hover',String(job.result?.hoverUrl));}this.network.updateJob(tenantId,item.id,'done',body,now);completed++;}
    else this.network.updateJob(tenantId,item.id,job.state==='failed'||job.state==='cancelled'?'failed':'working',body,now);continue;
   }
   if(!['pack','support','support-resolved'].includes(item.kind))continue;
   const targetId=item.kind==='pack'?packChannelId:supportChannelId;
   const destination=targetId?channels.find(channel=>channel.provider==='discord'&&channel.channelId===targetId):item.kind==='pack'?channels.find(channel=>channel.provider==='discord'):undefined;
   if(!destination||!this.options.egress){this.network.updateJob(tenantId,item.id,item.status,body,now);continue;}
   if(this.network.blocked(tenantId,String(body.userId||body.requesterUserId||''),String(body.username||body.requesterUsername||''),destination.channelId))continue;
   if(item.status==='cleanup'){
    if(String(body.cleanupAt)>now)continue;
    if(this.options.egress.deleteDiscordMessage)await this.options.egress.deleteDiscordMessage({tenantId,connectionId:destination.connectionId,channelId:destination.channelId,messageId:body.messageId,transport:body.transport});
    this.network.updateJob(tenantId,item.id,'done',body,now);completed++;continue;
   }
   let payload:NebulaDiscordDashboardPayloadV1;
   if(item.kind==='pack'){
    if(body.jobId){const job=await this.options.client.getExecutionJob(tenantId,body.jobId);if(job.state==='succeeded')body.gifUrl=job.result?.gifUrl;else if(['failed','cancelled'].includes(job.state)||Date.parse(now)-Date.parse(body.startedAt)>120000)body.animationUnavailable=true;}
    if(body.messageId&&body.jobId&&!body.gifUrl&&!body.animationUnavailable){this.network.updateJob(tenantId,item.id,'working',body,now);continue;}
    const built=buildQuackversePackDiscordPayload({...body.payload,...(body.gifUrl?{gifUrl:body.gifUrl}:{}),...(body.animationUnavailable?{animationUnavailable:true}:{})});payload={embeds:built.embeds.map(embed=>({...embed,author:{name:'Nebula Arcade'},fields:embed.fields.map(field=>({...field,inline:true as const}))})),components:[],allowed_mentions:{parse:[]}};
   }else{payload={embeds:[{title:item.kind==='support'?'Nebula support request':'Nebula support resolved',description:String(body.note||'Help requested').slice(0,1000),color:0x8b5cf6,author:{name:String(body.requesterUsername||'Player')},fields:[{name:'Ticket',value:String(body.ticketId),inline:true},{name:'Channel',value:String(body.channelId),inline:true}],footer:{text:'Nebula Arcade support'},timestamp:now}],components:[],allowed_mentions:{parse:[]}};}
   const sent=await this.options.egress.upsertDiscordDashboard({schemaVersion:1,tenantId,connectionId:destination.connectionId,channelId:destination.channelId,webhookName:'Nebula Arcade',...(body.messageId?{previousMessageId:body.messageId,previousTransport:body.transport}:{}),payload});body.messageId=sent.providerMessageId;body.transport=sent.transport;
   if(item.kind==='pack'&&!body.jobId&&!body.animationUnavailable){
    body.startedAt=now;
    // Checkpoint the initial message before queueing media, so retry updates the same message.
    this.network.updateJob(tenantId,item.id,'working',body,now);
    if(!this.options.publicOrigin){body.animationUnavailable=true;this.network.updateJob(tenantId,item.id,'working',body,now);continue;}
    const ids=body.payload.pack.map((card:{id:number})=>card.id).join(','),eventId=createHash('sha256').update(`${tenantId}:${item.id}`).digest('hex');
    const result=await this.options.client.createExecutionJob(tenantId,{ownerAppId:'nebula-arcade',capabilityId:'dsh.card-pack.render.v1',executionOwner:'discord-stream-hub',billedUserId:body.userId,meteredResource:'hosted-worker-minutes',usageQuantity:1,executionTarget:'sprite',meteringTarget:'hosted',input:{schemaVersion:1,eventId,source:'quackverse',renderUrl:new URL(`/apps/nebula-arcade?action=pack-data&ids=${ids}`,this.options.publicOrigin).toString()}},`nebula-pack:${eventId}`);body.jobId=result.job.id;this.network.updateJob(tenantId,item.id,'working',body,now);
   }else if(item.kind==='pack'){body.cleanupAt=new Date(Date.parse(now)+600000).toISOString();this.network.updateJob(tenantId,item.id,'cleanup',body,now);completed++;}
   else{this.network.updateJob(tenantId,item.id,'done',body,now);completed++;}
  }catch(error){failed++;body.error=error instanceof Error?error.message.slice(0,500):'Media delivery failed';body.failures=Number(body.failures||0)+1;body.retryAt=new Date(Date.parse(now)+Math.min(300000,body.failures*15000)).toISOString();if(item.kind==='pack'&&body.messageId){body.animationUnavailable=true;delete body.jobId;}this.network.updateJob(tenantId,item.id,body.failures>=5?'failed':'pending',body,now);}
 }return{completed,failed};}
}
