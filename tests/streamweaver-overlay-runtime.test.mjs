import assert from "node:assert/strict";
import test from "node:test";
import { STREAMWEAVER_OVERLAYS, normalizeStreamWeaverRealtimeEnvelope, normalizeStreamWeaverTtsPlayback, overlaysForStreamWeaverEvent, streamWeaverOverlayUrl } from "../apps/streamweaver/dist/index.js";

test("StreamWeaver preserves donor OBS overlay routes and sizes",()=>{
  assert.equal(STREAMWEAVER_OVERLAYS["tts-player"].path,"/tts-player");assert.equal(STREAMWEAVER_OVERLAYS["tts-player"].width,1920);assert.equal(STREAMWEAVER_OVERLAYS.leaderboard.width,400);assert.equal(STREAMWEAVER_OVERLAYS.avatar.height,300);
  assert.equal(Object.keys(STREAMWEAVER_OVERLAYS).length,12);
});

test("StreamWeaver overlay URLs are tenant scoped without credentials",()=>{
  const url=streamWeaverOverlayUrl("https://streamweaver.example/","pokemon-pack","tenant-a");assert.match(url,/pokemon-pack-overlay/);assert.match(url,/tenant=tenant-a/);assert.throws(()=>streamWeaverOverlayUrl("https://user:pass@example.com/","avatar","tenant-a"),/credential-free/);
});

test("StreamWeaver realtime events route only to overlays that consume them and strip secret-looking payload keys",()=>{
  assert.deepEqual(overlaysForStreamWeaverEvent("play-tts"),["tts-player"]);assert.deepEqual(overlaysForStreamWeaverEvent("pokemon-trade"),["pokemon-trade"]);
  const event=normalizeStreamWeaverRealtimeEnvelope({tenantId:"tenant-a",event:"play-tts",eventId:"evt-1",occurredAt:"2026-08-26T12:00:00Z",payload:{text:"hello",token:"secret",ready:true}});assert.equal(event.payload.text,"hello");assert.equal(event.payload.token,undefined);assert.equal(event.payload.ready,true);
  assert.throws(()=>normalizeStreamWeaverRealtimeEnvelope({tenantId:"tenant-a",event:"bad-event",eventId:"evt"}),/Unknown/);
});

test("StreamWeaver TTS playback keeps bounded provider-neutral audio and avatar metadata",()=>{
  const value=normalizeStreamWeaverTtsPlayback({text:"Hello chat",audioUrl:"https://cdn.example/voice.mp3",avatarUrl:"https://cdn.example/avatar.png",voice:"Annie",provider:"local",requestId:"tts-1"});assert.equal(value.provider,"local");assert.equal(value.voice,"Annie");assert.throws(()=>normalizeStreamWeaverTtsPlayback({...value,provider:"unknown"}),/Unsupported/);
});
