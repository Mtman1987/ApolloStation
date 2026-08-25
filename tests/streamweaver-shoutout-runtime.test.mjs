import assert from "node:assert/strict";
import test from "node:test";
import {
  SqliteStreamWeaverShoutoutStore,
  STREAMWEAVER_SHOUTOUT_ACTIONS,
  STREAMWEAVER_SHOUTOUT_AUDIT,
  STREAMWEAVER_SHOUTOUT_EFFECT_REQUESTED,
  StreamWeaverShoutoutRuntime,
  extractStreamWeaverShoutoutRequestTarget,
  matchStreamWeaverShoutoutTarget,
  resolveStreamWeaverShoutoutMode,
  scoreStreamWeaverShoutoutMatch,
} from "../apps/streamweaver/dist/index.js";

function fixture({ now = Date.parse("2026-08-25T05:00:00.000Z"), mode = "full", greeting, clips } = {}) {
  let clock = now;
  const store = new SqliteStreamWeaverShoutoutStore(":memory:", () => clock);
  const published = [];
  const effects = [];
  const users = new Map([
    ["nightmare89", { id:"tw-1", login:"nightmare89", displayName:"Nightmare", profileImageUrl:"https://static.twitchcdn.net/nightmare.png" }],
    ["spacecaptain", { id:"tw-2", login:"spacecaptain", displayName:"SpaceCaptain" }],
    ["nightbot", { id:"bot-1", login:"nightbot", displayName:"Nightbot" }],
  ]);
  const runtime = new StreamWeaverShoutoutRuntime({
    client:{ async publishEvent(tenantId,type,payload,idempotencyKey){ published.push({tenantId,type,payload,idempotencyKey}); return {id:`event-${published.length}`}; } },
    twitch:{ async lookupUser(_tenantId,login){ return users.get(login); } },
    store,
    chatters:{ list:()=>[
      {providerUserId:"tw-1",userLogin:"nightmare89",displayName:"Nightmare"},
      {providerUserId:"tw-2",userLogin:"spacecaptain",displayName:"SpaceCaptain"},
    ] },
    modes:{ get:()=>mode },
    greeting:greeting??{ generate:({user,shoutoutCount})=>shoutoutCount===0?`Fresh hello @${user.displayName}`:`Welcome back @${user.displayName}` },
    ...(clips?{clips}:{}),
    effects:{ async execute(input){ effects.push(input); } },
  });
  return {runtime,store,published,effects,setClock:(value)=>{clock=value;}};
}

test("frozen shoutout identities preserve voice, custom, configuration, and video action IDs",()=>{
  assert.deepEqual(STREAMWEAVER_SHOUTOUT_ACTIONS.map(action=>action.id),[
    "athena-shoutout","8a6e2cfb-a55b-424c-acdc-f775c74c4758","2936fced-41e5-4894-bd73-04f70a5d3ce2","01f58d95-8f37-4359-8943-ca41be5fe1ae",
  ]);
});

test("shoutout request extraction and donor local matcher preserve phrase and tie behavior",async()=>{
  assert.equal(extractStreamWeaverShoutoutRequestTarget("Athena, please shout out @Nightmare89"),"nightmare89");
  assert.equal(extractStreamWeaverShoutoutRequestTarget("could you give a shoutout to spacecaptain"),"spacecaptain");
  assert.equal(extractStreamWeaverShoutoutRequestTarget("random sentence"),undefined);
  assert.equal(scoreStreamWeaverShoutoutMatch("night","nightmare89"),750);
  assert.equal(await matchStreamWeaverShoutoutTarget({tenantId:"tenant-1",spokenName:"nightmare",candidates:["nightmare89","spacecaptain"]}),"nightmare89");
  assert.equal(await matchStreamWeaverShoutoutTarget({tenantId:"tenant-1",spokenName:"a",candidates:["ab","ac"]}),undefined);
});

test("shoutout mode keeps donor persisted and legacy mappings",()=>{
  assert.equal(resolveStreamWeaverShoutoutMode("full"),"full");
  assert.equal(resolveStreamWeaverShoutoutMode("overlay"),"overlay");
  assert.equal(resolveStreamWeaverShoutoutMode("chat"),"chat");
  assert.equal(resolveStreamWeaverShoutoutMode("on"),"full");
  assert.equal(resolveStreamWeaverShoutoutMode("off"),"chat");
  assert.equal(resolveStreamWeaverShoutoutMode(undefined,true),"chat");
});

test("automatic shoutout tracker is tenant isolated, known-bot aware, excluded-user aware, 12-hour cooldown, and replay safe",()=>{
  const fx=fixture();
  try{
    assert.equal(fx.store.eligibility("tenant-a","nightbot").reason,"known-bot");
    fx.store.setExcluded("tenant-a","spacecaptain",true);
    assert.equal(fx.store.eligibility("tenant-a","spacecaptain").reason,"excluded-user");
    const first=fx.store.record("tenant-a","nightmare89","operation-1");
    const replay=fx.store.record("tenant-a","nightmare89","operation-1");
    assert.equal(first.count,1); assert.equal(first.duplicate,false); assert.equal(replay.duplicate,true); assert.equal(replay.count,1);
    const blocked=fx.store.eligibility("tenant-a","nightmare89"); assert.equal(blocked.reason,"cooldown"); assert.equal(blocked.remainingMs,12*60*60*1000);
    assert.equal(fx.store.eligibility("tenant-b","nightmare89").eligible,true);
    fx.setClock(Date.parse("2026-08-25T17:00:00.001Z"));
    assert.equal(fx.store.eligibility("tenant-a","nightmare89").eligible,true);
  }finally{fx.store.close();}
});

test("Athena voice shoutout matches current chatters and preserves donor skip-cooldown behavior",async()=>{
  const fx=fixture({mode:"chat"});
  try{
    fx.store.record("tenant-1","nightmare89","prior-auto");
    const result=await fx.runtime.voice({tenantId:"tenant-1",invocationId:"voice-1",spokenName:"nightmare",channelId:"channel-1"});
    assert.equal(result.completed,true);
    assert.equal(result.matchedLogin,"nightmare89");
    assert.equal(result.mode,"chat");
    assert.deepEqual(result.effects,["chat-greeting","discord"]);
    assert.equal(fx.store.count("tenant-1","nightmare89"),1,"manual/voice skipCooldown must not increment donor auto-welcome tracker");
    assert.equal(fx.published.some(entry=>entry.type===STREAMWEAVER_SHOUTOUT_AUDIT&&entry.payload.donorActionId==="athena-shoutout"),true);
    assert.equal(fx.effects[0].payload.text,"Fresh hello @Nightmare | Go check out @Nightmare: https://twitch.tv/nightmare89");
  }finally{fx.store.close();}
});

test("full shoutout preserves link, optional clip, chat greeting, TTS, Discord phase ordering",async()=>{
  const fx=fixture({mode:"full",clips:{pick:()=>({url:"https://clips.twitch.tv/clip1",thumbnailUrl:"https://cdn.test/thumb.jpg",durationSeconds:9})}});
  try{
    const result=await fx.runtime.manual({tenantId:"tenant-1",invocationId:"manual-1",targetLogin:"nightmare89",skipCooldown:true});
    assert.equal(result.completed,true);
    assert.deepEqual(result.effects,["chat-link","clip","chat-greeting","tts","discord"]);
    assert.deepEqual(fx.effects.map(effect=>effect.effect),result.effects);
    assert.equal(fx.published.filter(entry=>entry.type===STREAMWEAVER_SHOUTOUT_EFFECT_REQUESTED).length,5);
  }finally{fx.store.close();}
});

test("overlay shoutout sends greeting to overlay instead of chat while retaining TTS and Discord",async()=>{
  const fx=fixture({mode:"overlay"});
  try{
    const result=await fx.runtime.manual({tenantId:"tenant-1",invocationId:"overlay-1",targetLogin:"spacecaptain",skipCooldown:true});
    assert.deepEqual(result.effects,["chat-link","overlay-greeting","tts","discord"]);
    assert.equal(result.effects.includes("chat-greeting"),false);
  }finally{fx.store.close();}
});

test("automatic shoutouts record cooldown only after successful completion",async()=>{
  const fx=fixture({mode:"chat"});
  try{
    const first=await fx.runtime.manual({tenantId:"tenant-1",invocationId:"auto-1",targetLogin:"nightmare89",source:"auto-welcome",skipCooldown:false});
    assert.equal(first.completed,true);
    assert.equal(fx.store.count("tenant-1","nightmare89"),1);
    const second=await fx.runtime.manual({tenantId:"tenant-1",invocationId:"auto-2",targetLogin:"nightmare89",source:"auto-welcome",skipCooldown:false});
    assert.equal(second.completed,false); assert.equal(second.skippedReason,"cooldown");
  }finally{fx.store.close();}
});

test("known bots and tenant exclusions still fail closed even for manual or voice cooldown bypass",async()=>{
  const fx=fixture();
  try{
    const bot=await fx.runtime.manual({tenantId:"tenant-1",invocationId:"bot-1",targetLogin:"nightbot",skipCooldown:true});
    assert.equal(bot.completed,false); assert.equal(bot.skippedReason,"known-bot");
    fx.store.setExcluded("tenant-1","spacecaptain",true);
    const excluded=await fx.runtime.manual({tenantId:"tenant-1",invocationId:"excluded-1",targetLogin:"spacecaptain",skipCooldown:true});
    assert.equal(excluded.completed,false); assert.equal(excluded.skippedReason,"excluded-user");
  }finally{fx.store.close();}
});
