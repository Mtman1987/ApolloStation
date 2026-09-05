import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AuthorityService} from '../packages/authority-core/dist/index.js';
import {SqliteAuthorityStore} from '../packages/authority-sqlite/dist/index.js';
import {AuthService} from '../packages/auth-core/dist/index.js';
import {ControlService} from '../packages/control-core/dist/index.js';
import {PlatformDataService} from '../packages/platform-data-core/dist/index.js';
import {SqlitePlatformDataStore} from '../packages/platform-data-sqlite/dist/index.js';
import {ExecutionJobService} from '../packages/execution-core/dist/index.js';
import {MonetizationService} from '../packages/monetization/dist/index.js';
import {PlatformOperations} from '../packages/platform-ops/dist/index.js';
import {PlatformApiAdapter} from '../packages/api-adapter/dist/index.js';
import {SpmtClient} from '../packages/sdk/dist/index.js';
import {assertBillingManifestV1,SIMULATION_ROOM_INPUT_CAPABILITY} from '../packages/contracts/dist/index.js';
import {SimulationRoomRuntime,SimulationRoomWorker} from '../apps/chat-gateway/dist/simulation-runtime.js';
import {StreamWeaverFlowPackageStore} from '../apps/streamweaver/dist/flow-packages.js';
import {renderSimulationDiscordPayload} from '../apps/spacemountain/dist/simulation-rooms-ui.js';

function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'studio-e2e-')),store=new SqliteAuthorityStore(join(dir,'authority.db')),platformStore=new SqlitePlatformDataStore(join(dir,'platform.db'));
 const authority=new AuthorityService({store}),auth=new AuthService({store}),control=new ControlService({store}),data=new PlatformDataService({store:platformStore,auth,webhookKey:Buffer.alloc(32,7)});
 control.registerTenant({tenantId:'tenant-a',ownerUserId:'owner',displayName:'Studio'});
 for(const id of ['owner','member']){authority.ensureUser(id);data.registerUser({userId:id,username:id,displayName:id,password:'test-password-for-studio',tenantIds:['tenant-a']});}
 const apps=['chat-gateway','streamweaver','nebula-arcade','discord-stream-hub','hearmeout'];
 for(const appId of apps){control.registerApp({appId,name:appId,description:'Studio test',version:'1.0.0',launchUrl:`https://${appId}.test`,allowedScopes:['jobs:read','jobs:write','events:read','events:write'],surfaces:['standalone'],status:'active'});control.installApp('tenant-a',appId);}
 const usage=new MonetizationService(assertBillingManifestV1(JSON.parse(readFileSync(new URL('../config/billing-plans.v1.json',import.meta.url),'utf8'))),store);
 const jobs=new ExecutionJobService({store:platformStore,usage,resolvePlan:()=> 'creator'}),api=new PlatformApiAdapter(new PlatformOperations(auth,authority,control,data,undefined,undefined,jobs));
 const fetchImpl=async(url,init={})=>{const parsed=new URL(String(url));const response=api.handle({method:init.method||'GET',path:parsed.pathname+parsed.search,headers:Object.fromEntries(new Headers(init.headers)),...(init.body?{body:JSON.parse(init.body)}:{})});return Response.json(response.body??null,{status:response.status});};
 const token=id=>auth.issueHumanSession({userId:id,scopes:['*'],tenantIds:['tenant-a']}).accessToken;
 const client=id=>new SpmtClient({baseUrl:'https://studio.test',appId:'spacemountain',getAccessToken:()=>tokens[id],fetchImpl});
 const tokens={owner:token('owner'),member:token('member')};
 auth.registerServiceIdentity({serviceId:'chat-gateway',credential:'studio-worker-credential-123456789',tenantMode:'any',scopes:['events:read','events:write','jobs:read','jobs:work','runtime:write']});
 const serviceToken=auth.issueServiceAccess('chat-gateway','studio-worker-credential-123456789').accessToken;
 const service=new SpmtClient({baseUrl:'https://studio.test',appId:'chat-gateway',getAccessToken:()=>serviceToken,fetchImpl});
 const flowPath=join(dir,'live-flows.sqlite');
 const runtime=new SimulationRoomRuntime({directory:join(dir,'rooms'),streamweaverDatabasePath:flowPath,publish:(event,key)=>service.publishSimulationRoomEvent(event.data.tenantId,event,key)}),worker=new SimulationRoomWorker(service,runtime,'studio-worker');
 const owner=client('owner'),member=client('member');
 async function send(message,{provider='twitch',roomId='studio',as=owner,interaction,key=`input:${crypto.randomUUID()}`}={}){const result=await as.sendSimulationRoomInput('tenant-a',{roomId,provider,message,...(interaction?{interaction}:{})},key);await worker.runOnce();const job=await as.getExecutionJob('tenant-a',result.job.id);assert.equal(job.state,'succeeded',job.error?.message);return{job,events:await as.listSimulationRoomEvents('tenant-a',{roomId,limit:200})};}
 t.after(()=>{platformStore.close();store.close();rmSync(dir,{recursive:true,force:true});});
 return{owner,member,service,send,worker,jobs,authority,api,tokens,flowPath};
}

test('typed studio input reaches real StreamWeaver, HearMeOut, Tag, Bingo and Quackverse handlers through SDK/API/jobs',async t=>{
 const f=setup(t);
 await f.send('!currencyname Stars');
 let result=await f.send('!points');assert.ok(result.events.some(event=>event.payload.body.includes('Stars')));
 result=await f.send('list hearmeout rooms');assert.ok(result.events.some(event=>event.payload.data?.appId==='hearmeout'&&event.payload.body.includes('Preview Studio')));
 result=await f.send('spmt join');assert.ok(result.events.some(event=>event.payload.data?.renderer==='nebula-tag'&&event.payload.data.snapshot.playerCount===1));
 await f.send('spmt card');await f.send('spmt bingo center Cosmic ducks');result=await f.send('spmt claim 13');
 const board=result.events.find(event=>event.payload.data?.renderer==='nebula-arcade').payload.data.tabletop.bingo;assert.equal(board.centerPhrase,'Cosmic ducks');assert.ok(board.covered['12']);
 result=await f.send('spmt pack');const pack=result.events.find(event=>event.payload.data?.renderer==='nebula-arcade').payload.data.tabletop.quackverse.lastPack;assert.equal(pack.length,9);assert.ok(pack.every(card=>card.id&&card.name));
 assert.equal((await f.owner.listSimulationRooms('tenant-a')).length,1);
 assert.equal(f.authority.getXpBalance('tenant-a','owner'),0,'simulation never mutates the live XP wallet');
});

test('Discord creates and edits the real calendar embed without duplicate room/message creation',async t=>{
 const f=setup(t);let result=await f.send('deploy admin calendar',{provider:'discord'});
 const first=result.events.find(event=>event.payload.data?.operation==='create'&&event.payload.data.appId==='discord-stream-hub');assert.match(first.payload.data.payload.embeds[0].title,/Community Calendar/);assert.equal(first.payload.data.payload.embeds.length,1);
 result=await f.send('refresh admin calendar',{provider:'discord'});
 const edited=result.events.find(event=>event.payload.data?.operation==='edit');assert.equal(edited.payload.data.providerMessageId,first.payload.data.providerMessageId);
 assert.equal((await f.owner.listSimulationRooms('tenant-a')).length,1);
 const html=renderSimulationDiscordPayload(first.payload.data.payload);assert.match(html,/simulation-embed/);assert.match(html,/Calendar/);
});

test('room input identity and tenant come from authentication and reserved worker capability cannot be forged',async t=>{
 const f=setup(t);
 const headers={authorization:`Bearer ${f.tokens.member}`,'x-spmt-tenant':'tenant-a','idempotency-key':'forged'};
 const response=f.api.handle({method:'POST',path:'/v1/simulation-rooms/input',headers,body:{tenantId:'tenant-b',roomId:'studio',provider:'discord',message:'deploy admin calendar',actor:{userId:'owner',role:'owner',username:'owner'},appIds:['anything']}});
 assert.equal(response.status,202);assert.equal(response.body.job.tenantId,'tenant-a');assert.equal(response.body.job.input.actor.userId,'member');assert.equal(response.body.job.input.actor.role,'member');
 await f.worker.runOnce();const events=await f.member.listSimulationRoomEvents('tenant-a',{roomId:'studio'});assert.ok(events.some(event=>/requires admin/.test(event.payload.body)));assert.ok(!events.some(event=>event.payload.data?.operation==='create'&&event.payload.data.appId==='discord-stream-hub'));
 await assert.rejects(f.owner.createExecutionJob('tenant-a',{ownerAppId:'chat-gateway',capabilityId:SIMULATION_ROOM_INPUT_CAPABILITY,executionOwner:'chat-gateway',meteredResource:'hosted-worker-minutes',usageQuantity:1,executionTarget:'sprite',meteringTarget:'hosted',input:{}},'bypass'),{status:403});
 await assert.rejects(f.owner.sendSimulationRoomInput('tenant-b',{roomId:'studio',provider:'twitch',message:'!points'},'wrong-tenant'),{status:403});
});

test('input retries stay in one room and deleting a room starts with clean test state',async t=>{
 const f=setup(t);const input={roomId:'studio',provider:'twitch',message:'spmt pack'};
 const first=await f.owner.sendSimulationRoomInput('tenant-a',input,'same-key'),second=await f.owner.sendSimulationRoomInput('tenant-a',input,'same-key');assert.equal(first.job.id,second.job.id);assert.equal(second.duplicate,true);
 await f.worker.runOnce();await f.owner.deleteSimulationRoom('tenant-a','studio','delete-studio');
 const result=await f.send('spmt status');const snapshot=result.events.find(event=>event.payload.data?.renderer==='nebula-arcade').payload.data.tabletop.quackverse;assert.deepEqual(snapshot.lastPack,[]);
});

test('Discord renderer escapes command content, validates embed colors and rejects unsafe attachment links',()=>{
 const html=renderSimulationDiscordPayload({content:'<img src=x onerror=alert(1)>',embeds:[{title:'<script>',color:'red;display:none',fields:[{name:'safe',value:'**bold**',inline:true}]}],attachments:[{url:'javascript:alert(1)',filename:'bad'}]});assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('javascript:'));assert.match(html,/<strong>bold<\/strong>/);
});


test('Discord application buttons, forms and submission use the live interaction handler with isolated records',async t=>{
 const f=setup(t);let result=await f.send('deploy moderator applications',{provider:'discord'});
 let payload=result.events.find(event=>event.payload.data?.payload?.components)?.payload.data.payload;
 assert.ok(payload,'application embed is produced');
 const inquiry=payload.components[0].components[0];
 result=await f.send(inquiry.label,{provider:'discord',interaction:{customId:inquiry.custom_id}});
 payload=result.events.find(event=>event.payload.data?.interactionType===4).payload.data.payload;
 assert.equal(payload.flags,64);
 const start=payload.components[0].components[0];
 result=await f.send(start.label,{provider:'discord',interaction:{customId:start.custom_id}});
 payload=result.events.find(event=>event.payload.data?.interactionType===9).payload.data.payload;
 const values=Object.fromEntries(payload.components.flatMap(row=>row.components).map(field=>[field.custom_id,'This is a real test application answer.']));
 result=await f.send('Submit application',{provider:'discord',interaction:{customId:payload.custom_id,values}});
 assert.ok(result.events.some(event=>event.payload.data?.payload?.content?.includes('Application received')));
 result=await f.send('read applications',{provider:'discord'});
 assert.ok(result.events.some(event=>/1 total application/.test(event.payload.body)));
});

test('an input queued before room deletion cannot recreate the deleted room',async t=>{
 const f=setup(t);await f.send('!points');
 const queued=await f.owner.sendSimulationRoomInput('tenant-a',{roomId:'studio',provider:'twitch',message:'spmt pack'},'queued-before-delete');
 await f.owner.deleteSimulationRoom('tenant-a','studio','delete-before-worker');await f.worker.runOnce();
 assert.equal((await f.owner.getExecutionJob('tenant-a',queued.job.id)).state,'failed');
 assert.equal((await f.owner.listSimulationRooms('tenant-a')).length,0);
});


test('a named room is created without previewing a command, then independently routes headpat, boop, games and Discord',async t=>{
 const f=setup(t),flows=new StreamWeaverFlowPackageStore(f.flowPath);
 for(const trigger of ['!headpat','!boop']){const pkg=flows.listCommunity().find(item=>item.commands.some(command=>command.trigger===trigger));assert.ok(pkg);flows.install('tenant-a',pkg.packageId);}flows.close();
 const created=await f.owner.createSimulationRoom('tenant-a','Friday live test','create-friday');
 const retry=await f.owner.createSimulationRoom('tenant-a','Friday live test','create-friday');assert.equal(created.roomId,retry.roomId);assert.equal(retry.duplicate,true);
 let rooms=await f.owner.listSimulationRooms('tenant-a');assert.equal(rooms.length,1);assert.equal(rooms[0].name,'Friday live test');
 const roomId=created.roomId;let result=await f.send('!headpat',{roomId});let outputs=result.events.filter(event=>event.payload.direction==='egress'&&event.payload.data?.inputId===result.job.id);assert.equal(outputs.length,1);assert.match(outputs[0].payload.body,/headpats/);
 result=await f.send('!boop @owner',{roomId});outputs=result.events.filter(event=>event.payload.direction==='egress'&&event.payload.data?.inputId===result.job.id);assert.equal(outputs.length,1);assert.match(outputs[0].payload.body,/boops @owner/);assert.ok(result.events.filter(event=>event.payload.data?.inputId===result.job.id).every(event=>!String(event.payload.title).includes('headpat')));
 await f.send('spmt card',{roomId});await f.send('list hearmeout rooms',{roomId});await f.send('deploy admin calendar',{roomId,provider:'discord'});
 rooms=await f.owner.listSimulationRooms('tenant-a');assert.equal(rooms.length,1);assert.equal(rooms[0].name,'Friday live test');
 await assert.rejects(f.owner.createSimulationRoom('tenant-b','Other tenant','wrong-tenant'),{status:403});
});


test('calendar modal submissions update the same room message through the SDK and actual Discord handler',async t=>{
 const f=setup(t);let result=await f.send('deploy admin calendar',{provider:'discord'});
 const first=result.events.find(e=>e.payload.data?.payload?.calendar),payload=first.payload.data.payload,button=payload.components[0].components.find(b=>b.custom_id.includes(':captain:'));
 result=await f.send('Claim Captain’s Log',{provider:'discord',interaction:{customId:button.custom_id}});
 const modal=result.events.find(e=>e.payload.data?.interactionType===9).payload.data.payload;
 result=await f.send('Choose date',{provider:'discord',interaction:{customId:modal.custom_id,values:{date:payload.calendar.month+'-17'}}});
 const update=result.events.find(e=>e.payload.data?.inputId===result.job.id&&e.payload.data?.payload?.calendar);
 assert.ok(update);assert.equal(update.payload.data.operation,'edit');assert.equal(update.payload.data.providerMessageId,first.payload.data.providerMessageId);
 assert.equal(update.payload.data.payload.calendar.events[0].type,'captains-log');assert.equal(update.payload.data.payload.calendar.events[0].username,'owner');
 assert.match(renderSimulationDiscordPayload(update.payload.data.payload),/<svg/);
 assert.equal((await f.owner.listSimulationRooms('tenant-a')).length,1);
});
