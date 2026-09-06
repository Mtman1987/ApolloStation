import {createHash} from 'node:crypto';
import type {SpmtClient} from '@spmt/sdk';
import {resolveProviderIdentity} from '@spmt/sdk/provider-identity';
import type {StreamWeaverCommunityStore} from './community-store.js';
import type {SqliteStreamWeaverEconomyStore} from './economy.js';
import type {StreamWeaverTwitchCommandAdapter} from './twitch-command-adapter.js';
import type {StreamRideRider} from './ride-store.js';
import {StreamWeaverRewardRuntime} from './reward-runtime.js';
import {STREAMWEAVER_KNOWN_BOTS} from './shoutout-store.js';
export type StreamRideLookup=(tenant:string)=>Promise<StreamRideRider[]>;
export interface StreamRideRequest {tenantId:string;actorId:string;displayName:string;source:string;requestId:string;currency:'streamer'|'spmt';maxSpmtCost?:number;rewardId?:string;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Intersection uses existing canonical links, never matching display names or minting identities. */
export function activeRideLookup(store:StreamWeaverCommunityStore,twitch:Pick<StreamWeaverTwitchCommandAdapter,'chatters'>,client:SpmtClient):StreamRideLookup{return async tenant=>{
 const roster=store.partners(tenant).filter(p=>p.kind==='community'&&p.source),members=new Map<string,StreamRideRider>();if(!roster.length)throw Error('Import a community Discord role before starting rides');if(roster.length>500)throw Error('Ride eligibility supports at most 500 imported community entries');
 const resolve=async(provider:'twitch'|'discord',id:string)=>{try{return (await resolveProviderIdentity(client,tenant,provider,id)).userId}catch(error){if(error&&typeof error==='object'&&'status' in error&&error.status===404)return;throw error}};
 for(let i=0;i<roster.length;i+=5){const results=await Promise.all(roster.slice(i,i+5).map(async p=>{const discordId=p.id.split(':').at(-1)!;if(!/^[0-9]{5,30}$/.test(discordId))throw Error('Imported community identity is invalid');const userId=await resolve('discord',discordId);return userId?{userId,displayName:p.name,imageUrl:p.imageUrl}:undefined}));for(const rider of results)if(rider)members.set(rider.userId,rider)}
 const chatters=(await twitch.chatters(tenant)).filter(c=>!STREAMWEAVER_KNOWN_BOTS.has(c.username.toLowerCase()));if(chatters.length>2000)throw Error('Ride eligibility supports at most 2000 current chatters');const present=new Set<string>();
 for(let i=0;i<chatters.length;i+=5){const ids=await Promise.all(chatters.slice(i,i+5).map(c=>resolve('twitch',c.id)));for(const id of ids)if(id&&members.has(id))present.add(id)}
 const riders=[...present].map(id=>members.get(id)!);if(riders.length>200)throw Error('A ride supports at most 200 linked active riders');return riders;
}}
export async function runStreamRide(store:StreamWeaverCommunityStore,economy:SqliteStreamWeaverEconomyStore,client:SpmtClient,lookup:StreamRideLookup|undefined,active:boolean,input:StreamRideRequest){
 if(!active||!lookup)throw Error('Live rides are unavailable in this environment');if(!input.actorId)throw Error('Link your account before launching a ride');if(!input.requestId||input.requestId.length>500)throw Error('Ride request identifier is required');
 const settings=store.rides.settings(input.tenantId);if(!settings.enabled)throw Error('Rides are disabled');const id=hash(input.requestId),signature=JSON.stringify([input.actorId,input.source,input.currency,input.rewardId??'']),key=`ride:${id}`;
 let attempt=store.rides.attempt(input.tenantId,id);if(attempt&&attempt.signature!==signature)throw Error('Ride identifier conflicts with another request');if(attempt?.result)return attempt.result;
 if(!attempt){const reward=store.redeems(input.tenantId).find(r=>r.id===(input.rewardId??settings.rewardId));if(!reward||reward.id!==settings.rewardId||!reward.enabled)throw Error('Choose an enabled configured ride reward');if(store.partners(input.tenantId).some(p=>p.rewardId===reward.id))throw Error('The ride reward cannot also price an individual check-in');const riders=await lookup(input.tenantId);if(!riders.length)throw Error('No linked community members are active in Twitch chat');attempt=store.rides.prepare(input.tenantId,id,{signature,actorId:input.actorId,displayName:input.displayName.slice(0,120)||'viewer',source:input.source,currency:input.currency,streamSession:store.settings(input.tenantId).welcomeSession,reward,riders});}
 const payment=await new StreamWeaverRewardRuntime(economy,client).redeem({tenantId:input.tenantId,userId:attempt.actorId,requestId:key,reward:attempt.reward,streamSession:attempt.streamSession,currency:attempt.currency,...(input.maxSpmtCost===undefined?{}:{maxSpmtCost:input.maxSpmtCost})});
 if(payment.state!=='complete')return {state:payment.state,text:`Ride declined: ${payment.message}`,message:payment.message};
 attempt=store.rides.reserveFrontSeat(input.tenantId,id);const winner=attempt.winner!,bonusKey=`ride-front-seat:${id}`;
 economy.transaction(()=>{const prior=economy.getReceipt(input.tenantId,bonusKey);if(prior)return;if(!winner.userId)throw Error('Front-seat account is unavailable');const wallet=economy.adjustBalance(input.tenantId,winner.userId,100,true);economy.putReceipt(input.tenantId,{operationId:bonusKey,kind:'ride-front-seat',result:{userId:winner.userId,balance:wallet.balance,bonus:100},createdAt:new Date().toISOString()});},{operationId:bonusKey,actorId:attempt.actorId,reason:'space-mountain-front-seat'});
 for(const rider of attempt.riders)store.checkin(input.tenantId,attempt.actorId,`ride:${hash(rider.userId)}`,attempt.source,`${key}:${hash(rider.userId)}`,{id:`ride:${hash(rider.userId)}`,name:rider.displayName,kind:'community',imageUrl:rider.imageUrl,inviteUrl:''},undefined,false);
 const text=`${attempt.displayName} launched Space Mountain with ${attempt.riders.length} riders. Front seat: ${winner.displayName} (+100 streamer points)!`,result={state:'complete' as const,text,count:attempt.riders.length,frontSeat:winner.displayName,bonus:100};
 store.enqueue(input.tenantId,key,'streamweaver.checkin.v1',{bulk:true,names:attempt.riders.map(r=>r.displayName),count:result.count,frontSeat:winner.displayName,frontSeatBonusPoints:100,text,partner:{name:winner.displayName,imageUrl:winner.imageUrl,kind:'community'}});
 if(store.checkinSettings(input.tenantId).enabled)store.requestTask(input.tenantId,`${key}:greeting`,{action:'checkin-greeting',displayName:attempt.displayName,partner:{name:`Space Mountain with ${result.count} riders; front seat ${winner.displayName} (+100 streamer points)`,kind:'community',inviteUrl:''}});
 return store.rides.complete(input.tenantId,id,result);
}
