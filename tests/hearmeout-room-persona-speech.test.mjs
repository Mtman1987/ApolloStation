import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HearMeOutRoomPersonaSpeech,decodePersonaSpeech} from '../apps/hearmeout/dist/room-persona-speech.js';
import {HttpHearMeOutPersonaPublisher} from '../apps/hearmeout/dist/legacy-worker-adapter.js';
import {hearMeOutProviderRoomName} from '../apps/hearmeout/dist/room-identity.js';

const scope={tenantId:'tenant',roomId:'room'},other={tenantId:'tenant',roomId:'private'};
const persona={personaId:'luna',displayName:'Luna',voice:'voice',idleAvatarUrl:'https://example.org/idle.png',talkingAvatarUrl:'https://example.org/talking.png'};
function fixture(path=':memory:') {
 let now=100000,enabled=false,online=false,exists=true,people=[persona],joins=0,leaves=0,speeches=0,joinHook=async()=>{};
 const calls=[];
 const options={rooms:()=>[scope,other],personas:s=>s.roomId===scope.roomId?people:[persona],exists:s=>s.roomId===scope.roomId?exists:true,bridgeEnabled:s=>s.roomId===scope.roomId&&enabled,bridgeStatus:async()=>online,now:()=>now,decode:async bytes=>({audio:bytes,duration:10}),publisher:{async join(s,p){joins++;calls.push(['join',s,p]);await joinHook()},async leave(s,id){leaves++;calls.push(['leave',s,id])},async speak(s,id,audio){speeches++;calls.push(['speak',s,id,audio])}}};
 const controller=new HearMeOutRoomPersonaSpeech(path,options);
 return {controller,options,calls,get joins(){return joins},get leaves(){return leaves},get speeches(){return speeches},set bridge(v){enabled=v},set online(v){online=v},set people(v){people=v},set exists(v){exists=v},set joinHook(v){joinHook=v},advance(ms){now+=ms},publish:(id='reply',s=scope)=>controller.publish(s,id,'luna',async()=>Buffer.from('audio'))};
}

test('one private synthesized clip reaches room browsers without any persona LiveKit joins',async()=>{
 const f=fixture();try{
  let loads=0;await Promise.all(Array.from({length:5},()=>f.controller.publish(scope,'retry','luna',async()=>{loads++;await Promise.resolve();return Buffer.from('audio')})));
  await f.controller.reconcile();const state=f.controller.state(scope);assert.equal(loads,1);assert.equal(f.joins,0);assert.equal(f.speeches,0);assert.equal(state.playback.route,'browser');assert.equal(state.personas[0].talkingAvatarUrl,persona.talkingAvatarUrl);
  assert.equal(f.controller.audio(scope,state.playback.id).toString(),'audio');assert.throws(()=>f.controller.audio(other,state.playback.id),/not found/);assert.throws(()=>f.controller.audio({...scope,tenantId:'other'},state.playback.id),/not found/);assert.equal(f.controller.state(other).playback,null);
  f.bridge=true;await f.controller.reconcile();assert.equal(f.joins,0,'configured but not running is not an open bridge');
 }finally{await f.controller.close()}
});

test('only an open bridge joins personas; native speech is sent once and close continues the same clip in browsers',async()=>{
 const f=fixture();try{
  f.bridge=true;f.online=true;await f.controller.reconcile();await f.controller.reconcile();assert.equal(f.joins,1);
  await f.publish();await f.publish();const clip=f.controller.state(scope).playback;assert.equal(clip.route,'livekit');assert.equal(f.speeches,1);assert.equal(f.calls[0][1].roomId,'room');
  await f.publish('other-reply',other);assert.equal(f.controller.state(other).playback.route,'browser');assert.equal(f.joins,1);
  f.advance(1500);f.bridge=false;await f.controller.reconcile();const fallback=f.controller.state(scope).playback;assert.equal(f.leaves,1);assert.equal(fallback.route,'browser');assert.equal(fallback.id,clip.id);assert.equal(fallback.startedAt,clip.startedAt);assert.equal(f.speeches,1);
 }finally{await f.controller.close()}
});

test('closing a bridge while join is pending removes the late publisher',async()=>{
 const f=fixture();let release,started;const joined=new Promise(r=>started=r);f.joinHook=()=>{started();return new Promise(r=>release=r)};
 try{f.bridge=true;f.online=true;const pending=f.controller.reconcile();await joined;f.bridge=false;release();await pending;assert.equal(f.leaves,1);await f.publish();assert.equal(f.controller.state(scope).playback.route,'browser')}finally{await f.controller.close()}
});

test('removed personas cannot finish pending synthesis; deleted rooms lose audio',async()=>{
 const f=fixture();let release;try{
  const pending=f.controller.publish(scope,'pending','luna',()=>new Promise(r=>release=r));f.people=[];release(Buffer.from('audio'));await assert.rejects(pending,/no longer/);
  f.people=[persona];await f.publish();const id=f.controller.state(scope).playback.id;f.exists=false;await f.controller.reconcile();assert.equal(f.controller.state(scope).playback,null);assert.throws(()=>f.controller.audio(scope,id),/not found/);
 }finally{await f.controller.close()}
});

test('restarting never replays spoken clips and cleans up previously joined publishers',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hmo-persona-'));let f,g;
 try{f=fixture(join(dir,'speech.sqlite'));f.bridge=true;f.online=true;await f.controller.reconcile();await f.publish();const clip=f.controller.state(scope).playback;f.options.publisher.leave=async()=>{throw Error('offline')};await f.controller.close();f=null;
  g=fixture(join(dir,'speech.sqlite'));assert.equal(g.controller.state(scope).playback,null);await g.controller.reconcile();assert.equal(g.leaves,1);await g.publish();assert.equal(g.controller.state(scope).playback,null);assert.throws(()=>g.controller.audio(scope,clip.id),/not found/);
 }finally{await f?.controller.close();await g?.controller.close();rmSync(dir,{recursive:true,force:true})}
});

test('persona adapter uses scoped worker rooms, published avatars and one non-retried speech POST',async()=>{
 const calls=[],publisher=new HttpHearMeOutPersonaPublisher({workerOrigin:'https://worker.example',getAuthorization:()=> 'Bearer fixture-authorization-long',allowedTenantIds:['tenant'],fetchImpl:async(url,init)=>{calls.push({url:String(url),init,body:JSON.parse(init.body)});return Response.json({success:true,transportHealthy:true})}});
 await publisher.join(scope,persona);await publisher.speak(scope,'luna',Buffer.from('audio'),2);await publisher.leave(scope,'luna');assert.equal(calls.length,3);assert.equal(calls[0].body.roomId,hearMeOutProviderRoomName('tenant','room'));assert.equal(calls[0].body.talkingAvatar,persona.talkingAvatarUrl);assert.equal(calls[0].body.serviceSession,true);assert.equal(calls[1].body.audioDataUri,'data:audio/wav;base64,YXVkaW8=');assert.equal(calls[1].init.redirect,'manual');await assert.rejects(()=>publisher.join({...scope,tenantId:'foreign'},persona),/not enabled/);assert.equal(calls.length,3);
 let attempts=0;const failing=new HttpHearMeOutPersonaPublisher({workerOrigin:'https://worker.example',getAuthorization:()=> 'Bearer fixture-authorization-long',fetchImpl:async()=>{attempts++;throw Error('uncertain')}});await assert.rejects(()=>failing.speak(scope,'luna',Buffer.from('audio'),2));assert.equal(attempts,1);
});

test('real speech decoder produces bounded browser WAV and rejects arbitrary input',async()=>{
 const input=Buffer.alloc(44+48000);input.write('RIFF');input.writeUInt32LE(input.length-8,4);input.write('WAVEfmt ',8);input.writeUInt32LE(16,16);input.writeUInt16LE(1,20);input.writeUInt16LE(1,22);input.writeUInt32LE(24000,24);input.writeUInt32LE(48000,28);input.writeUInt16LE(2,32);input.writeUInt16LE(16,34);input.write('data',36);input.writeUInt32LE(48000,40);
 const result=await decodePersonaSpeech(input);assert.equal(result.duration,1);assert.equal(result.audio.subarray(0,4).toString(),'RIFF');assert.equal(result.audio.length,input.length);await assert.rejects(()=>decodePersonaSpeech(Buffer.from('not audio')),/could not be decoded/);
});
