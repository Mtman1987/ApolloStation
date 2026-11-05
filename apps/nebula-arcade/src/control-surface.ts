import { SqliteQuackverseArtStore } from "./quackverse-art-store.js";
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { NEBULA_ARCADE_GAMES } from './game-hub.js';
import { nebulaSettingFields, validateNebulaSettings } from './game-settings.js';
import { SqliteNebulaNetwork } from './arcade-network.js';
import { SqliteNebulaTabletopRuntime } from './tabletop-runtime.js';
import { SqliteNebulaGameRuntimeStore } from './game-runtime-store.js';
import { getOrCreateNebulaPlayer, getNebulaGameStats, spendNebulaGamePoints, claimNebulaGameCommand, setNebulaChannelGameRunning, resolveNebulaChannelGameIds } from './game-runtime.js';
import { SqliteNebulaTagStore, NebulaTagRuntime } from './nebula-tag-runtime.js';
import { AsyncNebulaTagRecordStore } from "./async-tag-record-store.js";
import { AsyncNebulaTagRuntime } from "./async-nebula-tag-runtime.js";
import { SqliteNebulaTagExperienceStore } from './nebula-tag-experience.js';
import type { NebulaTagCommandV1 } from './nebula-tag.js';
import type { SpmtClient } from '@spmt/sdk';
export interface NebulaBrowserPlayer {userId:string;username:string;moderator:boolean;}
export type NebulaBrowserAuth=(request:IncomingMessage)=>Promise<NebulaBrowserPlayer>;
export class NebulaControlSurface {
 readonly art:SqliteQuackverseArtStore; readonly network:SqliteNebulaNetwork;private readonly games:SqliteNebulaGameRuntimeStore;private readonly tabletop:SqliteNebulaTabletopRuntime;private readonly tagStore:SqliteNebulaTagStore|AsyncNebulaTagRecordStore;private readonly tagRuntime?:NebulaTagRuntime|AsyncNebulaTagRuntime;private readonly tagReady:Promise<void>;private readonly experience:SqliteNebulaTagExperienceStore;
 constructor(private readonly options:{databasePath:string;tenantId:string;channelId:string;channels?:string[];client?:SpmtClient}){this.art=new SqliteQuackverseArtStore(options.databasePath);this.network=new SqliteNebulaNetwork(options.databasePath);this.games=new SqliteNebulaGameRuntimeStore(options.databasePath);this.tabletop=new SqliteNebulaTabletopRuntime(options.databasePath);const tagStoreMode=process.env.NEBULA_ARCADE_TAG_STORE??"sqlite";if(tagStoreMode!=="sqlite"&&tagStoreMode!=="turso")throw new Error("NEBULA_ARCADE_TAG_STORE must be sqlite or turso");if(tagStoreMode==="turso"&&(!process.env.NEBULA_ARCADE_TURSO_DATABASE_URL||!process.env.NEBULA_ARCADE_TURSO_AUTH_TOKEN))throw new Error("NEBULA_ARCADE_TAG_STORE=turso requires NEBULA_ARCADE_TURSO_DATABASE_URL and NEBULA_ARCADE_TURSO_AUTH_TOKEN");this.tagStore=tagStoreMode==="turso"?new AsyncNebulaTagRecordStore({mode:"turso",url:process.env.NEBULA_ARCADE_TURSO_DATABASE_URL,authToken:process.env.NEBULA_ARCADE_TURSO_AUTH_TOKEN}):new SqliteNebulaTagStore(options.databasePath);this.tagReady=this.tagStore instanceof AsyncNebulaTagRecordStore?this.tagStore.initialize().then(()=>undefined):Promise.resolve();if(options.client)this.tagRuntime=this.tagStore instanceof AsyncNebulaTagRecordStore?new AsyncNebulaTagRuntime(this.tagStore,options.client):new NebulaTagRuntime(this.tagStore,options.client);this.experience=new SqliteNebulaTagExperienceStore(options.databasePath);}
 close(){this.art.close();this.network.close();this.games.close();this.tabletop.close();this.experience.close();if(this.tagStore instanceof AsyncNebulaTagRecordStore)return this.tagStore.close();this.tagStore.close();}
 async handle(method:string,path:string,body:Record<string,unknown>,player:NebulaBrowserPlayer){
  await this.tagReady;
  const {tenantId:tenant}=this.options,rooms=[...new Set([this.options.channelId,...(this.options.channels??[]),...Object.keys(this.games.get(tenant).channels)])],channel=String(body.channel||this.options.channelId),game=String(body.gameId||'quackverse'),now=new Date().toISOString();
  if(!rooms.includes(channel))throw new Error('This arcade room is not configured');
  if(method==='GET'&&path==='state'){const state=this.games.get(tenant);const settings=player.moderator?Object.fromEntries(await Promise.all(NEBULA_ARCADE_GAMES.map(async game=>[game.id,{fields:nebulaSettingFields(game.id),values:game.id==='tag'&&this.tagStore instanceof AsyncNebulaTagRecordStore?await this.tagStore.settings(tenant):this.network.settings(tenant,game.id==='tag'?'@arcade':channel,game.id)}]))):undefined;return{player,rooms,channelId:channel,games:NEBULA_ARCADE_GAMES,activeGameIds:resolveNebulaChannelGameIds(state,channel),enrollment:this.network.enrollment(`spmt:${player.userId}`),tabletop:this.tabletop.snapshot(tenant,channel,player.userId),quackverseTrades:this.tabletop.tradeSnapshot(tenant,player.userId,state.players),tag:(await this.tagStore.getState(tenant)).state,stats:NEBULA_ARCADE_GAMES.map(game=>getNebulaGameStats(state,game.id)),art:this.art.list(tenant),wallet:state.players[`spmt:${player.userId}`]??null,...(player.moderator?{bingoJobs:this.network.jobs(tenant).filter(job=>job.kind==="bingo-generate"),artJobs:this.network.jobs(tenant).filter(job=>job.kind.startsWith("art")),blacklist:this.network.listBlacklist(tenant),tickets:this.experience.listSupportTickets(tenant),settings}:{} )};}
  if(method!=='POST')throw new Error('Unsupported request');
  if(['blacklist','settings','running','tag-admin','support-resolve','art-upload','art-delete','art-generate','art-enhance','art-batch','art-cancel','bingo-generate'].includes(path)&&!player.moderator)throw new Error('Moderator permission required');
  if(path==='bingo-generate'){const id=`bingo:${String(body.requestId||randomUUID())}`;this.network.enqueue(tenant,id,'bingo-generate',{userId:player.userId,channelId:channel,theme:String(body.theme||'streaming community moments').slice(0,500)});return{queued:true,id};}
  if(path==='art-upload')return this.art.put(tenant,Number(body.cardId),String(body.variant||'master'),Buffer.from(String(body.base64||''),'base64'));
  if(path==='art-delete')return{deleted:this.art.delete(tenant,Number(body.cardId),String(body.variant||'master'))};
  if(path==='art-cancel'){const item=this.network.jobs(tenant).find(job=>job.id===body.id&&job.kind.startsWith('art'));if(!item)throw new Error('Art job not found');if(item.body.jobId){if(!this.options.client)throw new Error('Execution service unavailable');await this.options.client.cancelExecutionJob(tenant,item.body.jobId);}this.network.updateJob(tenant,item.id,'cancelled',item.body);return{cancelled:true};}
  if(path==='art-batch'){const start=Number(body.startCardId),end=Number(body.endCardId);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start||end-start>=24)throw new Error('Choose a range of up to 24 cards');const cards=Array.from({length:end-start+1},(_,index)=>this.art.prompt(start+index));const batch=String(body.requestId||randomUUID()),kind=body.mode==='enhance'?'art-enhance':'art-generate';for(const direction of cards)this.network.enqueue(tenant,`art:${direction.card.id}:${batch}`,kind,{cardId:direction.card.id,userId:player.userId,prompt:[direction.prompt,String(body.prompt||'')].join('\n'),negativePrompt:direction.negativePrompt,model:String(body.model||'')});return{queued:cards.length,batch};}
  if(path==='art-generate'||path==='art-enhance'){const cardId=Number(body.cardId),direction=this.art.prompt(cardId);const id=`art:${cardId}:${String(body.requestId||randomUUID())}`;this.network.enqueue(tenant,id,path,{cardId,userId:player.userId,prompt:[direction.prompt,String(body.prompt||'')].join('\n'),negativePrompt:direction.negativePrompt,sourceImageUrl:String(body.sourceImageUrl||''),model:String(body.model||'')});return{queued:true,id};}
  if(path==='blacklist')return this.network.blacklist(tenant,body.kind==='player'?'player':'channel',String(body.subject||''),body.blocked!==false,String(body.reason||''));
  if(path==='settings'){const values=validateNebulaSettings(game,body.settings as Record<string,unknown>);const saved=this.network.saveSettings(tenant,game==='tag'?'@arcade':channel,game,values);if(game==='tag'&&this.tagStore instanceof AsyncNebulaTagRecordStore)await this.tagStore.setSettings(tenant,{tagSuccessPoints:Number(values.tagSuccessPoints),taggedPenaltyPoints:Number(values.taggedPenaltyPoints),immunityMinutes:Number(values.immunityMinutes),rotateMinutes:Number(values.rotateMinutes),forceMinutes:Number(values.forceMinutes)});return saved;}
  if(path==='support-resolve')return this.experience.resolveSupportTicket(tenant,String(body.ticketId||''));
  if(this.network.blocked(tenant,player.userId,player.username,channel))throw new Error('This player or channel is excluded from Nebula Arcade');
  if(path==='trade'){
    const action=String(body.action||'');
    if(!['offer','accept','decline','cancel'].includes(action))throw new Error('Choose offer, accept, decline or cancel');
    const result=this.tabletop.trade(tenant,player.userId,player.username,{action:action as 'offer'|'accept'|'decline'|'cancel',...(body.toId===undefined?{}:{toId:String(body.toId)}),...(body.giveCardId===undefined?{}:{giveCardId:Number(body.giveCardId)}),...(body.wantCardId===undefined?{}:{wantCardId:Number(body.wantCardId)}),...(body.offerId===undefined?{}:{offerId:String(body.offerId)}),...(body.requestId===undefined?{}:{requestId:String(body.requestId)})},this.games.get(tenant).players);
    return {result,quackverseTrades:this.tabletop.tradeSnapshot(tenant,player.userId,this.games.get(tenant).players)};
  }
  if(path==='enrollment')return this.network.enroll(`spmt:${player.userId}`,body.enrolled!==false);
  if(path==='running')return this.games.update(tenant,state=>setNebulaChannelGameRunning(state,channel,game,body.running===true)).result;
  if(path==='tag-admin'){
    const kind=String(body.action),allowed=['pin-tag','set-it','trigger-ffa','set-winner','clear-winners','grant-pass','reset-scores','award-points','clear-all-away','sleep','wake'];if(!allowed.includes(kind))throw new Error('Unknown Tag administration action');
    const target=String(body.targetUserId||''),tagState=await this.tagStore.getState(tenant),targetUserId=Object.values(tagState.state.players).find(player=>player.userId===target||player.username.toLowerCase()===target.replace(/^@/,'').toLowerCase())?.userId??target;
    const command={schemaVersion:1,tenantId:tenant,channelId:channel,commandId:String(body.requestId||randomUUID()),actorUserId:player.userId,isModerator:true,occurredAt:now,kind,targetUserId,place:Number(body.place||1),amount:Number(body.amount)} as NebulaTagCommandV1;
    if(this.tagRuntime)return this.tagRuntime.execute(command);return await this.tagStore.applyCommand(command);
  }
  if(path==='spend'){const amount=Number(body.amount);if(!Number.isSafeInteger(amount)||amount<1)throw new Error('Choose a positive whole number of Game Points');const key=String(body.requestId||'');if(!key)throw new Error('A request ID is required');return this.games.update(tenant,state=>{const wallet=getOrCreateNebulaPlayer(state,{userId:`spmt:${player.userId}`,username:player.username});if(claimNebulaGameCommand(state,`spend:${key}`))spendNebulaGamePoints(state,wallet,amount,String(body.reason||'Arcade purchase'));return wallet;}).result;}
  if(path==='play'){
    if(!['quackverse','bingo'].includes(game))throw new Error('Choose Bingo or Quackverse');
    if(!resolveNebulaChannelGameIds(this.games.get(tenant),channel).includes(game))throw new Error('This game is not active in the channel');
    const action=String(body.action||'status').toLowerCase(),args=Array.isArray(body.args)?body.args.map(String):[];
    if(args.join(' ').length>12000)throw new Error('Game input is too long');
    const message={schemaVersion:1 as const,tenantId:tenant,provider:'twitch' as const,connectionId:'nebula-browser',channelId:channel,messageId:String(body.requestId||randomUUID()),text:`spmt ${game} ${action} ${args.join(' ')}`.trim(),occurredAt:now,actor:{providerUserId:player.userId,canonicalUserId:player.userId,username:player.username,isBot:false,roles:player.moderator?['moderator' as const]:['member' as const]},mentions:[]};
    const result=this.tabletop.execute(message);if(!this.tabletop.succeeded(message))throw new Error(result||'Unsupported game action');this.network.enroll(`spmt:${player.userId}`,true);return{result,tabletop:this.tabletop.snapshot(tenant,channel,player.userId)};
  }
  throw new Error('Unknown arcade control');
 }
}
