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
  if(url.startsWith('https://www.youtube.com/')){assert.equal(init.credentials,'include');return Response.json({playabilityStatus:{status:'OK'},videoDetails:{title:'Browser track'},streamingData:{adaptiveFormats:[{mimeType:'video/mp4',height:720,url:'https://rr1.googlevideo.com/video',bitrate:1000},{mimeType:'audio/mp4',url:'https://rr1.googlevideo.com/audio',bitrate:100}]}});}
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

test('cold worker resolution stops before requesting HLS; cached bytes enable preparation',async()=>{
 let audio=false;const calls=[];
 const prepared=new HearMeOutPreparedMedia({origin,authorization,tenantId:'tenant'},async(url,init)=>{
  calls.push(String(url));assert.equal(init.headers.authorization,authorization);
  if(String(url).includes('/browser/'))return Response.json({audio});
  assert.equal(init.headers['x-hmo-browser-media'],'1');return new Response('#EXTM3U\npart001.ts');
 });
 await assert.rejects(()=>prepared.upstream(id),e=>e.code==='browser-required');assert.equal(calls.length,1);
 audio=true;assert.equal((await prepared.upstream(id)).stage,'upstream');assert.equal(calls.length,3);
});

test('YouTube browser preparation returns a video ID before starting any worker resolution job',async()=>{
 const resolver=new SpmtHearMeOutSuiteMediaResolver({listExecutionWorkers(){throw Error('No job should start');}});
 await assert.rejects(()=>resolver.resolve({tenantId:'tenant',query:'https://youtu.be/'+id,lane:'movie',browserPreparation:true}),e=>e.code==='youtube-browser-required'&&e.videoId===id);
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
