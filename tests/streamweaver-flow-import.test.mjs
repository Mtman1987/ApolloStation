import test from 'node:test';
import assert from 'node:assert/strict';
import {importStreamWeaverLegacy,StreamWeaverFlowPackageStore,StreamWeaverInstalledFlowConsumer,MemoryStreamWeaverCommandState} from '../apps/streamweaver/dist/index.js';
const author={id:'owner'},now='2026-09-05T00:00:00Z';
const source={format:'streamerbot-package',extra:{preserve:'all fields'},commands:[{id:'greet',name:'Greet',command:'!hello\n!hi',actionId:'pipeline',caseSensitive:true,userCooldown:4}],actions:[{id:'pipeline',name:'Welcome',subActions:[{type:'SetArgument',variableName:'hello',value:'Welcome'},{type:'RunAction',actionId:'reply'}]},{id:'reply',name:'Reply',subactions:[{type:'SendChatMessage',message:'{{hello}} %userName%',customSourceField:19}]}]};
test('legacy archive preserves fields, aliases, referenced subaction order and exact original data',()=>{
 const result=importStreamWeaverLegacy(source,author,now),pkg=result.packages[0];assert.equal(result.warnings.length,0);assert.deepEqual(pkg.actions.map(a=>a.type),['set-variable','send-chat']);assert.deepEqual(pkg.commands[0].aliases,['!hi']);assert.equal(pkg.commands[0].caseSensitive,true);assert.equal(pkg.actions[1].config.legacy.customSourceField,19);assert.deepEqual(pkg.legacySource.source,source);assert.notEqual(importStreamWeaverLegacy(source,author,now,'other-tenant').packages[0].packageId,pkg.packageId);
 const store=new StreamWeaverFlowPackageStore(':memory:');try{const saved=store.saveDraft('tenant',pkg,author);assert.deepEqual(store.exportPackage('tenant',saved.packageId).legacySource.source,source);}finally{store.close()}
});
test('live graph import preserves conditional edge outcomes and reusable AI result variables',()=>{
 const value={commands:[{id:'ask',command:'!ask',actionId:'answer'}],actions:[{id:'answer',flow:{version:'1.0.0',nodes:[{id:'start',type:'trigger',subtype:'start',position:{x:1,y:2},data:{}},{id:'ai',type:'action',subtype:'ai-response',data:{input:'{{args}}',saveAs:'answer'}},{id:'choice',type:'condition',subtype:'text-includes',data:{source:'{{vars.answer}}',value:'yes'}},{id:'reply',type:'action',subtype:'send-chat',data:{message:'{{lastOutput}}'}}],edges:[{source:'start',target:'ai'},{source:'ai',target:'choice'},{source:'choice',target:'reply',conditions:{outcome:'true'}}]}}]};
 const result=importStreamWeaverLegacy(value,author,now),pkg=result.packages[0];assert.equal(result.warnings.length,0);assert.equal(pkg.actions[1].config.saveAs,'answer');assert.equal(pkg.commands[0].edges[2].outcome,'true');assert.deepEqual(pkg.legacySource.source,value);
});
test('unmapped steps and access rules retain their source and cannot be enabled accidentally',()=>{
 const value={...source,commands:[{...source.commands[0],permittedGroups:['Subscribers']}],actions:[{id:'pipeline',subactions:[{type:'CSharpCode',code:'return 1;'}]}]},result=importStreamWeaverLegacy(value,author,now);
 assert.equal(result.warnings.length,3);const store=new StreamWeaverFlowPackageStore(':memory:');try{const pkg=store.saveDraft('tenant',result.packages[0],author);assert.throws(()=>store.approveAndInstall('tenant',pkg.packageId),/access rules/);assert.equal(pkg.actions[0].config.legacy.code,'return 1;');assert.equal(store.listInstalls('tenant').length,0);}finally{store.close()}
});
test('recursive imported actions fail clearly without dropping the cycle',()=>{
 assert.throws(()=>importStreamWeaverLegacy({...source,actions:[{id:'pipeline',subactions:[{type:'RunAction',actionId:'pipeline'}]}]},author,now),/recursively/);
});
test('imported commands enforce selected access, case and shared cooldown at actual delivery',async()=>{
 const store=new StreamWeaverFlowPackageStore(':memory:');let nowMs=100000;const sent=[];
 try{
 const pkg=importStreamWeaverLegacy({...source,commands:[{...source.commands[0],globalCooldown:10}]},author,now).packages[0];pkg.commands[0].minimumRole='moderator';store.saveDraft('tenant',pkg,author);store.approveAndInstall('tenant',pkg.packageId);
 const runtime=new StreamWeaverInstalledFlowConsumer(store,new MemoryStreamWeaverCommandState(),{send:async m=>{sent.push(m);return {providerMessageId:'sent'}}},undefined,undefined,()=>nowMs);
 const delivery=(id,roles,text='!hello')=>({schemaVersion:1,deliveryId:id,consumerId:runtime.id,attempts:1,message:{schemaVersion:1,tenantId:'tenant',provider:'twitch',connectionId:'main',channelId:'chat',messageId:id,text,occurredAt:now,actor:{providerUserId:id,canonicalUserId:id,username:id,roles,isBot:false},mentions:[]}});
 await runtime.deliver(delivery('viewer',['member']));assert.match(sent[0].text,/moderator/);
 assert.equal(runtime.accepts(delivery('mod',['moderator'],'!HELLO').message),false);
 await runtime.deliver(delivery('mod',['moderator']));assert.equal(sent[1].text,'Welcome mod');await runtime.deliver(delivery('other-mod',['moderator']));assert.match(sent[2].text,/Wait 10s/);
 nowMs+=10001;await runtime.deliver(delivery('third-mod',['moderator']));assert.equal(sent[3].text,'Welcome third-mod');
 }finally{store.close()}
});
test('reusable graph actions remain connected to following command steps',()=>{
 const archive={commands:[{id:'test',command:'!test',actionIds:['graph','tail']}],actions:[{id:'graph',flow:{nodes:[{id:'start',type:'trigger',subtype:'start'},{id:'message',type:'action',subtype:'send-chat',data:{message:'First'}}],edges:[{source:'start',target:'message'}]}},{id:'tail',subActions:[{type:'SendChatMessage',message:'Second'},{type:'SendChatMessage',message:'Third'}]}]};
 const pkg=importStreamWeaverLegacy(archive,author,now).packages[0];assert.deepEqual(pkg.commands[0].edges.map(e=>[e.source,e.target]),[['step.0','step.1'],['step.2','step.3'],['step.1','step.2']]);
});

test('nested legacy branches resume the enclosing action on either outcome without running the skipped branch',async()=>{
 const archive={commands:[{id:'test',command:'!test',actionIds:['outer','tail']}],actions:[
  {id:'inner',flow:{nodes:[{id:'start',type:'trigger',subtype:'start'},{id:'choice',type:'condition',subtype:'text-includes',data:{source:'%args%',value:'yes'}},{id:'yes',type:'action',subtype:'send-chat',data:{message:'Yes branch'}}],edges:[{source:'start',target:'choice'},{source:'choice',target:'yes',sourceHandle:'true'}]}},
  {id:'outer',flow:{nodes:[{id:'begin',type:'trigger',subtype:'start'},{id:'nested',type:'RunAction',actionId:'inner'},{id:'after',type:'action',subtype:'send-chat',data:{message:'After inner'}}],edges:[{source:'begin',target:'nested'},{source:'nested',target:'after'}]}},
  {id:'tail',subActions:[{type:'SendChatMessage',message:'After outer'}]}
 ]},store=new StreamWeaverFlowPackageStore(':memory:'),sent=[];
 try{
  const pkg=importStreamWeaverLegacy(archive,author,now).packages[0];store.saveDraft('tenant',pkg,author);store.approveAndInstall('tenant',pkg.packageId);
  const runtime=new StreamWeaverInstalledFlowConsumer(store,new MemoryStreamWeaverCommandState(),{send:async m=>{sent.push(m.text);return {providerMessageId:String(sent.length)}}});
  const delivery=(id,text)=>({schemaVersion:1,deliveryId:id,consumerId:runtime.id,attempts:1,message:{schemaVersion:1,tenantId:'tenant',provider:'twitch',connectionId:'main',channelId:'chat',messageId:id,text,occurredAt:now,actor:{providerUserId:'viewer',username:'viewer',roles:['member'],isBot:false},mentions:[]}});
  await runtime.deliver(delivery('yes','!test yes'));assert.deepEqual(sent,['Yes branch','After inner','After outer']);sent.length=0;
  await runtime.deliver(delivery('no','!test no'));assert.deepEqual(sent,['After inner','After outer']);
 }finally{store.close()}
});

test('regex imports honor the selected case rule at delivery',()=>{
 const archive={commands:[{id:'regex',command:'^Hello$',regex:true,caseSensitive:false,actionId:'reply'}],actions:[{id:'reply',subactions:[{type:'SendChatMessage',message:'Hello'}]}]},store=new StreamWeaverFlowPackageStore(':memory:');
 try{
  const pkg=importStreamWeaverLegacy(archive,author,now).packages[0];store.saveDraft('tenant',pkg,author);store.approveAndInstall('tenant',pkg.packageId);
  const runtime=new StreamWeaverInstalledFlowConsumer(store,new MemoryStreamWeaverCommandState(),{send:async()=>({providerMessageId:'sent'})}),message={tenantId:'tenant',text:'HELLO',actor:{isBot:false}};
  assert.equal(runtime.accepts(message),true);const draft=store.exportPackage('tenant',pkg.packageId);draft.commands[0].caseSensitive=true;store.saveDraft('tenant',draft,author);store.approveAndInstall('tenant',pkg.packageId);assert.equal(runtime.accepts(message),false);assert.equal(runtime.accepts({...message,text:'Hello'}),true);
 }finally{store.close()}
});

test('copy, import and installation preserve disabled commands, referenced actions and steps at delivery and preview',async()=>{
 const archive={commands:[{id:'enabled',command:'!test',actionId:'outer'},{id:'disabled',command:'!disabled',actionId:'outer',enabled:false}],actions:[{id:'outer',subActions:[{type:'SendChatMessage',message:'First'},{type:'RunAction',actionId:'nested',enabled:false},{type:'SendChatMessage',message:'Disabled',enabled:false},{type:'SendChatMessage',message:'Last'}]},{id:'nested',subActions:[{type:'SendChatMessage',message:'Must stay off'}]}]},store=new StreamWeaverFlowPackageStore(':memory:'),sent=[];
 try{
  const review=importStreamWeaverLegacy(archive,author,now);const pkg=store.saveDraft('tenant',review.packages[0],author);const disabled=store.saveDraft('tenant',review.packages[1],author);
  assert.equal(store.listInstalls('tenant').length,0);const copy=store.copyDraft('tenant',pkg.packageId,author);assert.deepEqual(copy.actions.map(a=>a.enabled),[true,false,false,true]);
  const imported=store.importPackage('tenant',pkg,author);assert.notEqual(imported.package.packageId,pkg.packageId);assert.equal(store.listInstalls('tenant').length,0);
  store.approveAndInstall('tenant',pkg.packageId);store.approveAndInstall('tenant',disabled.packageId);
  const runtime=new StreamWeaverInstalledFlowConsumer(store,new MemoryStreamWeaverCommandState(),{send:async m=>{sent.push(m.text);return {providerMessageId:String(sent.length)}}}),delivery={schemaVersion:1,deliveryId:'run',consumerId:runtime.id,attempts:1,message:{schemaVersion:1,tenantId:'tenant',provider:'twitch',connectionId:'main',channelId:'chat',messageId:'run',text:'!test',occurredAt:now,actor:{providerUserId:'viewer',username:'viewer',roles:['member'],isBot:false},mentions:[]}};
  assert.equal(runtime.accepts({...delivery.message,text:'!disabled'}),false);await runtime.deliver(delivery);assert.deepEqual(sent,['First','Last']);assert.deepEqual(store.listRuns('tenant')[0].steps.map(s=>s.state),['succeeded','skipped','skipped','succeeded']);
  assert.deepEqual((await runtime.preview(pkg,pkg.commands[0].id,delivery)).outputs.map(s=>s.text),['First','Last']);
 }finally{store.close()}
});
