import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareHearMeOutYoutube} from '../apps/hearmeout/dist/youtube-browser.js';
import {HearMeOutPreparedMedia} from '../apps/hearmeout/dist/prepared-media.js';
import {SpmtHearMeOutSuiteMediaResolver} from '../apps/hearmeout/dist/suite-action-executor.js';
import {HearMeOutMovieProvider} from '../apps/hearmeout/dist/movie-provider.js';

const id='abcdefghijk', origin='https://hmo-dj-worker.fly.dev', authorization='Bearer existing-test-worker-credential';

test('browser downloads the actual video and audio bytes before cache upload; no source URL reaches the app',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(value,init={})=>{
  const url=String(value);calls.push({url,init});
  if(url.endsWith('/status'))return Response.json({audio:false,video:false});
  if(url.startsWith('https://www.youtube.com/')){assert.equal(init.credentials,undefined);return Response.json({playabilityStatus:{status:'OK'},videoDetails:{title:'Browser track'},streamingData:{adaptiveFormats:[{mimeType:'video/mp4',height:720,url:'https://rr1.googlevideo.com/video',bitrate:1000},{mimeType:'audio/mp4',url:'https://rr1.googlevideo.com/audio',bitrate:100}]}});}
  if(url.startsWith('https://rr1.googlevideo.com/'))return new Response(url.endsWith('video')?'video bytes':'audio bytes');
  assert.equal(init.method,'POST');assert.ok(init.body instanceof Blob);
  assert.equal(await init.body.text(),url.endsWith('video')?'video bytes':'audio bytes');
  assert.equal(init.headers.authorization,undefined);
  return Response.json({ok:true});
 };
 try{await prepareHearMeOutYoutube(id,'movie',()=>{});
  assert.equal(calls.length,6);
  assert.deepEqual(calls.filter(c=>c.init.method==='POST'&&c.url.startsWith('/')).map(c=>c.url),[`/api/watch/broadcast/youtube/${id}/video`,`/api/watch/broadcast/youtube/${id}/audio`]);
  assert.equal(calls.some(c=>c.url.includes('worker')||c.url.includes('source=')),false);
 }finally{globalThis.fetch=original;}
});

test('a browser denial never falls back to a worker download or uploads empty data',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(value,init={})=>{calls.push(String(value));if(String(value).endsWith('/status'))return Response.json({audio:false});if(String(value).includes('youtubei'))return Response.json({playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[{mimeType:'audio/mp4',url:'https://rr1.googlevideo.com/audio'}]}});return new Response(null,{status:403});};
 try{await assert.rejects(()=>prepareHearMeOutYoutube(id,'music',()=>{}),/this browser.*403/);assert.equal(calls.length,3);}finally{globalThis.fetch=original;}
});

test('cold resolution uses the DJ worker two-input HLS route without browser capture',async()=>{
 const calls=[];
 const prepared=new HearMeOutPreparedMedia({origin,authorization,tenantId:'tenant'},async(url,init)=>{
  calls.push(String(url));assert.equal(init.headers.authorization,authorization);
  assert.equal(init.headers.cookie,undefined);
  assert.equal(init.method,'GET');assert.equal(init.headers['x-hmo-browser-media'],undefined);
  return new Response('#EXTM3U\npart001.ts');
 });
 assert.equal((await prepared.upstream(id)).stage,'upstream');assert.deepEqual(calls,[origin+'/watch/youtube/hls/'+id+'/index.m3u8']);
});

test('movie searches reuse the worker credential only on the internal catalog route',async()=>{
 const calls=[];
 const provider=new HearMeOutMovieProvider('https://hearmeout-main.fly.dev',async(url,init)=>{
  calls.push(new URL(url).pathname);
  if(new URL(url).pathname==='/api/internal/watch/search'){assert.equal(init.headers.authorization,authorization);assert.equal(init.redirect,'manual');return Response.json({results:[{id:'xtream-vod-42',title:'Selected movie'}]});}
  assert.equal(init.headers.authorization,undefined);return new Response('#EXTM3U\npart001.ts');
 },authorization);
 assert.equal((await provider.resolve('Selected movie','xtream-vod-42')).itemId,'xtream-vod-42');
 assert.deepEqual(calls,['/api/internal/watch/search','/api/watch/xtream/hls/vod-42/index.m3u8']);
});

function youtubeTracks(){return Response.json({playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[
 {mimeType:'video/mp4',height:720,url:'https://rr1.googlevideo.com/video'},
 {mimeType:'audio/mp4',url:'https://rr1.googlevideo.com/audio'},
]}});}

test('cold music and movie preparation overlap both downloads and wait for both uploads',async()=>{
 const original=globalThis.fetch;
 try{for(const lane of ['music','movie']){
  const downloads=[],uploads=[];let releaseVideo,finished=false;
  const videoUploaded=new Promise(resolve=>{releaseVideo=resolve;});
  globalThis.fetch=async(value,init={})=>{
   const url=String(value);
   if(url.endsWith('/status'))return Response.json({});
   if(url.includes('youtubei'))return youtubeTracks();
   if(url.startsWith('https://rr1.googlevideo.com/')){
    return new Promise(resolve=>{downloads.push(()=>resolve(new Response('media bytes')));if(downloads.length===2)downloads.forEach(release=>release());});
   }
   uploads.push(url);
   if(url.endsWith('/video'))await videoUploaded;
   return Response.json({ok:true});
  };
  const preparation=prepareHearMeOutYoutube(id,lane,()=>{}).then(()=>{finished=true;});
  await new Promise(resolve=>setImmediate(resolve));
  try{
   assert.equal(downloads.length,2,'both downloads must start without waiting for the other');
   assert.equal(uploads.length,2,'audio upload must not wait for video upload');
   assert.equal(finished,false,'both tracks must finish before broadcast submission');
  }finally{releaseVideo();}
  await preparation;
 }}finally{globalThis.fetch=original;}
});

test('failed track cancels its sibling before fallback and the next attempt can succeed',async()=>{
 const original=globalThis.fetch;let aborted=false,uploads=0,fail=true;
 globalThis.fetch=async(value,init={})=>{
  const url=String(value);
  if(url.endsWith('/status'))return Response.json({});
  if(url.includes('youtubei'))return youtubeTracks();
  if(url.startsWith('https://rr1.googlevideo.com/')){
   if(!fail)return new Response('media bytes');
   if(url.endsWith('/video'))return new Response(null,{status:403});
   return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(init.signal.reason);},{once:true}));
  }
  uploads++;return Response.json({ok:true});
 };
 try{
  await assert.rejects(prepareHearMeOutYoutube(id,'movie',()=>{}),/403/);
  assert.equal(aborted,true);assert.equal(uploads,0);
  fail=false;await prepareHearMeOutYoutube(id,'movie',()=>{});assert.equal(uploads,2);
 }finally{globalThis.fetch=original;}
});

test('saved HLS bypasses acquisition and a partial movie cache only transfers the missing track',async()=>{
 const original=globalThis.fetch;let cached={hls:true},calls=[];
 globalThis.fetch=async(value)=>{
  const url=String(value);calls.push(url);
  if(url.endsWith('/status'))return Response.json(cached);
  if(url.includes('youtubei'))return youtubeTracks();
  if(url.startsWith('https://rr1.googlevideo.com/'))return new Response('media bytes');
  return Response.json({ok:true});
 };
 try{
  await prepareHearMeOutYoutube(id,'movie',()=>{});assert.equal(calls.length,1);
  cached={video:true};calls=[];
  await prepareHearMeOutYoutube(id,'movie',()=>{});
  assert.equal(calls.some(url=>url.endsWith('/video')),false);
  assert.equal(calls.filter(url=>url.endsWith('/audio')).length,2);
 }finally{globalThis.fetch=original;}
});
