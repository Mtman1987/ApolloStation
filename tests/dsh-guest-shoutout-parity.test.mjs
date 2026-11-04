import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDshLiveMonitor,DshLiveRuntime } from '../apps/discord-stream-hub/dist/live-monitor.js';
import { SqliteDshDiscordMessageStore,DshDiscordLivePublisher,DshDiscordError } from '../apps/discord-stream-hub/dist/discord-live-publisher.js';
import { DshSuiteActionOperations } from '../apps/discord-stream-hub/dist/suite-action-operations.js';
import { DshBotActionAdapter } from '../apps/discord-stream-hub/dist/bot-action-adapter.js';
import { DshTwitchLivePoller,TwitchHelixLiveClient } from '../apps/discord-stream-hub/dist/twitch-live-poller.js';
import { SupervisedDshLiveService,validateDshLiveWorkerEnvironment } from '../apps/discord-stream-hub/dist/live-worker.js';
const tenant='tenant-a',guild='12345',channel='23456',base=Date.parse('2026-09-13T12:00:00Z'),at=minutes=>new Date(base+minutes*60000).toISOString();
const stream={twitchLogin:'visitor',twitchStreamId:'stream1',displayName:'Visitor',title:'Guest stream',gameName:'Puzzle',viewerCount:5,thumbnailUrl:'https://cdn.example/{width}x{height}.jpg',startedAt:at(0)};
const profile={twitchLogin:'visitor',displayName:'Visitor'};
const config={schemaVersion:1,pollIntervalSeconds:60,tenants:[{tenantId:tenant,twitchProviderUserId:'twitch-owner',discordProviderUserId:'discord-bot',discordGuildIds:[guild],branding:{communityMemberName:'Crew'},members:[]}]};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'dsh-guest-')),path=join(dir,'state.sqlite');let monitor=new SqliteDshLiveMonitor(path),messages=new SqliteDshDiscordMessageStore(path),minute=0,seq=30000,fail=false,block;
 const calls=[],api={async createMessage(_tenant,ch,payload){calls.push({action:'create',channel:ch,payload});if(fail)throw new DshDiscordError(503,{});if(block)await block;return String(seq++);},async editMessage(_tenant,ch,id,payload){calls.push({action:'edit',channel:ch,id,payload});if(fail)throw new DshDiscordError(503,{});},async deleteMessage(_tenant,ch,id){calls.push({action:'delete',channel:ch,id});if(fail)throw new DshDiscordError(503,{});},async listGuildChannels(){return [{id:channel,type:0,name:'guests'}];}};
 const make=()=>new DshLiveRuntime(monitor,new DshDiscordLivePublisher(api,messages,{getBranding:()=>({communityMemberName:'Crew'})},undefined,()=>at(minute),monitor.guests));let runtime=make();
 t.after(()=>{monitor.close();messages.close();rmSync(dir,{recursive:true,force:true});});
 return {path,dir,api,calls,get monitor(){return monitor;},get messages(){return messages;},get runtime(){return runtime;},time:value=>{minute=value;},fail:value=>{fail=value;},block:value=>{block=value;},restart(){monitor.close();messages.close();monitor=new SqliteDshLiveMonitor(path);messages=new SqliteDshDiscordMessageStore(path);runtime=make();},register(live=false,id='register1'){return monitor.guests.register({tenantId:tenant,guildId:guild,channelId:channel,profile:{...profile,...(live?{stream}:{})},requesterUserId:'owner',operationId:id,now:at(minute)});}};
}

test('temporary offline shoutouts expire without provider availability, retain deletion retries and stay outside the directory',async t=>{
 const f=fixture(t),guest=f.register();
 assert.equal(guest.canonicalUserId,undefined);assert.equal(f.monitor.getLiveMembers(tenant).length,0);
 await f.runtime.flushGuests(tenant,at(0));assert.equal(f.calls[0].payload.embeds[0].title,'Visitor on Twitch');assert.doesNotMatch(JSON.stringify(f.calls[0].payload),/is LIVE/);
 const id=f.messages.get(tenant,'guest-shoutout',guest.id).messageId;
 f.time(59);await f.runtime.flushGuests(tenant,at(59));assert.equal(f.calls.filter(call=>call.action==='delete').length,0);
 f.fail(true);f.time(61);assert.equal((await f.runtime.flushGuests(tenant,at(61))).failed,1);assert.equal(f.monitor.guests.get(tenant,guest.id).state,'expired');assert.equal(f.messages.get(tenant,'guest-shoutout',guest.id).messageId,id);
 f.restart();f.fail(false);await f.runtime.flushGuests(tenant,at(62));assert.equal(f.messages.get(tenant,'guest-shoutout',guest.id),undefined);
 await f.runtime.reconcile({schemaVersion:1,tenantId:tenant,pollId:'later',observedAt:at(63),members:[],streams:[stream]});assert.equal(f.calls.filter(call=>call.action==='create').length,1);
 f.register(false);await f.runtime.flushGuests(tenant,at(64));assert.equal(f.calls.filter(call=>call.action==='create').length,1,'old signup retry cannot resurrect a retired target');
 f.register(false,'new-explicit-request');await f.runtime.flushGuests(tenant,at(64));assert.equal(f.calls.filter(call=>call.action==='create').length,2);
 assert.notEqual(f.calls.filter(call=>call.action==='create')[0].payload.nonce,f.calls.filter(call=>call.action==='create')[1].payload.nonce);
});

test('untracked live guests refresh through the existing poller and survive transient outages and offline grace',async t=>{
 const f=fixture(t),guest=f.register(true);let streams=[stream],offline=false,seen=[];
 const poller=new DshTwitchLivePoller({async listLiveTrackedMembers(){return [];}},{async getGrant(){return{status:'ready',clientId:'client',accessToken:'short-lived',expiresAt:'2099-01-01T00:00:00Z'};}},{async getStreams(input){seen.push(input.twitchLogins);if(offline)throw Error('Twitch outage');return streams.map(s=>({id:s.twitchStreamId,user_login:s.twitchLogin,user_name:s.displayName,title:s.title,game_name:s.gameName,viewer_count:s.viewerCount,thumbnail_url:s.thumbnailUrl,started_at:s.startedAt}));}},f.runtime);
 await poller.poll(tenant,'0',at(0));assert.deepEqual(seen[0],['visitor']);assert.equal(f.monitor.getLiveMembers(tenant).length,0);
 streams=[{...stream,viewerCount:23}];f.time(11);await poller.poll(tenant,'11',at(11));assert.match(JSON.stringify(f.calls.at(-1).payload),/23/);
 offline=true;assert.equal((await poller.poll(tenant,'30',at(30))).status,'unavailable');assert.equal(f.monitor.guests.get(tenant,guest.id).offlineDetectedAt,undefined);
 offline=false;streams=[];f.time(31);await poller.poll(tenant,'31',at(31));assert.equal(f.monitor.guests.get(tenant,guest.id).state,'active');
 f.time(50);await poller.poll(tenant,'50',at(50));assert.equal(f.monitor.guests.get(tenant,guest.id).state,'active');
 streams=[stream];f.time(51);await poller.poll(tenant,'51',at(51));assert.equal(f.monitor.guests.get(tenant,guest.id).offlineDetectedAt,undefined);
 streams=[];await poller.poll(tenant,'52',at(52));await poller.poll(tenant,'72',at(72));assert.equal(f.monitor.guests.get(tenant,guest.id).state,'expired');assert.equal(f.messages.get(tenant,'guest-shoutout',guest.id),undefined);
});

test('removal during Discord creation cleans the late message and suppresses stale outbox work after restart',async t=>{
 const f=fixture(t),guest=f.register(true);let resume;f.block(new Promise(resolve=>{resume=resolve;}));
 const publishing=f.runtime.flushGuests(tenant,at(0));while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));
 const parallel=await f.runtime.flushGuests(tenant,at(0));assert.equal(parallel.failed,1);assert.equal(f.calls.filter(call=>call.action==='create').length,1);
 f.monitor.guests.remove(tenant,guest.id,'owner','remove1',at(1));resume();await publishing;
 assert.equal(f.calls.filter(call=>call.action==='delete').length,1);assert.equal(f.messages.get(tenant,'guest-shoutout',guest.id),undefined);
 f.restart();f.block(undefined);await f.runtime.flushGuests(tenant,at(2));assert.equal(f.calls.filter(call=>call.action==='create').length,1);
 assert.equal(f.monitor.guests.list('tenant-b').length,0);
});

test('suite shoutouts resolve real Twitch guests, enforce guild channels and keep Simulation Rooms separate',async t=>{
 const f=fixture(t),operations=new DshSuiteActionOperations({config,monitor:f.monitor,messages:f.messages,discord:f.api,simulationDiscord:f.api,guestLookup:async(_tenant,login)=>{assert.equal(login,'visitor');return profile;},now:()=>at(0)}),adapter=new DshBotActionAdapter(operations);
 const request={action:'dsh.shoutouts.post',tenantId:tenant,actorUserId:'moderator',actorRole:'moderator',args:{target:'https://twitch.tv/visitor',guildId:guild,channelId:channel},idempotencyKey:'suite1'};
 const result=await adapter.execute(request);assert.equal(result.guest.twitchLogin,'visitor');await f.runtime.flushGuests(tenant,at(0));assert.equal(f.calls.filter(call=>call.action==='create').length,1);
 await adapter.execute(request);await f.runtime.flushGuests(tenant,at(0));assert.equal(f.calls.filter(call=>call.action==='create').length,1);
 assert.throws(()=>adapter.execute({...request,actorRole:'member'}),/moderator/);
 await assert.rejects(adapter.execute({...request,args:{...request.args,channelId:'99999'},idempotencyKey:'wrong-channel'}),/selected Discord server/);
 await adapter.execute({...request,simulation:true,idempotencyKey:'preview'});assert.equal(f.monitor.guests.list(tenant).length,1);
 assert.match(JSON.stringify(f.calls.at(-1).payload),/Preview:/);
 await adapter.execute({...request,action:'dsh.shoutouts.guest.remove',args:{targetId:result.guest.id},idempotencyKey:'remove'});await f.runtime.flushGuests(tenant,at(1));assert.equal(f.messages.get(tenant,'guest-shoutout',result.guest.id),undefined);
});

test('supervised DSH worker constructs guest delivery and polls untracked creators using shared grants',async t=>{
 const f=fixture(t),guest=f.register(true),configPath=join(f.dir,'runtime.json');writeFileSync(configPath,JSON.stringify(config));let minute=0;const calls=[];
 const fetchImpl=async(raw,init={})=>{const url=new URL(raw),method=init.method??'GET';calls.push({path:url.pathname,method,body:init.body?JSON.parse(String(init.body)):undefined});
 if(url.pathname==='/v1/auth/service-token')return Response.json({accessToken:'service',accessExpiresAt:'2099-01-01T00:00:00Z'});
 if(url.pathname==='/v1/provider-grants'){const input=JSON.parse(init.body);return Response.json({credential:{accessToken:'grant',metadata:input.provider==='twitch'?{clientId:'client'}:{authorizationScheme:'Bot'}},expiresAt:'2099-01-01T00:00:00Z'});}
 if(url.hostname==='api.twitch.tv'&&url.pathname==='/helix/streams'){assert.equal(url.searchParams.get('user_login'),'visitor');return Response.json({data:[{id:'stream1',user_login:'visitor',user_name:'Visitor',title:'Live guest',game_name:'Puzzle',viewer_count:33,thumbnail_url:stream.thumbnailUrl,started_at:at(0)}]});}
 if(url.pathname==='/helix/users')return Response.json({data:[]});
 if(url.hostname==='discord.com')return method==='POST'?Response.json({id:'45678'}):new Response(null,{status:204});
 if(url.pathname==='/v1/runtime/state')return Response.json({state:'ready'});
 throw Error('Unexpected request '+url.pathname);};
 const env=validateDshLiveWorkerEnvironment({SPMT_RUNTIME_MODE:'production',SPMT_ORIGIN:'http://127.0.0.1:3000',DSH_DATABASE_PATH:f.path,DSH_RUNTIME_CONFIG_PATH:configPath,DSH_WORKER_CREDENTIAL:'test-credential-more-than-thirty-two-characters'});
 let service=new SupervisedDshLiveService(env,fetchImpl,()=>at(minute));t.after(()=>service.close());
 const first=await service.runOnce();assert.equal(first.results[0].status,'completed');assert.equal(first.results[0].memberCount,0);assert.equal(first.results[0].delivered,1);
 assert.ok(f.messages.get(tenant,'guest-shoutout',guest.id));assert.equal(config.tenants[0].members.length,0);
 await service.close();minute=11;service=new SupervisedDshLiveService(env,fetchImpl,()=>at(minute));await service.runOnce();assert.ok(calls.some(call=>call.method==='PATCH'&&call.path.includes('/messages/')));
 const lookup=new TwitchHelixLiveClient(async(raw)=>new URL(raw).pathname==='/helix/users'?Response.json({data:[{login:'visitor',display_name:'Visitor'}]}):Response.json({data:[]}));
 assert.equal((await lookup.getGuest({clientId:'client',accessToken:'grant',twitchLogin:'visitor'})).stream,undefined);
});
