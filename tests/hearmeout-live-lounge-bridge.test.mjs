import test from 'node:test';
import assert from 'node:assert/strict';
import {HearMeOutLiveLoungeBridge,HEARMEOUT_LIVE_ORIGIN} from '../apps/hearmeout/dist/live-lounge-bridge.js';

test('live Lounge bridge reads the donor queue and keeps media URLs on live HearMeOut',async()=>{
 const calls=[];
 const bridge=new HearMeOutLiveLoungeBridge('Bearer 1234567890abcdef',HEARMEOUT_LIVE_ORIGIN,async(url,init)=>{
  calls.push({url:String(url),init});
  return Response.json({session:{id:'watch-room-system-spacemountainlive-lounge-music',queue:[{requestId:'two',item:{title:'Second',playbackUrl:'/api/watch/youtube/hls/bbbbbbbbbbb/index.m3u8'}}],current:{requestId:'one',item:{title:'First',playbackUrl:'/api/watch/youtube/hls/aaaaaaaaaaa/index.m3u8',metadata:{videoPlaybackUrl:'/api/watch/youtube/hls/aaaaaaaaaaa/index.m3u8'}}},playback:{status:'playing',position:12,updatedAt:99}}});
 });
 const state=await bridge.read();
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,HEARMEOUT_LIVE_ORIGIN+'/api/internal/lounge/media');
 assert.equal(calls[0].init.headers.authorization,'Bearer 1234567890abcdef');
 assert.equal(state.current.item.playbackUrl,HEARMEOUT_LIVE_ORIGIN+'/api/watch/youtube/hls/aaaaaaaaaaa/index.m3u8');
 assert.equal(state.queue[0].item.playbackUrl,HEARMEOUT_LIVE_ORIGIN+'/api/watch/youtube/hls/bbbbbbbbbbb/index.m3u8');
});

test('live Lounge controls preserve the expected request fence',async()=>{
 let body;
 const bridge=new HearMeOutLiveLoungeBridge('Bearer 1234567890abcdef',HEARMEOUT_LIVE_ORIGIN,async(_url,init)=>{
  body=JSON.parse(String(init.body));
  return Response.json({session:{id:'watch-room-system-spacemountainlive-lounge-music',queue:[],current:null,playback:{status:'idle',position:0,updatedAt:100}}});
 });
 await bridge.control('skip','request-one');
 assert.deepEqual(body,{action:'skip',expectedRequestId:'request-one'});
});
