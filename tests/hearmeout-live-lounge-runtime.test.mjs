import test from 'node:test';
import assert from 'node:assert/strict';
import {HearMeOutLiveLoungeRuntime} from '../apps/hearmeout/dist/live-lounge-runtime.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('live Lounge runtime exposes the donor queue as one broadcast session and advances donor on encoder completion',async()=>{
 let current='one',controls=[];
 const bridge={
  async read(){return session(current)},
  async control(action,expectedRequestId){controls.push({action,expectedRequestId});current='two';return session(current)}
 };
 const runtime=new HearMeOutLiveLoungeRuntime(bridge,'tenant');
 await runtime.listen();
 try{
  const sessions=runtime.broadcastSessions();
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].roomId,'system-spacemountainlive-lounge');
  assert.equal(sessions[0].lane,'movie');
  assert.equal(sessions[0].current.requestId,'one');
  assert.equal(sessions[0].current.item.playbackUrl,'https://hearmeout-main.fly.dev/api/watch/youtube/hls/aaaaaaaaaaa/index.m3u8');
  assert.equal(runtime.finishBroadcastRequest('tenant','system-spacemountainlive-lounge','movie','one'),true);
  await tick();await tick();
  assert.deepEqual(controls,[{action:'skip',expectedRequestId:'one'}]);
  assert.equal(runtime.getSession('tenant','system-spacemountainlive-lounge','movie').current.requestId,'two');
 }finally{runtime.close()}
});

function session(requestId){
 const videoId=requestId==='one'?'aaaaaaaaaaa':'bbbbbbbbbbb';
 return {
  id:'watch-room-system-spacemountainlive-lounge-music',
  queue:[],
  current:{requestId,requestedBy:{userId:'twitch:viewer',username:'Viewer'},addedAt:'2026-09-22T00:00:00.000Z',item:{id:'youtube-'+videoId,type:'music',title:requestId,source:'YouTube Music',runtime:'3m',playbackUrl:'https://hearmeout-main.fly.dev/api/watch/youtube/hls/'+videoId+'/index.m3u8',metadata:{videoId}}},
  playback:{status:'playing',position:12,updatedAt:Date.now()},
 };
}

test('Apollo environment cannot wire the retired Live HMO donor bridge',async()=>{
 const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../apps/hearmeout/src/web-server-v3.ts',import.meta.url),'utf8'));
 assert.doesNotMatch(source,/environment\.HEARMEOUT_SINGLE_BROADCAST===["']1["']&&bridgeAuthorization\?new HearMeOutLiveLoungeBridge/);
 assert.doesNotMatch(source,/liveLoungeBridge\?\{liveLoungeBridge\}/);
});

test('live Lounge keeps serving the last donor state through transient poll and control failures',async()=>{
 let reads=0,controls=0;
 const bridge={
  async read(){reads++;if(reads===1)return session('one');throw new DOMException('The operation was aborted due to timeout','TimeoutError')},
  async control(){controls++;throw new DOMException('The operation was aborted due to timeout','TimeoutError')},
 };
 const runtime=new HearMeOutLiveLoungeRuntime(bridge,'tenant');
 await runtime.listen();
 try{
  await new Promise(resolve=>setTimeout(resolve,850));
  assert.ok(reads>=2);
  assert.equal(runtime.getSession('tenant','system-spacemountainlive-lounge','movie').current.requestId,'one');
  assert.equal(runtime.finishBroadcastRequest('tenant','system-spacemountainlive-lounge','movie','one'),true);
  await tick();await tick();
  assert.equal(controls,1);
  assert.equal(runtime.getSession('tenant','system-spacemountainlive-lounge','movie').current.requestId,'one');
 }finally{runtime.close()}
});
