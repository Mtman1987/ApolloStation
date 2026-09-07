import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSpmtServiceWithProviderIdentity} from '../apps/spmt-service/dist/provider-identity-host.js';
import {createSpaceMountainWebHost} from '../apps/spacemountain-web/dist/server.js';
import {streamweaverCatalogRegistration} from '../apps/streamweaver/dist/index.js';
import {chatGatewayCatalogRegistration} from '../apps/chat-gateway/dist/index.js';
import {SupervisedChatGatewayService} from '../apps/chat-gateway/dist/service.js';
import {parseTwitchBotRoles} from '../apps/spmt-service/dist/twitch-bot-api.js';
const ROOT='/v1/identity/twitch-bots';
async function fixture(run){const dir=mkdtempSync(join(tmpdir(),'twitch-bot-'));let identity={user_id:'200',login:'testbot',client_id:'twitch-client',scopes:['chat:read','chat:edit'],expires_in:3600},onLookup;const calls=[];
 const roles=[{roleId:'the-count',tenantId:'a',ownerUserId:'owner',providerUserId:'999',login:'thecountspmt'}];
 const service=createSpmtServiceWithProviderIdentity({databasePath:join(dir,'spmt.sqlite'),webhookKey:Buffer.alloc(32,3),providerCredentialKey:Buffer.alloc(32,4),host:'127.0.0.1',port:0,publicBaseUrl:'https://spmt.test',providerOAuthClients:{twitch:{clientId:'twitch-client',clientSecret:'twitch-secret'}},twitchBotRoles:roles,fetchImpl:async(url,init)=>{calls.push(String(url));assert.equal(init.redirect,'error');if(String(url).endsWith('/token'))return Response.json({access_token:'bot-access-for-tests-only',refresh_token:'bot-refresh-for-tests-only',expires_in:3600});if(String(url).endsWith('/validate'))return Response.json(identity);if(onLookup)onLookup();return Response.json({data:[{id:'100',login:'broadcaster'}]});}});
 let web;try{service.control.registerApp(streamweaverCatalogRegistration('https://sw.example'));service.control.registerApp(chatGatewayCatalogRegistration('https://chat.example'));for(const id of ['owner','viewer','other'])service.authority.ensureUser(id);for(const [tenantId,ownerUserId]of [['a','owner'],['b','other']]){service.control.registerTenant({tenantId,ownerUserId,displayName:tenantId});service.authority.getOrCreateWorkspace(tenantId);service.control.installApp(tenantId,'streamweaver');service.control.installApp(tenantId,'chat-gateway')}service.authority.linkProvider('owner','twitch','100');await service.listen();const base='http://127.0.0.1:'+service.server.address().port;web=createSpaceMountainWebHost({spmtOrigin:base,host:'127.0.0.1',port:0});await web.listen();const browser='http://127.0.0.1:'+web.server.address().port;
 const sessions=Object.fromEntries(['owner','viewer','other'].map(user=>[user,'spmt_token='+encodeURIComponent(service.auth.issueHumanSession({userId:user,scopes:['identity:read','identity:write'],tenantIds:['a','b']}).accessToken)]));
 const begin=async(user='owner',params={})=>{const q=new URLSearchParams({tenantId:'a',broadcasterId:'100',login:'testbot',...params});const response=await fetch(browser+ROOT+'/start?'+q,{headers:{cookie:sessions[user]},redirect:'manual'});if(response.status!==302)return {response};const target=new URL(response.headers.get('location'));return {response,target,state:target.searchParams.get('state'),cookie:response.headers.get('set-cookie').split(';')[0]}};
 const callback=(pending,user='owner',state=pending.state)=>fetch(browser+ROOT+'/callback?state='+state+'&code=verified-code',{headers:{cookie:sessions[user]+'; '+pending.cookie},redirect:'manual'});
 const disconnect=(user='owner',origin=browser)=>fetch(browser+ROOT+'?tenantId=a',{method:'POST',headers:{cookie:sessions[user],origin,'content-type':'application/json'},body:JSON.stringify({action:'disconnect',broadcasterId:'100'})});
 const gatewayCredential='gateway-credential-for-tests-at-least-32';service.auth.registerServiceIdentity({serviceId:'chat-gateway',credential:gatewayCredential,scopes:['providers:grant'],tenantMode:'any'});const token=service.auth.issueServiceAccess('chat-gateway',gatewayCredential).accessToken;
 const discover=()=>fetch(base+'/v1/chat/twitch-bot-connections',{headers:{authorization:'Bearer '+token}}).then(r=>r.json());
 await run({service,dir,base,browser,sessions,begin,callback,disconnect,discover,calls,gatewayCredential,setIdentity:v=>identity={...identity,...v},onLookup:fn=>onLookup=fn});
 }finally{if(web)await web.close();await service.close();rmSync(dir,{recursive:true,force:true})}}
const result=r=>new URL(r.headers.get('location')).searchParams;
test('Twitch bot consent binds owner, cookie, expected account and one-time state',async()=>fixture(async f=>{
 assert.equal((await f.begin('viewer')).response.status,403);assert.equal((await f.begin('other')).response.status,403);assert.equal((await f.begin('owner',{broadcasterId:'unknown'})).response.status,403);
 const p=await f.begin();assert.equal(p.target.origin,'https://id.twitch.tv');assert.equal(p.target.searchParams.get('force_verify'),'true');assert.equal(p.target.searchParams.get('scope'),'chat:read chat:edit');assert.equal(p.target.searchParams.get('redirect_uri'),'https://spmt.test'+ROOT+'/callback');
 assert.ok(result(await f.callback(p,'viewer')).get('botError'));assert.ok(result(await f.callback(p,'owner','wrong')).get('botError'));assert.equal(f.calls.length,0);
 assert.equal(result(await f.callback(p)).get('botConnected'),'1');assert.match(result(await f.callback(p)).get('botError'),/expired/);assert.equal(f.calls.length,3);
 const c=f.service.providerCredentials.get('a','twitch','200');assert.deepEqual(c.allowedCapabilities,['provider-chat']);assert.deepEqual(c.allowedAppIds,['chat-gateway']);assert.doesNotMatch(JSON.stringify(c),/bot-access-for-tests|bot-refresh-for-tests/);assert.equal(f.service.authority.listProviderLinks('owner').length,1,'bot account must not become a human identity');
 const list=await fetch(f.browser+ROOT+'?tenantId=a',{headers:{cookie:f.sessions.owner}}).then(r=>r.json());assert.equal(list.connections[0].login,'testbot');assert.equal(list.roles[0].roleId,'the-count');assert.equal((await f.discover()).connections[0].desired,true);
 assert.equal((await fetch(f.base+'/v1/chat/twitch-bot-connections',{headers:{cookie:f.sessions.owner}})).status,403);assert.equal((await f.disconnect('viewer')).status,403);assert.equal((await f.disconnect('owner','https://other.example')).status,403);
 assert.equal((await f.disconnect()).status,200);assert.equal((await f.discover()).connections[0].desired,false);assert.equal(f.service.providerCredentials.get('a','twitch','200').state,'revoked');
}));
test('reserved Count identity cannot be authorized or replaced through an ordinary role',async()=>fixture(async f=>{
 assert.equal((await f.begin('owner',{login:'TheCountSPMT'})).response.status,403);assert.equal((await f.begin('other',{tenantId:'b',role:'the-count'})).response.status,403);
 let p=await f.begin('owner',{role:'the-count'});f.setIdentity({user_id:'998',login:'thecountspmt'});assert.match(result(await f.callback(p)).get('botError'),/selected bot/);assert.equal(f.service.providerCredentials.get('a','twitch','998'),undefined);
 p=await f.begin('owner',{role:'the-count'});f.setIdentity({user_id:'999'});assert.equal(result(await f.callback(p)).get('botConnected'),'1');assert.equal(f.service.providerCredentials.get('a','twitch','999').metadata.identityPinned,'true');
 p=await f.begin();f.setIdentity({user_id:'999',login:'testbot'});assert.match(result(await f.callback(p)).get('botError'),/reserved/);assert.equal(f.service.providerCredentials.get('a','twitch','999').metadata.username,'thecountspmt');
}));
test('Twitch callback rejects wrong client, missing scope and revoked workspace access',async()=>fixture(async f=>{
 let p=await f.begin();f.setIdentity({client_id:'foreign-client'});assert.match(result(await f.callback(p)).get('botError'),/no longer valid/);
 p=await f.begin();f.setIdentity({client_id:'twitch-client',scopes:['chat:read']});assert.match(result(await f.callback(p)).get('botError'),/no longer valid/);
 p=await f.begin();f.setIdentity({scopes:['chat:read','chat:edit']});f.onLookup(()=>f.service.control.disableApp('a','streamweaver'));assert.match(result(await f.callback(p)).get('botError'),/authorization changed/);assert.equal(f.service.providerCredentials.get('a','twitch','200'),undefined);
}));
test('gateway uses discovered bot, replaces its sender and stops after disconnect',async()=>fixture(async f=>{
 assert.equal(result(await f.callback(await f.begin())).get('botConnected'),'1');
 const options={runtimeMode:'production',operationMode:'active',liveIngressEnabled:false,spmtOrigin:f.base,databasePath:join(f.dir,'gateway.sqlite'),credential:f.gatewayCredential,workerId:'bot-test',connections:[],reconcileMs:1000};const gateway=new SupervisedChatGatewayService(options);const opened=[],closed=[];
 gateway.supervisor.drivers.set('twitch',{provider:'twitch',async open(input){opened.push(input.connection.providerAccountId);assert.equal(input.grantMetadata.username,opened.length===1?'testbot':'secondbot');return {close(){closed.push(input.connection.providerAccountId)}}}});
 try{await gateway.reconcile();assert.deepEqual(opened,['200']);assert.equal(options.connections.find(c=>c.desired).providerAccountId,'200');await gateway.reconcile();assert.equal(opened.length,1);
 f.setIdentity({user_id:'201',login:'secondbot'});assert.equal(result(await f.callback(await f.begin('owner',{login:'secondbot'}))).get('botConnected'),'1');gateway.lastTwitchBotSync=0;await gateway.reconcile();assert.deepEqual(opened,['200','201']);assert.deepEqual(closed,['200']);assert.equal(options.connections.find(c=>c.desired).providerAccountId,'201');assert.equal(f.service.providerCredentials.get('a','twitch','200').state,'revoked');
 await f.disconnect();gateway.lastTwitchBotSync=0;await gateway.reconcile();assert.deepEqual(closed,['200','201']);assert.equal(options.connections.filter(c=>c.desired).length,0);
 }finally{await gateway.close()}
}));
test('pinned bot deployment roles validate identities and uniqueness',()=>{
 assert.throws(()=>parseTwitchBotRoles('[{"roleId":"the-count","tenantId":"a","ownerUserId":"o","providerUserId":"999","login":"wrong"}]'),/The Count/);assert.deepEqual(parseTwitchBotRoles(undefined),[]);
});

test('broadcaster consent provides command grants without replacing its chat bot',async()=>fixture(async f=>{
 const {STREAMWEAVER_TWITCH_COMMAND_SCOPES}=await import('../apps/streamweaver/dist/index.js');
 assert.equal(result(await f.callback(await f.begin())).get('botConnected'),'1');
 const p=await f.begin('owner',{role:'broadcaster',login:''});assert.ok(p.target.searchParams.get('scope').includes('channel:manage:redemptions'));
 f.setIdentity({user_id:'100',login:'broadcaster',scopes:[...new Set(Object.values(STREAMWEAVER_TWITCH_COMMAND_SCOPES).flat())]});assert.equal(result(await f.callback(p)).get('botConnected'),'1');
 const stored=f.service.providerCredentials.get('a','twitch','100');assert.ok(stored.allowedCapabilities.includes('rewards:manage'));assert.ok(!stored.allowedCapabilities.includes('provider-chat'));
 const {SpmtClient}=await import('../packages/sdk/dist/index.js');const token=f.service.auth.issueServiceAccess('chat-gateway',f.gatewayCredential).accessToken,client=new SpmtClient({baseUrl:f.base,appId:'chat-gateway',getAccessToken:()=>token});
 const grant=await client.issueProviderGrant('a','twitch','100','rewards:manage',['channel:manage:redemptions'],300);assert.equal(grant.credential.accessToken,'bot-access-for-tests-only');assert.doesNotMatch(JSON.stringify(grant),/bot-refresh/);
 const fleet=await fetch(f.browser+ROOT+'?tenantId=a',{headers:{cookie:f.sessions.owner}}).then(r=>r.json());assert.equal(fleet.connections[0].botId,'200');assert.equal(fleet.broadcasters[0].providerUserId,'100');
 const response=await fetch(f.browser+ROOT+'?tenantId=a',{method:'POST',headers:{cookie:f.sessions.owner,origin:f.browser,'content-type':'application/json'},body:JSON.stringify({action:'disconnect',role:'broadcaster',broadcasterId:'100'})});assert.equal(response.status,200);assert.equal(f.service.providerCredentials.get('a','twitch','100').state,'revoked');assert.equal(f.service.providerCredentials.get('a','twitch','200').state,'ready');
}));
