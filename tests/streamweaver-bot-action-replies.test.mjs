import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {StreamWeaverBotActionReplies} from '../apps/streamweaver/dist/bot-action-replies.js';
import {StreamWeaverBotActionConsumer,StreamWeaverSuiteActionJobExecutor} from '../apps/streamweaver/dist/bot-action-runtime.js';
import {StreamWeaverProviderRuntime} from '../apps/streamweaver/dist/provider-runtime.js';

const delivery={deliveryId:'delivery-a',message:{schemaVersion:1,tenantId:'tenant-a',provider:'twitch',connectionId:'connection-a',channelId:'channel-a',messageId:'message-a',text:'generate an image of a mountain',occurredAt:'2026-09-06T00:00:00Z',actor:{canonicalUserId:'user-a',providerUserId:'twitch-a',username:'alice',roles:['member'],isBot:false}}};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'sw-action-replies-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'state.sqlite');}
function clientFixture(){let job,created=0,reads=0;return {get job(){return job;},get created(){return created;},get reads(){return reads;},client:{async createSuiteActionJob(tenantId,input){created++;job={id:'job-a',tenantId,ownerAppId:'streamweaver',executionOwner:'streamweaver',capabilityId:'streamweaver.image.generate.v1',billedUserId:input.actor.userId,input:{...input,mediaVisibility:'public'},state:'queued'};return {job};},async getExecutionJob(){reads++;return job;}}};}

test('queued suite results survive restart and failed egress without rerunning the paid action',async t=>{
 const path=fixture(t),f=clientFixture(),sent=[];let now=0,failInitial=true,failFinal=true;
 let store=new StreamWeaverBotActionReplies(path,()=>now);
 const egress={async send(message){sent.push(message);if(message.idempotencyKey.endsWith(':completed')){if(failFinal){failFinal=false;throw Error('provider timeout');}}else if(failInitial){failInitial=false;throw Error('provider timeout');}return {providerMessageId:'sent'};}};
 let consumer=new StreamWeaverBotActionConsumer(new StreamWeaverSuiteActionJobExecutor(f.client,{maxWaitMs:0}),egress,store);
 await assert.rejects(consumer.deliver(delivery));
 f.job.state='succeeded';f.job.result={text:'Image ready: https://media.example/image.png'};
 assert.equal(await store.flush(f.client,m=>egress.send(m),()=>true),0);assert.equal(f.reads,0,'completion waits for the queued reply');
 store.close();store=new StreamWeaverBotActionReplies(path,()=>now);t.after(()=>store.close());
 consumer=new StreamWeaverBotActionConsumer(new StreamWeaverSuiteActionJobExecutor(f.client,{maxWaitMs:0}),egress,store);
 await consumer.deliver(delivery);assert.equal(f.created,1);
 assert.equal(await store.flush(f.client,m=>egress.send(m),()=>true),0);
 now+=5000;assert.equal(await store.flush(f.client,m=>egress.send(m),()=>true),1);
 now+=5000;assert.equal(await store.flush(f.client,m=>egress.send(m),()=>true),0);
 assert.equal(f.created,1);assert.equal(sent[0].idempotencyKey,sent[1].idempotencyKey);
 assert.equal(sent[2].idempotencyKey,sent[3].idempotencyKey);assert.equal(sent[3].replyToMessageId,'message-a');assert.match(sent[3].text,/Image ready/);
});

test('delayed results reject foreign, private, simulation and misrouted jobs',async t=>{
 const mutations=[j=>j.tenantId='other',j=>j.billedUserId='other',j=>j.input.actor.userId='other',j=>j.ownerAppId='other',j=>j.executionOwner='other',j=>j.capabilityId='other',j=>j.input.action='hmo.rooms.read',j=>j.input.source.requestId='other',j=>j.input.source.channelId='other',j=>j.input.source.connectionId='other',j=>j.input.source.provider='discord',j=>j.input.source.kind='api',j=>j.input.source.simulation=true,j=>j.input.mediaVisibility='private'];
 for(const [index,mutate] of mutations.entries()){
  const store=new StreamWeaverBotActionReplies(fixture(t));const f=clientFixture(),sent=[];
  try{const c=new StreamWeaverBotActionConsumer(new StreamWeaverSuiteActionJobExecutor(f.client,{maxWaitMs:0}),{send:async m=>(sent.push(m),{providerMessageId:'sent'})},store);
   await c.deliver({...delivery,deliveryId:`case-${index}`});f.job.state='succeeded';f.job.result={text:'PRIVATE OUTPUT'};mutate(f.job);
   await store.flush(f.client,async m=>sent.push(m),()=>true);assert.equal(sent.length,1,`case ${index}`);
  }finally{store.close();}
 }
});

test('inactive destinations do not read results and terminal failures do not expose provider details',async t=>{
 let now=0;const store=new StreamWeaverBotActionReplies(fixture(t),()=>now);t.after(()=>store.close());const f=clientFixture(),sent=[];
 const c=new StreamWeaverBotActionConsumer(new StreamWeaverSuiteActionJobExecutor(f.client,{maxWaitMs:0}),{send:async m=>(sent.push(m),{providerMessageId:'sent'})},store);
 await c.deliver(delivery);f.job.state='failed';f.job.error={message:'secret provider response'};
 await store.flush(f.client,async m=>sent.push(m),()=>false);assert.equal(f.reads,0);
 now+=5000;await store.flush(f.client,async m=>sent.push(m),()=>true);assert.equal(sent.length,2);assert.match(sent[1].text,/did not complete/);assert.doesNotMatch(sent[1].text,/secret/);
});

test('provider reconciliation sends completed image results only in active mode to the original configured destination',async t=>{
 const path=fixture(t),f=clientFixture(),sent=[],connections=[{tenantId:'tenant-a',provider:'twitch',connectionId:'connection-a',channelId:'channel-a',desired:true}];
 const options={databasePath:path,client:f.client,egress:{send:async m=>(sent.push(m),{providerMessageId:'sent'})},botActions:new StreamWeaverSuiteActionJobExecutor(f.client,{maxWaitMs:0}),allowAssistant:false,connections};
 let runtime=new StreamWeaverProviderRuntime({...options,allowProviderWrites:false});
 await runtime.consumers.find(c=>c.id==='streamweaver.bot-actions').deliver(delivery);
 f.job.state='succeeded';f.job.result={text:'Ready'};await runtime.reconcile();assert.equal(sent.length,1);runtime.close();
 runtime=new StreamWeaverProviderRuntime({...options,allowProviderWrites:true});
 try{await runtime.reconcile();assert.equal(sent.length,2);assert.equal(sent[1].text,'Ready');assert.equal(f.created,1);}finally{runtime.close();}
});

test('public image overlay retries with one event key and an immediate result never sends a second chat reply',async t=>{
 let now=0;const store=new StreamWeaverBotActionReplies(fixture(t),()=>now);t.after(()=>store.close());const f=clientFixture(),sent=[],events=[];
 const client={...f.client,async createSuiteActionJob(...args){const value=await f.client.createSuiteActionJob(...args);value.job.state='succeeded';value.job.result={text:'Ready',resourceUrls:['https://media.example/image.png','javascript:alert(1)','https://secret:password@example.com/image'],prompt:'private provider metadata'};return value;}};
 const c=new StreamWeaverBotActionConsumer(new StreamWeaverSuiteActionJobExecutor(client,{maxWaitMs:0}),{send:async m=>(sent.push(m),{providerMessageId:'sent'})},store);
 await c.deliver(delivery);
 let fail=true;const publish=async(...args)=>{events.push(args);if(fail){fail=false;throw Error('event timeout');}};
 await store.flush(client,async m=>sent.push(m),()=>true,100,publish);now+=5000;
 await store.flush(client,async m=>sent.push(m),()=>true,100,publish);
 assert.equal(sent.length,1);assert.equal(events.length,2);assert.deepEqual(events[0],events[1]);
 assert.deepEqual(events[1].slice(0,3),['tenant-a','streamweaver.image.generated.v1',{visibility:'public',images:['https://media.example/image.png'],actor:'alice'}]);
 assert.equal(f.created,1);
});

test('generated image widget projects only public images from StreamWeaver',async()=>{
 const {streamWeaverWidgetSnapshot,streamWeaverWidgetManifests,renderStreamWeaverWidget}=await import('../apps/streamweaver/dist/overlay-widgets.js');
 const event={id:'event',sourceAppId:'streamweaver',type:'streamweaver.image.generated.v1',occurredAt:'2026-09-06T00:00:00Z',payload:{visibility:'public',images:['https://media.example/image.png','data:image/svg+xml,unsafe'],actor:'Alice',prompt:'secret',credentials:'secret'}};
 const snapshot=streamWeaverWidgetSnapshot([event],event.occurredAt,'generated-image');assert.equal(snapshot.items.length,1);assert.equal(snapshot.items[0].cards.length,1);assert.doesNotMatch(JSON.stringify(snapshot),/secret|svg/);
 assert.equal(streamWeaverWidgetSnapshot([{...event,payload:{...event.payload,visibility:'private'}}],event.occurredAt,'generated-image').items.length,0);
 assert.equal(streamWeaverWidgetSnapshot([{...event,sourceAppId:'untrusted'}],event.occurredAt,'generated-image').items.length,0);
 assert.ok(streamWeaverWidgetManifests('https://apollo.example').some(m=>m.widgetId==='generated-image'));
 assert.match(renderStreamWeaverWidget('generated-image'),/data-widget="generated-image"/);
});
