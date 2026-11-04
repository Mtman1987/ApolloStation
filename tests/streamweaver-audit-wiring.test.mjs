import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { StreamWeaverImageGenerationService } from '../apps/streamweaver/dist/image-generation.js';
import { EdenStreamWeaverImageProvider } from '../apps/streamweaver/dist/eden-image-provider.js';
import { StreamWeaverGenerationStore } from '../apps/streamweaver/dist/generation-settings.js';
import { downloadGeneratedImage } from '../apps/streamweaver/dist/generated-media-download.js';
import { StreamWeaverCommunityStore } from '../apps/streamweaver/dist/community-store.js';
import { StreamWeaverPresentationRuntime } from '../apps/streamweaver/dist/stream-presentation-runtime.js';
import { SqliteStreamWeaverShoutoutStore } from '../apps/streamweaver/dist/shoutout-store.js';
import { streamWeaverGenerationBrowserJs } from '../apps/streamweaver/dist/generation-client.js';
import { streamWeaverOperationsBrowserJs } from '../apps/streamweaver/dist/stream-operations-client.js';
import { STREAMWEAVER_WIDGET_CLIENT, streamWeaverWidgetSnapshot } from '../apps/streamweaver/dist/overlay-widgets.js';

test('image selection reaches Eden with model parameters and enhancer failure preserves original prompt',async()=>{
  const calls=[],eden=new EdenStreamWeaverImageProvider('test-key','image/generation/stabilityai',async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json({status:'success',output:{items:[{image_resource_url:'https://media.edenai.run/a.png'},{image_resource_url:'https://media.edenai.run/b.png'}]}})});
  const service=new StreamWeaverImageGenerationService([{id:'seaart-cli',generateImage:()=>{throw Error('must not call')}},eden],{enhance:()=>{throw Error('offline')}});
  const result=await service.image({prompt:'A blue bird',provider:'edenai',modelNo:'',modelVerNo:'',count:2,seed:17,resolution:'768x1024',providerParams:{cfg_scale:7}});
  assert.deepEqual(result.attemptedProviders,['edenai']);assert.equal(calls[0].body.input.text,'A blue bird');assert.equal(calls[0].body.provider_params.seed,17);assert.equal(calls[0].body.provider_params.cfg_scale,7);assert.equal(result.resourceUrls.length,2);
});
test('private image settings stay user scoped and unsafe downloads never receive credentials',async()=>{
  const store=new StreamWeaverGenerationStore(':memory:');try{store.save('a','private:one',{provider:'edenai',seed:99});assert.equal(store.read('a','private:two').seed,0);assert.equal(store.read('a').seed,0);assert.throws(()=>store.save('a','public',{providerParams:{authorization:'secret'}}),/Unsupported/);}finally{store.close()}
  let called=0;await assert.rejects(downloadGeneratedImage('https://127.0.0.1/a.png',async()=>{called++;}),/unapproved/);assert.equal(called,0);
  await downloadGeneratedImage('https://media.edenai.run/a.png',async(url,init)=>{assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');return new Response(Buffer.from([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}})});
});
test('production welcome queues once, shoutout creates speech, and BRB starts and stops',async()=>{
  const store=new StreamWeaverCommunityStore(':memory:'),shoutoutStore=new SqliteStreamWeaverShoutoutStore(':memory:'),jobs=[],chat=[],events=[];
  const clip={id:'clip-id',embed_url:'https://clips.twitch.tv/embed?clip=clip-id',thumbnail_url:'https://example.com/clip.jpg',duration:20,title:'Our clip'};
  const runtime=new StreamWeaverPresentationRuntime({store,shoutoutStore,twitch:{lookupUser:async(_,login)=>({id:'123',login,displayName:login}),clips:async()=>[clip],chatters:async()=>[{id:'123',username:'captain'}]},client:{publishEvent:async()=>{},createExecutionJob:async(...args)=>{jobs.push(args);return {job:{id:'speech'}}}},personas:{get:()=>({ownerCanonicalUserId:'owner'})},connections:[{tenantId:'a',provider:'twitch',connectionId:'main',channelId:'123',desired:true}],egress:{send:async m=>{chat.push(m)}}});
  try{store.saveSettings('a',{welcomeEnabled:true,welcomeShoutout:true});store.welcome('a','twitch','123','Captain','captain');store.welcome('a','twitch','123','Captain','captain');assert.equal(store.pendingTasks().length,1);await runtime.runOnce();assert.equal(jobs.length,1);assert.equal(jobs[0][1].input.mediaVisibility,'public');assert.equal(chat.length,2);await runtime.runOnce();assert.equal(jobs.length,1);store.requestTask('a','brb',{action:'brb-start'});await runtime.runOnce();assert.equal(store.program('a').index,1);store.requestTask('a','stop',{action:'brb-stop'});await runtime.runOnce();assert.equal(store.program('a'),undefined);await store.flush(async(...args)=>events.push(args));assert.ok(events.some(e=>e[2].operation==='stop'));}finally{store.close();shoutoutStore.close()}
});
test('public speech projects only explicitly published Stellar events and keeps featured hold style',()=>{
  const occurredAt=new Date().toISOString(),events=[{id:'speech',occurredAt,sourceAppId:'stellar-core',type:'stellar.speech.playback.v1',payload:{kind:'tts-player',mediaUrl:'https://example.com/audio.mp3',text:'Hello'}},{id:'private',occurredAt,sourceAppId:'stellar-core',type:'private-note',payload:{text:'secret'}},{id:'featured',occurredAt,sourceAppId:'commlink',type:'commlink.chat.featured.v1',payload:{text:'Pinned',style:'minimal',durationMs:0}}];
  const items=streamWeaverWidgetSnapshot(events).items;assert.equal(items.length,2);assert.equal(items[0].kind,'tts-player');assert.equal(items[1].durationMs,0);assert.equal(items[1].style,'minimal');
});
test('generation, operations and overlay browser bundles parse',()=>{for(const code of [streamWeaverGenerationBrowserJs(),streamWeaverOperationsBrowserJs(),STREAMWEAVER_WIDGET_CLIENT])assert.doesNotThrow(()=>new vm.Script(code));});

test('image worker enforces current public access for every suite entry point',async()=>{
 const {StreamWeaverImageWorker}=await import('../apps/streamweaver/dist/image-worker.js');
 const store=new StreamWeaverGenerationStore(':memory:');let role='member',generated=0,succeeded=0,failed=[];
 const client={reportExecutionWorker:async()=>{},claimAnyExecutionJob:async()=>({id:'job',tenantId:'a',billedUserId:'viewer',capabilityId:'streamweaver.image.generate.v1',leaseId:'lease',fencingEpoch:1,input:{schemaVersion:1,action:'sw.image.generate',args:{prompt:'A bird'},actor:{userId:'viewer',username:'Viewer',role},source:{kind:'voice-commander'}}}),heartbeatExecutionJob:async()=>{},succeedExecutionJob:async()=>succeeded++,failExecutionJob:async(...args)=>failed.push(args[6])};
 const worker=new StreamWeaverImageWorker(client,{image:async()=>{generated++;return {resourceUrls:['https://media.edenai.run/bird.png'],provider:'edenai'}}},{workerId:'worker',modelNo:'',modelVerNo:'',settings:store});
 try{store.save('a','public',{publicAccess:'off'});await worker.runOnce();assert.equal(generated,0);assert.match(failed.at(-1),/restricted/);store.save('a','public',{publicAccess:'mods'});await worker.runOnce();assert.equal(generated,0);role='moderator';await worker.runOnce();assert.equal(generated,1);assert.equal(succeeded,1);}finally{store.close()}
});

test('shoutout AI resumes a saved job, applies tenant settings, and records an isolated audit',async()=>{
 const store=new StreamWeaverCommunityStore(':memory:'),shoutoutStore=new SqliteStreamWeaverShoutoutStore(':memory:'),requests=[],messages=[];let state='queued';
 store.deferTask=()=>{};
 const runtime=new StreamWeaverPresentationRuntime({store,shoutoutStore,twitch:{lookupUser:async(_,login)=>({id:'123',login,displayName:login}),clips:async()=>[],chatters:async()=>[]},client:{publishEvent:async()=>{},invokeCommunityAssistant:async(...args)=>{requests.push(args);return {jobId:'greeting'}},getExecutionJob:async()=>({tenantId:'a',ownerAppId:'stellar-core',billedUserId:'owner',state,input:{conversationId:requests[0][1].conversationId},result:{text:'Hello Captain!'}})},personas:{get:()=>({ownerCanonicalUserId:'owner'})},connections:[{tenantId:'a',provider:'twitch',connectionId:'main',channelId:'123',desired:true}],egress:{send:async m=>messages.push(m)}});
 try{shoutoutStore.saveSettings('a',{aiEnabled:true,discordEnabled:false,cooldownMinutes:2,excluded:['nightmare']});store.saveSettings('a',{shoutoutMode:'chat'});store.requestTask('a','one',{action:'shoutout',username:'captain'});await runtime.runOnce();await runtime.runOnce();assert.equal(requests.length,1);assert.equal(messages.length,0);state='succeeded';await runtime.runOnce();assert.equal(messages.length,1);assert.match(messages[0].text,/Hello Captain/);assert.equal(store.tasks('a')[0].state,'complete');assert.equal(shoutoutStore.auditLog('a').some(e=>e.status==='completed'),true);assert.equal(shoutoutStore.auditLog('b').length,0);assert.equal(shoutoutStore.settings('b').aiEnabled,false);assert.equal(shoutoutStore.eligibility('a','nightmare',true).reason,'excluded-user');shoutoutStore.record('a','captain','auto');assert.ok(shoutoutStore.eligibility('a','captain').remainingMs<=120000);}finally{store.close();shoutoutStore.close()}
});
