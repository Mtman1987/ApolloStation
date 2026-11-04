import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StreamWeaverFlowPackageStore,StreamWeaverInstalledFlowConsumer,MemoryStreamWeaverCommandState} from '../apps/streamweaver/dist/index.js';
const author={id:'owner'};
const delivery=(id='one',text='!test yes',tenantId='tenant')=>({schemaVersion:1,deliveryId:id,consumerId:'streamweaver.installed-flows',attempts:1,message:{schemaVersion:1,tenantId,provider:'discord',connectionId:'main',channelId:'chat',messageId:id,text,occurredAt:'2026-09-05T12:00:00Z',actor:{providerUserId:'provider-owner',canonicalUserId:'owner',username:'captain',roles:['broadcaster'],isBot:false},mentions:[]}});
function install(store,actions,edges){const value=store.editDraft('tenant',{kind:'streamweaver.flow-package',packageId:'test',name:'Test',commands:[{id:'test',trigger:'!test',actionIds:actions.map(a=>a.id),...(edges?{edges}:{})}],actions},author);store.install('tenant',value.packageId);return value;}
const step=(id,type,config)=>({id,type,config});
function harness(store,services={},clock=Date.now,suite){const messages=[],runtime=new StreamWeaverInstalledFlowConsumer(store,new MemoryStreamWeaverCommandState(),{send:async message=>{messages.push(message);return {providerMessageId:message.idempotencyKey}}},suite,undefined,clock,services);return {messages,runtime};}

test('branches execute only the selected path, preserve template values and reject cyclic wiring',async()=>{
 const store=new StreamWeaverFlowPackageStore(':memory:');try{
 const item=install(store,[step('choose','condition',{left:'{{args[0]}}',operator:'==',right:'yes'}),step('yes','send-chat',{text:'Yes {{tags["display-name"]}}'}),step('no','send-chat',{text:'No'}),step('done','send-chat',{text:'Finished'})],[{source:'choose',target:'yes',outcome:'true'},{source:'choose',target:'no',outcome:'false'},{source:'yes',target:'done'},{source:'no',target:'done'}]);
 const {runtime,messages}=harness(store);await runtime.deliver(delivery());assert.deepEqual(messages.map(m=>m.text),['Yes captain','Finished']);await runtime.deliver(delivery('two','!test no'));assert.deepEqual(messages.slice(2).map(m=>m.text),['No','Finished']);
 assert.throws(()=>store.editDraft('tenant',{...item,commands:[{...item.commands[0],edges:[{source:'choose',target:'yes'},{source:'yes',target:'choose'}]}]},author,item.updatedAt),/cycle/);
 }finally{store.close()}
});

test('async result and captured graph resume after restart and an installed draft edit',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sw-graph-')),path=join(dir,'flows.sqlite');let store=new StreamWeaverFlowPackageStore(path);let invoked=0,state='running';
 const services={assistant:async()=>{invoked++;return {status:'accepted',jobId:'job-1'}},getJob:async()=>({state,result:{text:'The real answer'}})};
 try{
 const item=install(store,[step('ai','ai-response',{input:'%args%',saveAs:'answer'}),step('reply','send-chat',{text:'{{answer}}'})]);
 let h=harness(store,services);await h.runtime.deliver(delivery());assert.equal(invoked,1);assert.equal(h.messages.length,0);assert.equal(store.listRuns('tenant')[0].state,'waiting');
 store.editDraft('tenant',{...item,actions:[item.actions[0],step('reply','send-chat',{text:'Wrong updated response'})]},author,item.updatedAt);store.close();store=new StreamWeaverFlowPackageStore(path);state='succeeded';h=harness(store,services);await h.runtime.reconcile();assert.equal(invoked,1);assert.deepEqual(h.messages.map(m=>m.text),['The real answer']);assert.equal(store.listRuns('tenant')[0].state,'succeeded');await h.runtime.deliver(delivery());assert.equal(h.messages.length,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});

test('durable waits do not block other inputs and persistent values are bounded to tenant and package',async()=>{
 const store=new StreamWeaverFlowPackageStore(':memory:');let now=100000;
 try{
 install(store,[step('value','set-variable',{key:'captain',value:'%args%',scope:'persistent'}),step('wait','wait',{milliseconds:5000}),step('reply','send-chat',{text:'{{vars.captain}}'})]);
 const h=harness(store,{},()=>now);await h.runtime.deliver(delivery());assert.equal(h.messages.length,0);assert.equal(store.variables('tenant','test').captain,'yes');assert.deepEqual(store.variables('other','test'),{});assert.deepEqual(store.variables('tenant','other'),{});
 await h.runtime.deliver(delivery('two','!test second'));now+=5001;await h.runtime.reconcile();assert.deepEqual(h.messages.map(m=>m.text),['yes','second']);
 }finally{store.close()}
});

test('cross-app job failure is retained as failure and pending results feed later action arguments',async()=>{
 const store=new StreamWeaverFlowPackageStore(':memory:');let jobState='running',calls=[];
 try{
 install(store,[step('query','run-action',{action:'hmo.rooms.read',args:{},saveAs:'rooms',sendResult:false}),step('next','run-action',{action:'hmo.media.state.read',args:{roomId:'{{rooms}}'},sendResult:true})]);
 const suite={execute:async request=>{calls.push(request);return calls.length===1?{response:'queued',result:{jobId:'rooms-job',state:'queued'}}:{response:'Playing real track'}}};
 const h=harness(store,{getJob:async()=>({state:jobState,result:{text:'studio'}})},Date.now,suite);await h.runtime.deliver(delivery());assert.equal(calls.length,1);jobState='succeeded';await h.runtime.reconcile();assert.equal(calls[1].args.roomId,'studio');assert.deepEqual(h.messages.map(m=>m.text),['Playing real track']);
 }finally{store.close()}
});

test('speech waits across reconciliation and signed point changes run once after it completes',async()=>{
 const store=new StreamWeaverFlowPackageStore(':memory:');let speechCalls=0,pointCalls=0,state='running';
 try{
 install(store,[step('voice','speak',{text:'Hello {{args[0]}}'}),step('award','points',{delta:'500',saveAs:'balance'}),step('reply','send-chat',{text:'Balance {{balance}}'})]);
 const h=harness(store,{speech:async input=>{speechCalls++;assert.equal(input.text,'Hello yes');return {jobId:'speech-one'}},getJob:async()=>({state,result:{text:'Hello yes'}}),points:async input=>{pointCalls++;assert.equal(input.delta,500);assert.equal(input.ownerUserId,'owner');return 750}});
 await h.runtime.deliver(delivery());await h.runtime.reconcile();assert.equal(speechCalls,1);assert.equal(pointCalls,0);
 state='succeeded';await h.runtime.reconcile();await h.runtime.deliver(delivery());assert.equal(speechCalls,1);assert.equal(pointCalls,1);assert.deepEqual(h.messages.map(m=>m.text),['Balance 750']);
 }finally{store.close()}
});
test('failed speech prevents subsequent currency effects',async()=>{
 const store=new StreamWeaverFlowPackageStore(':memory:');let pointCalls=0;
 try{install(store,[step('voice','speak',{text:'Hello'}),step('charge','points',{delta:'-500'})]);const h=harness(store,{speech:async()=>({jobId:'failed-speech'}),getJob:async()=>({state:'failed',error:{message:'Provider unavailable'}}),points:async()=>{pointCalls++;return 0}});await assert.rejects(()=>h.runtime.deliver(delivery()));assert.equal(pointCalls,0);assert.equal(store.listRuns('tenant')[0].state,'failed');}finally{store.close()}
});
