import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CommlinkLiveChatStore,createSpmtCommlinkLiveChatConsumer} from '../packages/commlink-core/dist/index.js';
import {ChatGatewayRuntime,SqliteChatGatewayStore,normalizeProviderChatEnvelope,chatGatewayCatalogRegistration} from '../apps/chat-gateway/dist/index.js';
import {createSpmtService} from '../apps/spmt-service/dist/index.js';
import {SpmtClient} from '../packages/sdk/dist/index.js';
const envelope={schemaVersion:1,tenantId:'a',provider:'discord',connectionId:'discord-main',channelId:'12345',messageId:'54321',occurredAt:'2026-09-06T10:00:00Z',text:'Original',providerUserId:'user1',canonicalUserId:'owner',username:'Viewer',roles:['member'],mentions:[]};
const mutation=(extra={})=>({schemaVersion:1,tenantId:'a',provider:'discord',connectionId:'discord-main',channelId:'12345',messageId:'54321',operation:'edit',occurredAt:'2026-09-06T10:01:00Z',text:'Edited',...extra});
test('provider corrections preserve identity, merge partial edits and retain deletion across restart and late creation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-corrections-')),path=join(dir,'chat.sqlite');let store=new CommlinkLiveChatStore(path);
 try{store.ingest(normalizeProviderChatEnvelope(envelope));store.mutate(mutation({canonicalUserId:'forged',roles:['broadcaster']}));let r=store.list({tenantId:'a'})[0];assert.equal(r.text,'Edited');assert.equal(r.canonicalUserId,'owner');assert.deepEqual(r.roles,['member']);
 store.mutate(mutation({text:undefined,occurredAt:'2026-09-06T10:02:00Z',rich:{source:'discord',eventType:'edit',attachments:[{name:'Photo',url:'https://cdn.example/photo.png'}]}}));store.mutate(mutation({occurredAt:'2026-09-06T10:00:30Z',text:'Stale'}));r=store.list({tenantId:'a'})[0];assert.equal(r.text,'Edited');assert.equal(r.rich.attachments.length,1);
 store.mutate(mutation({channelId:'99999',operation:'delete'}));store.mutate(mutation({tenantId:'b',operation:'delete'}));assert.equal(store.list({tenantId:'a'})[0].text,'Edited');
 store.mutate(mutation({operation:'delete'}));store.close();store=new CommlinkLiveChatStore(path);store.mutate(mutation({occurredAt:'2026-09-06T11:00:00Z',text:'Resurrect'}));store.ingest(normalizeProviderChatEnvelope(envelope));r=store.list({tenantId:'a'})[0];assert.equal(r.rich.deleted,true);assert.equal(r.rich.attachments.length,0);assert.equal(r.text,'[Message removed]');
 store.mutate(mutation({messageId:'67890',operation:'delete'}));const late=store.ingest(normalizeProviderChatEnvelope({...envelope,messageId:'67890'}));assert.equal(late.record.rich.deleted,true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});
test('gateway corrections retry after restart without invoking command consumers or provider senders',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-correction-retry-')),path=join(dir,'gateway.sqlite');let store=new SqliteChatGatewayStore(path),commands=0,sends=0,deliveries=0;
 try{const consumer={id:'commands',accepts:()=>true,deliver(){commands++}},sender={provider:'discord',send(){sends++;return {providerMessageId:'out'}}};let runtime=new ChatGatewayRuntime(store,[consumer],[sender],[],async()=>{throw Error('temporarily unavailable')});await runtime.ingest(envelope);assert.equal((await runtime.mutate(mutation({text:'!award 500'}))).failed,1);store.close();store=new SqliteChatGatewayStore(path);runtime=new ChatGatewayRuntime(store,[consumer],[sender],[],async()=>{deliveries++});assert.equal((await runtime.flushMutations()).delivered,1);await runtime.mutate(mutation({text:'!award 500'}));assert.equal(deliveries,1);assert.equal(commands,1);assert.equal(sends,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});
test('authenticated correction API revises featured chat and rejects human or cross-tenant mutations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-correction-api-')),credential='gateway-correction-credential-at-least-32-characters',service=createSpmtService({databasePath:join(dir,'spmt.sqlite'),webhookKey:Buffer.alloc(32,8),host:'127.0.0.1',port:0,chatGatewayEnabled:true,chatGatewayCredential:credential});let store;
 try{service.authority.ensureUser('owner');service.control.registerTenant({tenantId:'a',ownerUserId:'owner',displayName:'A'});service.authority.getOrCreateWorkspace('a');service.control.registerApp(chatGatewayCatalogRegistration('https://gateway.example'));service.control.installApp('a','chat-gateway');await service.listen();const baseUrl='http://127.0.0.1:'+service.server.address().port,client=new SpmtClient({baseUrl,appId:'chat-gateway',getAccessToken:()=>service.auth.issueServiceAccess('chat-gateway',credential).accessToken}),human=new SpmtClient({baseUrl,appId:'spacemountain',getAccessToken:()=>service.auth.issueHumanSession({userId:'owner',scopes:['commlink:read','commlink:write','commlink:live:write'],tenantIds:['a']}).accessToken});
 store=new SqliteChatGatewayStore(join(dir,'gateway.sqlite'));const gateway=new ChatGatewayRuntime(store,[createSpmtCommlinkLiveChatConsumer(client)],[],[],m=>client.mutateCommlinkLiveChat(m.tenantId,m));assert.equal((await gateway.ingest(envelope)).delivery.delivered,1);
 const desk=()=>human.request('/v1/commlink/operator',{tenantId:'a'}),before=await desk();await human.request('/v1/commlink/operator',{tenantId:'a',method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'feature',eventId:before.messages[0].id,revision:before.state.revision})});
 assert.equal((await gateway.mutate(mutation())).delivered,1);let state=(await desk()).state;assert.equal(state.snapshots[state.featured].text,'Edited');await assert.rejects(()=>human.mutateCommlinkLiveChat('a',mutation()),e=>e.status===403);await assert.rejects(()=>client.mutateCommlinkLiveChat('a',mutation({tenantId:'b'})),e=>e.status===403);
 await gateway.mutate(mutation({operation:'delete'}));state=(await desk()).state;assert.equal(state.featured,null);assert.deepEqual(state.queue,[]);const history=await human.listCommlinkLiveChat('a');assert.equal(history[0].rich.deleted,true);
 }finally{store?.close();await service.close();rmSync(dir,{recursive:true,force:true})}
});
