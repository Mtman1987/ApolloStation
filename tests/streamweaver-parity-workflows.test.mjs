import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StreamWeaverFlowPackageStore,StreamWeaverInstalledFlowConsumer,MemoryStreamWeaverCommandState,StreamWeaverDonorCommandConsumer,DefaultStreamWeaverDonorCommandServices,StreamWeaverRuntimeSettingsStore,SqliteStreamWeaverEconomyStore,StreamWeaverProviderRuntime} from '../apps/streamweaver/dist/index.js';

const author={id:'owner',displayName:'Captain'};
const flow=(id='flow.welcome')=>({schemaVersion:1,kind:'streamweaver.flow-package',packageId:id,name:'Welcome',description:'Welcome the chat',commands:[{id:'hello',trigger:'!hello',aliases:['!hi'],runtime:'flow',matcher:'command',cooldownSeconds:10,enabled:true,actionIds:['value','reply']}],actions:[{id:'reply',type:'send-chat',enabled:true,config:{text:'{{greeting}} %userName%: %args%'}},{id:'value',type:'set-variable',enabled:true,config:{key:'greeting',value:'Welcome'}}]});
function delivery(id='one',text='!hello friends',tenantId='tenant-a'){return {schemaVersion:1,deliveryId:id,consumerId:'streamweaver.installed-flows',attempts:1,message:{schemaVersion:1,tenantId,provider:'discord',connectionId:'main',channelId:'chat',messageId:id,text,occurredAt:'2026-09-05T12:00:00Z',actor:{providerUserId:'discord-owner',canonicalUserId:'owner',username:'captain',displayName:'Captain',roles:['broadcaster'],isBot:false},mentions:[]}}}
function fixture(run){const store=new StreamWeaverFlowPackageStore(':memory:');return Promise.resolve().then(()=>run(store)).finally(()=>store.close())}

test('manual flow lifecycle keeps community originals intact, detects stale edits, pauses only one tenant and removes private drafts',()=>fixture(async store=>{
  const draft=store.editDraft('tenant-a',flow(),author);
  assert.throws(()=>store.editDraft('tenant-b',draft,{id:'another'}),/another tenant/);
  store.install('tenant-a',draft.packageId);
  const edited=store.editDraft('tenant-a',{...draft,name:'Updated'},author,draft.updatedAt);
  assert.notEqual(edited.updatedAt,draft.updatedAt);
  assert.throws(()=>store.editDraft('tenant-a',draft,author,draft.updatedAt),/changed/);
  store.setInstallEnabled('tenant-a',draft.packageId,false);
  assert.equal(store.listInstalls('tenant-a').length,1);assert.equal(store.listInstalledPackages('tenant-a').length,0);
  store.setInstallEnabled('tenant-a',draft.packageId,true);assert.equal(store.listInstalledPackages('tenant-a').length,1);
  const original=store.get('tenant-a','mtman1987.boop'),copy=store.copyDraft('tenant-a',original.packageId,author);
  assert.equal(copy.visibility,'private');assert.equal(copy.commands[0].enabled,original.commands[0].enabled);assert.equal(store.listInstalls('tenant-a').some(i=>i.packageId===copy.packageId),false);
  assert.deepEqual(store.get('tenant-a',original.packageId),original);
  assert.throws(()=>store.editDraft('tenant-a',original,author,original.updatedAt),/Copy a community/);
  store.deleteDraft('tenant-a',draft.packageId,author.id);assert.equal(store.get('tenant-a',draft.packageId),undefined);assert.equal(store.listInstalls('tenant-a').length,0);
}));

test('configured wiring order, aliases, cooldown, replay and tenant isolation drive the real flow runtime',()=>fixture(async store=>{
  const item=store.editDraft('tenant-a',flow(),author);store.install('tenant-a',item.packageId);
  let now=Date.parse('2026-09-05T12:00:00Z');const sent=[],state=new MemoryStreamWeaverCommandState(),runtime=new StreamWeaverInstalledFlowConsumer(store,state,{send:async m=>{sent.push(m);return{providerMessageId:m.idempotencyKey}}},undefined,undefined,()=>now);
  await runtime.deliver(delivery());assert.equal(sent[0].text,'Welcome Captain: friends');
  assert.deepEqual(store.listRuns('tenant-a')[0].steps.map(s=>s.actionId),['value','reply']);
  await runtime.deliver(delivery());assert.equal(sent.length,1,"a completed delivery is not sent twice");
  await runtime.deliver(delivery('two','!hi everyone'));assert.match(sent.at(-1).text,/Wait 10s/);
  now+=10001;await runtime.deliver(delivery('three','!hi everyone'));assert.equal(sent.at(-1).text,'Welcome Captain: everyone');
  assert.equal(runtime.accepts(delivery('four','!hello','tenant-b').message),false);
  assert.equal(store.listRuns('tenant-b').length,0);
}));

test('completed Discord steps survive a later failure and gateway retries use the same message key',()=>fixture(async store=>{
  const input=flow();input.commands[0].actionIds=['discord','later'];input.actions=[{id:'discord',type:'send-discord',enabled:true,config:{text:'Hello Discord'}},{id:'later',type:'run-native',enabled:true,config:{capability:'streamweaver.donor-command.v1',donorId:'boop'}}];
  const item=store.editDraft('tenant-a',input,author);store.install('tenant-a',item.packageId);
  let fail=true;const sent=[],runtime=new StreamWeaverInstalledFlowConsumer(store,new MemoryStreamWeaverCommandState(),{send:async m=>{sent.push(m);return{providerMessageId:'sent'}}},undefined,{execute:async()=>{if(fail)throw Error('Temporary failure');return 'Done'}});
  await assert.rejects(runtime.deliver(delivery()),/Temporary failure/);assert.equal(store.listRuns('tenant-a')[0].state,'failed');
  fail=false;await runtime.deliver(delivery());assert.equal(sent.filter(m=>m.text==='Hello Discord').length,1);assert.equal(sent.at(-1).text,'Done');assert.equal(store.listRuns('tenant-a')[0].state,'succeeded');
}));

test('unsupported imported steps cannot become enabled or report a successful preview',()=>fixture(async store=>{
  const input=flow();input.actions[0]={...input.actions[0],type:'execute-code',config:{code:'return 1;'}};
  const saved=store.editDraft('tenant-a',input,author);
  assert.throws(()=>store.approveAndInstall('tenant-a',saved.packageId),/registered execution capability/);
  const runtime=new StreamWeaverInstalledFlowConsumer(store,new MemoryStreamWeaverCommandState(),{send:async()=>({providerMessageId:'sent'})});
  await assert.rejects(runtime.preview(saved,'hello',delivery()),/registered execution capability/);
  assert.equal(store.listInstalls('tenant-a').length,0);assert.equal(store.exportPackage('tenant-a',saved.packageId).actions[0].config.code,'return 1;');
}));

test('chat steps deliver in sequence instead of waiting for the entire pipeline, and interrupted delivery retries keep their identity',()=>fixture(async store=>{
  const input=flow();input.commands[0].actionIds=['reply','later'];input.actions=[{id:'reply',type:'send-chat',enabled:true,config:{text:'Starting now'}},{id:'later',type:'run-native',enabled:true,config:{capability:'streamweaver.donor-command.v1',donorId:'boop'}}];
  const saved=store.editDraft('tenant-a',input,author);store.install('tenant-a',saved.packageId);
  const sent=[];let fail=true;
  const runtime=new StreamWeaverInstalledFlowConsumer(store,new MemoryStreamWeaverCommandState(),{send:async m=>{sent.push(m);return {providerMessageId:m.idempotencyKey}}},undefined,{execute:async()=>{assert.equal(sent[0].text,'Starting now');if(fail)throw Error('Interrupted');return 'Finished'}});
  await assert.rejects(runtime.deliver(delivery()),/Interrupted/);assert.equal(sent.length,1);
  fail=false;await runtime.deliver(delivery());assert.equal(sent.filter(m=>m.text==='Starting now').length,1);assert.equal(sent.at(-1).text,'Finished');
}));

test('customized native command names execute their bound action instead of requiring the old trigger',async()=>{
  const native=new StreamWeaverDonorCommandConsumer({services:new DefaultStreamWeaverDonorCommandServices({}),identities:{resolve:()=>author.id},state:new MemoryStreamWeaverCommandState(),egress:{send:async()=>({providerMessageId:'sent'})}});
  assert.match(await native.execute('boop',delivery('rename','!greet')),/boop/);
});

test('creator links and social/Bic adapters are connected in the provider runtime and survive restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sw-parity-')),path=join(dir,'runtime.sqlite'),events=[],sent=[];
  let runtime;
  try{
    const settings=new StreamWeaverRuntimeSettingsStore(path);settings.saveLinks('tenant-a',{webpage:'https://example.org/community'});settings.close();
    const store=new StreamWeaverFlowPackageStore(path);for(const id of ['webpage','boop','bic'])store.install('tenant-a','mtman1987.'+id);store.close();
    const make=()=>new StreamWeaverProviderRuntime({databasePath:path,client:{publishEvent:async(t,type,payload)=>{events.push({t,type,payload});return{};}},egress:{send:async m=>{sent.push(m);return{providerMessageId:'sent'}}},allowAssistant:false});
    runtime=make();let flows=runtime.consumers.find(c=>c.id==='streamweaver.installed-flows');
    await flows.deliver(delivery('link','!webpage'));assert.equal(sent.at(-1).text,'https://example.org/community');
    await flows.deliver(delivery('social','!boop'));assert.ok(events.some(e=>e.type==='streamweaver.social.interaction.v1'));
    await flows.deliver(delivery('bic','!bic captain'));assert.ok(events.some(e=>e.type==='streamweaver.bic.counter.updated.v1'));
    runtime.close();runtime=make();flows=runtime.consumers.find(c=>c.id==='streamweaver.installed-flows');await flows.deliver(delivery('link2','!webpage'));assert.match(sent.at(-1).text,/example.org|Wait/);
  }finally{runtime?.close();rmSync(dir,{recursive:true,force:true})}
});

test('currency adjustment retries are atomic and reject a reused key with different values',()=>{
  const store=new SqliteStreamWeaverEconomyStore(':memory:');try{
    assert.equal(store.adjustOnce('tenant-a','owner','add',50,'request','owner').wallet.balance,50);
    assert.equal(store.adjustOnce('tenant-a','owner','add',50,'request','owner').duplicate,true);
    assert.equal(store.getWallet('tenant-a','owner').balance,50);
    assert.throws(()=>store.adjustOnce('tenant-a','owner','add',99,'request','owner'),/different values/);
    assert.throws(()=>store.adjustOnce('tenant-a','owner','add',-51,'other','owner'),/balance/);
    assert.equal(store.getWallet('tenant-a','owner').balance,50);assert.equal(store.getWallet('tenant-b','owner').balance,0);
  }finally{store.close()}
});

test('saved voice history is user and tenant scoped and clearing preserves other conversations',()=>{
  const store=new StreamWeaverRuntimeSettingsStore(':memory:');try{
    store.recordVoice('tenant-a','owner','one',{message:'hello',jobId:'job'});store.recordVoice('tenant-a','member','two',{message:'private to member'});
    assert.equal(store.voiceHistory('tenant-a','owner').length,1);assert.equal(store.voiceHistory('tenant-b','owner').length,0);
    store.clearVoice('tenant-a','owner');assert.equal(store.voiceHistory('tenant-a','owner').length,0);assert.equal(store.voiceHistory('tenant-a','member').length,1);
    assert.throws(()=>store.saveLinks('tenant-a',{webpage:'javascript:alert(1)'}),/HTTPS/);
  }finally{store.close()}
});
