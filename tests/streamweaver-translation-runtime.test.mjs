import test from "node:test";
import assert from "node:assert/strict";
import {
  SqliteStreamWeaverTranslationStore,
  StreamWeaverTranslationRuntime,
  STREAMWEAVER_TRANSLATION_SUBTITLE,
  streamWeaverWidgetSnapshot,
  renderStreamWeaverWidget,
} from "../apps/streamweaver/dist/index.js";

function invocation(args,overrides={}){
  return {
    tenantId:"tenant",deliveryId:"delivery-"+args.join("-"),command:{donorId:"translate",trigger:"!t",family:"community",cooldownSeconds:0},
    canonicalTrigger:"!t",args,rawText:"!t "+args.join(" "),
    actor:{userId:"owner",providerUserId:"owner-p",username:"owner",displayName:"Owner",isModerator:true,isBroadcaster:true},
    provider:"twitch",connectionId:"conn",channelId:"channel",...overrides,
  };
}
function chat(overrides={}){
  return {
    schemaVersion:1,tenantId:"tenant",provider:"twitch",connectionId:"conn",channelId:"channel",messageId:"msg-1",
    text:"hola a todos",occurredAt:"2026-09-25T13:00:00.000Z",
    actor:{providerUserId:"viewer-p",username:"viewer",displayName:"Viewer",isBot:false,roles:[]},mentions:[],...overrides,
  };
}

test("!t supports one-shot target languages plus persistent per-user auto-translation",async()=>{
  const store=new SqliteStreamWeaverTranslationStore(":memory:",()=> "2026-09-25T13:00:00.000Z");
  const jobs=new Map(),calls=[],sent=[],events=[];
  const client={
    async invokeCommunityAssistant(tenantId,input,key){
      calls.push({tenantId,input,key});const id="job-"+calls.length;
      jobs.set(id,{id,tenantId,billedUserId:input.userId,ownerAppId:"stellar-core",input:{conversationId:input.conversationId},state:"succeeded",result:{text:calls.length===1?"hola mundo":"hello everyone"}});
      return{status:"accepted",jobId:id};
    },
    async getExecutionJob(_tenant,id){return jobs.get(id)},
    async publishEvent(tenantId,type,payload,key){events.push({tenantId,type,payload,key});return{id:"event-"+events.length}},
  };
  const runtime=new StreamWeaverTranslationRuntime(store,client,{send:async message=>{sent.push(message);return{providerMessageId:"sent"}}},()=> "owner");
  try{
    const one=await runtime.command(invocation(["es","hello","world"]));
    assert.equal(one,"hola mundo");
    assert.match(calls[0].input.message,/Spanish \(es\)/);
    assert.equal(calls[0].input.remember,false);
    assert.equal(calls[0].input.presentation.memoryPolicy,"off");

    const enabled=await runtime.command(invocation(["@viewer","en"],{target:{providerUserId:"viewer-p",username:"viewer"}}));
    assert.match(enabled,/auto-translate @viewer into English/);
    assert.equal(store.preference("tenant","twitch","viewer-p").targetLanguage,"en");

    assert.equal(runtime.observe(chat()),true);
    let result=await runtime.reconcile();assert.equal(result.published,1);
    assert.match(sent[0].text,/🌐 @Viewer → EN: hello everyone/);
    assert.equal(events[0].type,STREAMWEAVER_TRANSLATION_SUBTITLE);
    assert.equal(events[0].payload.sourceText,"hola a todos");
    assert.equal(events[0].payload.translatedText,"hello everyone");

    const disabled=await runtime.command(invocation(["@viewer","off"],{target:{providerUserId:"viewer-p",username:"viewer"}}));
    assert.match(disabled,/off for @viewer/);
    assert.equal(store.preference("tenant","twitch","viewer-p"),undefined);
  }finally{store.close();}
});

test("viewers cannot set another person's translation preference, but can set themselves",async()=>{
  const store=new SqliteStreamWeaverTranslationStore(":memory:");
  const runtime=new StreamWeaverTranslationRuntime(store,{},{send:async()=>({})},()=> "owner");
  try{
    const actor={userId:"viewer-id",providerUserId:"viewer-p",username:"viewer",displayName:"Viewer",isModerator:false,isBroadcaster:false};
    await assert.rejects(()=>runtime.command(invocation(["@other","en"],{actor,target:{providerUserId:"other-p",username:"other"}})),/streamer or a moderator/);
    const result=await runtime.command(invocation(["@viewer","es"],{actor,target:{providerUserId:"viewer-p",username:"viewer"}}));
    assert.match(result,/Spanish/);
  }finally{store.close();}
});

test("auto-translation suppresses already-target-language messages and renders a safe subtitle widget",async()=>{
  const store=new SqliteStreamWeaverTranslationStore(":memory:");
  const jobs=new Map(),events=[],sent=[];
  const client={
    async invokeCommunityAssistant(tenantId,input){jobs.set("same",{tenantId,billedUserId:"owner",ownerAppId:"stellar-core",input:{conversationId:input.conversationId},state:"succeeded",result:{text:"[NO_TRANSLATION]"}});return{status:"accepted",jobId:"same"}},
    async getExecutionJob(){return jobs.get("same")},
    async publishEvent(...args){events.push(args);return{id:"event"}},
  };
  const runtime=new StreamWeaverTranslationRuntime(store,client,{send:async m=>{sent.push(m);return{}}},()=> "owner");
  try{
    store.setAuto({tenantId:"tenant",provider:"twitch",providerUserId:"viewer-p",username:"viewer",targetLanguage:"en"});
    runtime.observe(chat({text:"hello everyone"}));
    const result=await runtime.reconcile();
    assert.equal(result.skipped,1);assert.equal(sent.length,0);assert.equal(events.length,0);

    const now="2026-09-25T13:05:00.000Z",snapshot=streamWeaverWidgetSnapshot([{id:"tr",sourceAppId:"streamweaver",type:STREAMWEAVER_TRANSLATION_SUBTITLE,createdAt:now,payload:{displayName:"Viewer",sourceText:"hola",translatedText:"hello",targetLanguage:"en",durationMs:9000}}],now,"translation-subtitle");
    assert.equal(snapshot.items[0].text,"hello");assert.match(snapshot.items[0].actor,/@Viewer · EN · hola/);
    const html=renderStreamWeaverWidget("translation-subtitle");assert.match(html,/data-widget="translation-subtitle"/);assert.match(html,/place-items:end center/);
  }finally{store.close();}
});
