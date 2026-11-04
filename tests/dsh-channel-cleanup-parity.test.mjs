import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {DshChannelModerationService} from '../apps/discord-stream-hub/dist/channel-moderation.js';
import {DshChannelCleanup} from '../apps/discord-stream-hub/dist/channel-cleanup.js';
import {DshDiscordApi,DshDiscordError} from '../apps/discord-stream-hub/dist/discord-live-publisher.js';
import {DshSuiteActionOperations} from '../apps/discord-stream-hub/dist/suite-action-operations.js';
import {DshBotActionAdapter} from '../apps/discord-stream-hub/dist/bot-action-adapter.js';
import {DshSuiteActionWorker} from '../apps/discord-stream-hub/dist/suite-action-worker.js';
import {createDiscordStreamHubWebServer} from '../apps/discord-stream-hub/dist/web-server.js';
const tenant='tenant-a',guild='123456789012345678',channel='223456789012345678',bot='323456789012345678';
const request={schemaVersion:1,tenantId:tenant,guildId:guild,channelId:channel,mode:'all',actorRole:'owner'};
const id=(i,age=10000)=>String((BigInt(Date.now()-age)-1420070400000n)<<22n|BigInt(i));
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'dsh-cleanup-')),path=join(dir,'state.sqlite'),calls=[];let rows=[],failed='',foreign=false,holds;
 const discord={async channel(){return{id:channel,guildId:foreign?'423456789012345678':guild};},async botIdentity(){return{id:bot};},async message(_t,_c,id){return rows.find(row=>row.id===id);},async messages(_t,_c,input){return rows.filter(row=>!input.before||BigInt(row.id)<BigInt(input.before)).slice(0,100);},async bulkDelete(_t,_c,ids){calls.push({bulk:ids});if(holds)await holds;if(ids.includes(failed))throw new DshDiscordError(503,{});rows=rows.filter(row=>!ids.includes(row.id));},async deleteMessage(_t,_c,id){calls.push({one:id});if(id===failed)throw new DshDiscordError(503,{});if(!rows.some(row=>row.id===id))throw new DshDiscordError(404,{});rows=rows.filter(row=>row.id!==id);}};
 const moderation=new DshChannelModerationService(discord);let cleanup=new DshChannelCleanup(path,moderation);
 t.after(()=>{cleanup.close();rmSync(dir,{recursive:true,force:true});});return{dir,path,calls,discord,moderation,get cleanup(){return cleanup;},get rows(){return rows;},set rows(value){rows=value.sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:1);},fail(value){failed=value;},foreign(value){foreign=value;},hold(value){holds=value;},restart(){cleanup.close();cleanup=new DshChannelCleanup(path,moderation);}};
}

test('cleanup executes the previewed selection, persists partial progress and leaves later messages untouched',async t=>{
 const f=fixture(t),a=id(1),b=id(2),old=id(3,20*86400000);f.rows=[a,b,old].map(id=>({id,authorId:bot}));
 const plan=await f.cleanup.preview(request,'owner','preview1');assert.equal(plan.selected,3);assert.equal(f.calls.length,0);
 const later=id(4);f.rows=[...f.rows,{id:later,authorId:bot}];f.fail(b);
 const first=await f.cleanup.execute(tenant,plan.id,'owner','owner',[guild]);assert.equal(first.deleted,2);assert.equal(first.remaining,1);assert.ok(f.rows.some(row=>row.id===later));
 f.restart();f.fail('');const second=await f.cleanup.execute(tenant,plan.id,'owner','owner',[guild]);assert.equal(second.deleted,3);assert.equal(second.remaining,0);assert.deepEqual(f.rows.map(row=>row.id),[later]);
 const count=f.calls.length;await f.cleanup.execute(tenant,plan.id,'owner','owner',[guild]);assert.equal(f.calls.length,count);
 await assert.rejects(f.cleanup.execute('other',plan.id,'owner','owner',[guild]),/not found/);
});

test('bot and until previews preserve scope, validate pagination, and enforce current guild authority',async t=>{
 const f=fixture(t),a=id(7),b=id(8),c=id(9);f.rows=[{id:a,authorId:bot},{id:b,authorId:'other-bot'},{id:c,authorId:bot}];
 const botPlan=await f.cleanup.preview({...request,mode:'bot'},'owner','bot');assert.equal(botPlan.selected,2);
 const until=await f.cleanup.preview({...request,mode:'until',untilMessageId:b},'owner','until');assert.equal(until.selected,1);assert.deepEqual(until.sampleMessageIds,[c]);
 await assert.rejects(f.cleanup.preview({...request,actorRole:'member'},'member','bad'),/admin or owner/);
 await assert.rejects(f.cleanup.execute(tenant,botPlan.id,'admin-two','admin',[guild]),/another moderator/);
 await assert.rejects(f.cleanup.execute(tenant,botPlan.id,'owner','owner',[]),/no longer configured/);
 f.foreign(true);await assert.rejects(f.cleanup.execute(tenant,botPlan.id,'owner','owner',[guild]),/outside/);assert.equal(f.calls.length,0);
 f.foreign(false);await assert.rejects(f.cleanup.preview({...request,mode:'until',untilMessageId:id(99)},'owner','absent'),/not found/);
});

test('concurrent cleanup executions and lost shared-job leases cannot delete a second selection',async t=>{
 const f=fixture(t);f.rows=Array.from({length:102},(_,i)=>({id:id(i+1),authorId:bot}));const plan=await f.cleanup.preview(request,'owner','one');let resume;f.hold(new Promise(resolve=>{resume=resolve;}));
 const first=f.cleanup.execute(tenant,plan.id,'owner','owner',[guild]);while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(f.cleanup.execute(tenant,plan.id,'owner','owner',[guild]),/already running/);resume();await first;
 f.hold(undefined);f.rows=[{id:id(500),authorId:bot}];const next=await f.cleanup.preview(request,'owner','two'),calls=f.calls.length;
 await assert.rejects(f.cleanup.execute(tenant,next.id,'owner','owner',[guild],async()=>{throw Error('shared job lease revoked');}),/revoked/);assert.equal(f.calls.length,calls);
});

test('the Discord adapter uses short-lived grants for history, identity and selected deletions',async()=>{
 const calls=[],selected=id(1);const api=new DshDiscordApi({async getGrant(input){calls.push({grant:input});return{authorization:'Bot short-lived',expiresAt:'2099-01-01T00:00:00Z'};}},async(raw,init={})=>{const url=new URL(raw);calls.push({path:url.pathname,method:init.method,body:init.body});if(url.pathname.endsWith('/users/@me'))return Response.json({id:bot});if(url.pathname===`/api/v10/channels/${channel}`)return Response.json({id:channel,guild_id:guild});if(init.method==='GET')return Response.json([{id:selected,author:{id:bot,bot:true}}]);return new Response(null,{status:204});});
 const service=new DshChannelModerationService(api.moderationPort()),preview=await service.preview({...request,mode:'bot'});assert.deepEqual(preview.ids,[selected]);await service.executeSelected(request,preview.ids);
 assert.ok(calls.some(call=>call.grant?.capability==='channels:read'));assert.ok(calls.some(call=>call.grant?.capability==='messages:write'));
 assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
});

test('shared DSH jobs execute approved selections and honor simulation and runtime read-only mode',async t=>{
 const f=fixture(t);f.rows=[{id:id(1),authorId:bot}];const plan=await f.cleanup.preview(request,'owner','one');
 const config={tenants:[{tenantId:tenant,discordGuildIds:[guild]}]};let live=false;
 const make=()=>new DshBotActionAdapter(new DshSuiteActionOperations({config,cleanup:f.cleanup,cleanupLiveWrites:live}));
 const input={action:'dsh.moderation.execute',tenantId:tenant,actorUserId:'owner',actorRole:'owner',args:{planId:plan.id},idempotencyKey:'execute'};
 assert.equal((await make().execute(input)).simulation,true);assert.equal(f.calls.length,0);live=true;
 assert.equal((await make().execute({...input,simulation:true})).simulation,true);assert.equal(f.calls.length,0);
 let claimed=false,heartbeat=0,result;
 const job={id:'job1',tenantId:tenant,executionOwner:'discord-stream-hub',executionTarget:'sprite',capabilityId:'suite.action.dsh.moderation.execute',leaseId:'lease',fencingEpoch:1,idempotencyKey:'execute',input:{schemaVersion:1,action:input.action,args:input.args,actor:{userId:'owner',username:'Owner',role:'owner'},source:{kind:'api',requestId:'request1'}}};
 const {spmtSuiteActionCapabilityId}=await import('../packages/contracts/dist/index.js');job.capabilityId=spmtSuiteActionCapabilityId(input.action);
 const worker=new DshSuiteActionWorker({async reportExecutionWorker(){},async claimAnyExecutionJob(){if(claimed)return null;claimed=true;return job;},async heartbeatExecutionJob(){heartbeat++;},async succeedExecutionJob(...args){result=args.at(-1);},async failExecutionJob(...args){throw Error(JSON.stringify(args));}},make(),{workerId:'worker',tenantIds:[tenant]});
 await worker.runOnce();assert.equal(result.plan.remaining,0);assert.ok(heartbeat>=2);assert.equal(f.calls.length,1);
});

test('authenticated moderation controls queue canonical jobs and expose only authorized saved previews',async t=>{
 const f=fixture(t),runtimePath=join(f.dir,'runtime.json');writeFileSync(runtimePath,JSON.stringify({schemaVersion:1,pollIntervalSeconds:60,tenants:[{tenantId:tenant,twitchProviderUserId:'twitch',discordProviderUserId:'discord',discordGuildIds:[guild],branding:{communityMemberName:'Crew'},members:[]}]}));
 const spmt=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/v1/session'&&req.headers.cookie)res.end(JSON.stringify({actorId:req.headers.cookie,tenantIds:[tenant],tenantRoles:{[tenant]:req.headers.cookie==='owner'?'owner':'member'}}));else{res.statusCode=401;res.end('{}');}});await new Promise(resolve=>spmt.listen(0,'127.0.0.1',resolve));
 const jobs=[],fetchImpl=async(raw,init={})=>{const path=new URL(raw).pathname;if(path==='/v1/auth/service-token')return Response.json({accessToken:'service',accessExpiresAt:'2099-01-01T00:00:00Z'});if(path==='/v1/suite-actions'){jobs.push(JSON.parse(init.body));return Response.json({job:{id:'job1',state:'queued'}});}throw Error('Unexpected request '+path);};
 const host=createDiscordStreamHubWebServer({spmtOrigin:`http://127.0.0.1:${spmt.address().port}`,databasePath:f.path,runtimeConfigPath:runtimePath,credential:'test-only-service-credential-123456789012345',operationMode:'read-only',fetchImpl,host:'127.0.0.1',port:0});await host.listen();t.after(async()=>{await host.close();await new Promise(resolve=>spmt.close(resolve));});
 const origin=`http://127.0.0.1:${host.server.address().port}`,api=origin+'/apps/discord-stream-hub/api/control/moderation';
 const post=(body,cookie='owner',source=origin)=>fetch(api+'/preview',{method:'POST',headers:{origin:source,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 const body={serverId:guild,channelId:channel,mode:'all',requestId:'preview1',actorUserId:'forged'};
 assert.equal((await post(body,'member')).status,403);assert.equal((await post(body,'owner','https://other.example')).status,400);
 assert.equal((await post(body)).status,202);assert.equal(jobs[0].input.actor.userId,'owner');assert.equal(jobs[0].input.source.simulation,true);assert.equal(jobs[0].input.action,'dsh.moderation.preview');
 f.rows=[{id:id(1),authorId:bot}];await f.cleanup.preview(request,'owner','one');
 const view=await(await fetch(api,{headers:{cookie:'owner'}})).json();assert.equal(view.plans[0].selected,1);assert.equal((await fetch(api,{headers:{cookie:'member'}})).status,403);
 const page=await(await fetch(origin)).text(),js=page.match(/<script>([\s\S]*)<\/script>/)?.[1];assert.ok(js);assert.doesNotThrow(()=>new Function(js));assert.match(page,/data-cleanup-execute/);
});
