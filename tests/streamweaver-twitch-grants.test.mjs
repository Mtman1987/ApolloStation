import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpmtStreamWeaverTwitchGrantSource, StreamWeaverProviderRuntime, StreamWeaverRuntimeSettingsStore, StreamWeaverFlowPackageStore } from "../apps/streamweaver/dist/index.js";
import { MemoryProviderCredentialSource, ProviderGrantBroker } from "../packages/provider-grants-core/dist/index.js";
import { SpmtApiError } from "../packages/sdk/dist/index.js";

test("Twitch commands request short-lived shared grants and never authorize captured writes", async () => {
  const requests=[];
  const broker={issueProviderGrant:async(...args)=>{requests.push(args);return{expiresAt:"2099-01-01T00:00:00Z",credential:{accessToken:"current-token",metadata:{clientId:"shared-client"}}};}};
  const readOnly=new SpmtStreamWeaverTwitchGrantSource(broker,()=>"100",false);
  assert.equal((await readOnly.getGrant({tenantId:"a",capability:"channel:manage"})).status,"unavailable");
  assert.equal(requests.length,0);
  const read=await readOnly.getGrant({tenantId:"a",capability:"followers:read"});
  assert.equal(read.broadcasterId,"100");assert.equal(read.moderatorId,"100");
  assert.deepEqual(requests[0],["a","twitch","100","followers:read",["moderator:read:followers"],300]);
  await readOnly.getGrant({tenantId:"a",capability:"users:read"});assert.deepEqual(requests[1][4],[]);
  assert.equal((await new SpmtStreamWeaverTwitchGrantSource(broker,()=>undefined,true).getGrant({tenantId:"a",capability:"channel:manage"})).status,"unavailable");
  const denied=new SpmtStreamWeaverTwitchGrantSource({issueProviderGrant:async()=>{throw new SpmtApiError(403,"denied");}},()=>"100",true);
  assert.equal((await denied.getGrant({tenantId:"a",capability:"channel:manage"})).status,"reauthorization-required");
});

test("scope-free provider reads still enforce the app, capability, tenant and identity grants",async()=>{
  const source=new MemoryProviderCredentialSource();
  source.put("a",{provider:"twitch",providerUserId:"100",accessToken:"shared-token",metadata:{},scopes:["chat:read"],expiresAt:"2099-01-01T00:00:00Z",allowedAppIds:["chat-gateway"],allowedCapabilities:["users:read"]});
  const broker=new ProviderGrantBroker(source);
  const request={schemaVersion:1,tenantId:"a",provider:"twitch",providerUserId:"100",requesterAppId:"chat-gateway",capabilityId:"users:read",requiredScopes:[]};
  assert.deepEqual((await broker.issue(request)).grantedScopes,[]);
  for(const patch of [{requesterAppId:"other"},{capabilityId:"channel:manage"},{tenantId:"b"},{providerUserId:"200"}])await assert.rejects(()=>broker.issue({...request,...patch}));
});

test("installed Twitch flows reach the selected broadcaster and record denied native actions as failures",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sw-twitch-runtime-")),path=join(dir,"runtime.sqlite"),requests=[],sent=[];
  const settings=new StreamWeaverRuntimeSettingsStore(path),flows=new StreamWeaverFlowPackageStore(path);
  settings.setTwitchBroadcaster("a","100");
  flows.install("a","mtman1987.followers");flows.install("a","mtman1987.settitle");
  const options={databasePath:path,allowAssistant:false,client:{request:async()=>{throw new Error("Unexpected identity lookup");}},egress:{send:async m=>{sent.push(m);return{providerMessageId:"output"};}},
    providerGrants:{issueProviderGrant:async(...args)=>{requests.push(args);return{expiresAt:"2099-01-01T00:00:00Z",credential:{accessToken:"secret-token",metadata:{clientId:"shared-client"}}};}},
    providerFetch:async(url,init)=>{assert.equal(new URL(url).searchParams.get("broadcaster_id"),"100");if(init.method==="PATCH"){assert.deepEqual(JSON.parse(init.body),{title:"New title"});return new Response(null,{status:204});}return Response.json({total:23});}};
  const delivery=(id,text)=>({schemaVersion:1,deliveryId:id,consumerId:"streamweaver.installed-flows",attempts:1,message:{schemaVersion:1,tenantId:"a",provider:"twitch",connectionId:"main",channelId:"captain",messageId:id,text,occurredAt:new Date().toISOString(),actor:{canonicalUserId:"captain",providerUserId:"100",username:"captain",isBot:false,roles:["broadcaster"]},mentions:[]}});
  let runtime=new StreamWeaverProviderRuntime(options);
  try{
    const consumer=runtime.consumers.find(c=>c.id==="streamweaver.installed-flows");
    await consumer.deliver(delivery("read","!followers"));assert.match(sent[0].text,/23 followers/);
    await assert.rejects(()=>consumer.deliver(delivery("denied","!settitle New title")),/does not allow live Twitch/);
    assert.equal(requests.length,1);assert.equal(flows.listRuns("a").find(r=>r.deliveryId==="denied").state,"failed");
    runtime.close();runtime=new StreamWeaverProviderRuntime({...options,allowProviderWrites:true});
    await runtime.consumers.find(c=>c.id==="streamweaver.installed-flows").deliver(delivery("write","!settitle New title"));
    assert.match(sent.at(-1).text,/Title updated: New title/);assert.equal(requests.at(-1)[3],"channel:manage");
  }finally{runtime.close();settings.close();flows.close();rmSync(dir,{recursive:true,force:true});}
});
