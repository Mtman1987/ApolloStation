import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { createSpmtOutputGateway } from "../apps/spmt-service/dist/output-gateway.js";
import { streamweaverCatalogRegistration,streamWeaverWidgetSnapshot,streamWeaverWidgetManifests,renderStreamWeaverWidget,STREAMWEAVER_WIDGET_CLIENT,STREAMWEAVER_WIDGET_CSP } from "../apps/streamweaver/dist/index.js";

test("widget projection preserves visible data and excludes credentials, untrusted sources and other widget data",()=>{
  const now=new Date().toISOString(),events=[
    {id:"social",sourceAppId:"streamweaver",type:"streamweaver.social.interaction.v1",createdAt:now,payload:{trigger:"!boop",actor:{displayName:"Captain"},target:{username:"Friend"},token:"never-public"}},
    {id:"avatar",sourceAppId:"streamweaver",type:"streamweaver.avatar.updated.v1",createdAt:now,payload:{avatarUrl:"https://assets.test/idle.png",talkingUrl:"javascript:alert(1)",secret:"never-public"}},
    {id:"fake",sourceAppId:"other",type:"streamweaver.social.interaction.v1",createdAt:now,payload:{trigger:"!boop",actor:{displayName:"Imposter"}}},
    {id:"tts",sourceAppId:"streamweaver",type:"streamweaver.media.playback.v1",createdAt:now,payload:{kind:"tts-player",mediaUrl:"https://assets.test/speech.wav",text:"Voice result"}},
  ];
  const all=streamWeaverWidgetSnapshot(events,now);assert.equal(all.items.length,3);assert.equal(all.items[0].text,"Captain boops Friend!");assert.doesNotMatch(JSON.stringify(all),/never-public|javascript|Imposter/);
  const social=streamWeaverWidgetSnapshot(events,now,"social");assert.equal(social.items.length,1);assert.doesNotMatch(JSON.stringify(social),/Voice result|idle.png/);
  const voice=streamWeaverWidgetSnapshot(events,now,"tts-player");assert.deepEqual(voice.items.map(x=>x.kind),["avatar","tts-player"]);
  assert.doesNotThrow(()=>new Function(STREAMWEAVER_WIDGET_CLIENT));assert.ok(STREAMWEAVER_WIDGET_CSP.includes(createHash("sha256").update(STREAMWEAVER_WIDGET_CLIENT).digest("base64")));
  assert.match(renderStreamWeaverWidget("auto",true),/data-simulation="true"/);
});

test("registered StreamWeaver widgets render and poll through real opaque grants and revoke immediately",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sw-output-http-"));
  const service=createSpmtService({databasePath:join(dir,"authority.sqlite"),webhookKey:Buffer.alloc(32,3),host:"127.0.0.1",port:0});
  const gateway=createSpmtOutputGateway(service,{host:"127.0.0.1",port:0,fetchImpl:async()=>{throw new Error("Built-in widgets must not fetch an arbitrary renderer or credential");}});
  try{
    service.authority.ensureUser("owner");service.control.registerTenant({tenantId:"a",ownerUserId:"owner",displayName:"A"});
    service.control.registerApp(streamweaverCatalogRegistration("https://station.test/apps/streamweaver"));service.control.installApp("a","streamweaver");
    for(const manifest of streamWeaverWidgetManifests("https://station.test"))service.control.registerOverlayWidget({tenantId:"a",manifest});
    service.authority.publishEvent({tenantId:"a",sourceAppId:"streamweaver",type:"streamweaver.social.interaction.v1",payload:{trigger:"!boop",actor:{displayName:"Captain"}},idempotencyKey:"boop"});
    service.authority.publishEvent({tenantId:"b",sourceAppId:"streamweaver",type:"streamweaver.social.interaction.v1",payload:{trigger:"!boop",actor:{displayName:"Other tenant"}},idempotencyKey:"other"});
    const grant=service.control.issueOverlayOutputGrant({tenantId:"a",appId:"streamweaver",widgetId:"social",createdByUserId:"owner"});
    await gateway.listen();const base=`http://127.0.0.1:${gateway.server.address().port}`,path=new URL(grant.browserSourceUrl).pathname;
    const page=await fetch(base+path);assert.equal(page.status,200);assert.match(await page.text(),/data-widget="social"/);
    const data=await (await fetch(base+path,{headers:{accept:"application/json"}})).json();assert.equal(data.items[0].text,"Captain boops chat!");assert.doesNotMatch(JSON.stringify(data),/Other tenant/);
    service.control.revokeOverlayOutputGrant({tenantId:"a",grantId:grant.grant.grantId,revokedByUserId:"owner"});
    assert.equal((await fetch(base+path,{headers:{accept:"application/json"}})).status,404);
  }finally{await gateway.close();rmSync(dir,{recursive:true,force:true});}
});
