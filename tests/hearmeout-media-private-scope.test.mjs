import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {handleMediaProxyRoute,YoutubeStreamRegistry} from '../apps/hearmeout/dist/media-proxy-routes.js';

const VID='dQw4w9WgXcQ';
const A={tenantId:'tenant-a',userId:'u1'};
const B={tenantId:'tenant-b',userId:'u1'};
const C={tenantId:'tenant-a',userId:'u2'};
const CDN='https://rr1.googlevideo.com/videoplayback?mime=audio%2Fmp4&sig=private-fixture';
const watch='/api/watch/proxy?url='+encodeURIComponent('https://test-streams.mux.dev/fixture.mp4');
const audio=`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`;
const video=`/api/hearmeout/youtube-video/proxy?videoId=${VID}`;
const post=(url,method='GET')=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,method})});
const registration=(url=CDN,kind='audio')=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({videoId:VID,kind,url})});
const partial=(type='audio/mp4')=>new Response('x',{status:206,headers:{'content-type':type,'content-range':'bytes 0-0/10','content-length':'1','cache-control':'public, max-age=86400'}});

async function harness({authenticate=async()=>({...A}),fetchImpl=async()=>partial(),registry=new YoutubeStreamRegistry()}={}){
 const calls=[];
 const server=createServer((request,response)=>{
  const deps={authenticate,youtubeStreams:registry,fetchImpl:async(input,init)=>{calls.push({url:String(input),init});return fetchImpl(input,init)}};
  handleMediaProxyRoute(request,response,new URL(request.url??'/','http://fixture.test'),deps)
   .then(handled=>{if(!handled){response.statusCode=404;response.end()}})
   .catch(()=>{response.statusCode=500;response.end('Unexpected fixture failure')});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {base:`http://127.0.0.1:${server.address().port}`,calls,registry,close:()=>new Promise(resolve=>server.close(resolve))};
}

async function call(h,path,init){
 const response=await fetch(h.base+path,init);
 return {status:response.status,headers:response.headers,body:await response.text()};
}

function privateResponse(result){
 assert.equal(result.headers.get('cache-control'),'private, no-store');
 assert.equal(result.headers.get('vary'),'Cookie, Authorization');
}

test('authenticated Watch/YouTube manifests, bytes, ranges, HEAD and upstream errors never inherit public cache directives',async()=>{
 const cases=[
  [watch,undefined,()=>partial('video/mp4'),206,'x'],
  ['/api/watch/proxy?url='+encodeURIComponent('https://test-streams.mux.dev/show.m3u8'),undefined,()=>new Response('#EXTM3U\nseg.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl','cache-control':'public, max-age=86400'}}),200,null],
  ['/api/hearmeout/youtube-proxy',post(CDN),()=>partial(),206,'x'],
  ['/api/hearmeout/youtube-proxy',post(CDN,'HEAD'),()=>new Response(null,{headers:{'content-type':'audio/mp4','cache-control':'public, max-age=86400'}}),200,''],
  ['/api/hearmeout/youtube-proxy',post(CDN),()=>new Response('upstream failure',{status:503,headers:{'cache-control':'public, max-age=86400'}}),503,'upstream failure'],
 ];
 for(const [path,init,fetchImpl,status,body] of cases){
  const h=await harness({fetchImpl});
  try{
   const r=await call(h,path,init);
   assert.equal(r.status,status,path);privateResponse(r);
   if(body!==null)assert.equal(r.body,body);
   else assert.match(r.body,/\/api\/watch\/proxy\?url=/);
  }finally{await h.close()}
 }
});

test('authentication, malformed input, origin, allowlist and missing-stream refusals are private too',async()=>{
 const cases=[
  [watch,undefined,async()=>{throw Error('revoked')},401],
  ['/api/watch/proxy',undefined,async()=>A,400],
  ['/api/watch/proxy?url='+encodeURIComponent('https://attacker.test/media'),undefined,async()=>A,403],
  ['/api/hearmeout/youtube-proxy',{...post(CDN),headers:{'content-type':'application/json',origin:'https://attacker.test'}},async()=>A,403],
  [audio,undefined,async()=>A,404],
  ['/api/hearmeout/youtube-stream/register',registration(),async()=>true,403],
 ];
 for(const [path,init,authenticate,status] of cases){
  const h=await harness({authenticate});
  try{const r=await call(h,path,init);assert.equal(r.status,status);privateResponse(r);assert.equal(h.calls.length,0)}finally{await h.close()}
 }
});

test('registration and audio/video lookups are isolated by authenticated tenant AND user, not caller body fields',async()=>{
 let actor=A;
 const h=await harness({authenticate:async()=>({...actor}),fetchImpl:async input=>partial(String(input).includes('video%2Fmp4')?'video/mp4':'audio/mp4')});
 try{
  const injected=registration();injected.body=JSON.stringify({videoId:VID,kind:'audio',url:CDN,tenantId:B.tenantId,userId:C.userId});
  const reg=await call(h,'/api/hearmeout/youtube-stream/register',injected);
  assert.equal(reg.status,200);privateResponse(reg);assert.equal(reg.body.includes('private-fixture'),false);
  const videoUrl=CDN.replace('audio%2Fmp4','video%2Fmp4');
  assert.equal((await call(h,'/api/hearmeout/youtube-stream/register',registration(videoUrl,'video'))).status,200);
  for(const other of [B,C]){
   actor=other;
   for(const path of [audio,video]){const denied=await call(h,path);assert.equal(denied.status,404);privateResponse(denied)}
  }
  assert.equal(h.calls.length,0);
  actor=B;
  assert.equal((await call(h,'/api/hearmeout/youtube-stream/register',registration(CDN+'&owner=b'))).status,200);
  actor=A;
  for(const path of [audio,video]){const own=await call(h,path);assert.equal(own.status,206);privateResponse(own);assert.equal(own.body,'x')}
  assert.equal(h.calls.some(entry=>entry.url.includes('owner=b')),false);
  actor=B;
  assert.equal((await call(h,audio)).status,206);
  assert.equal(h.calls.at(-1).url.includes('owner=b'),true);
 }finally{await h.close()}
});

test('missing/empty tenant or user cannot register or retrieve streams',async()=>{
 for(const actor of [true,{userId:'u1'},{tenantId:'tenant-a'},{tenantId:' ',userId:'u1'},{tenantId:'tenant-a',userId:''}]){
  const h=await harness({authenticate:async()=>actor});
  try{
   for(const [path,init] of [[audio,undefined],[video,undefined],['/api/hearmeout/youtube-stream/register',registration()]]){
    const r=await call(h,path,init);assert.equal(r.status,403);privateResponse(r);
   }
   assert.equal(h.calls.length,0);assert.equal(h.registry.size(),0);
  }finally{await h.close()}
 }
});

test('revocation or identity changes during acquisition cancel bodies before sending Watch/YouTube bytes',async()=>{
 for(const next of [undefined,B,C]){
  for(const [path,init,type] of [[watch,undefined,'video/mp4'],['/api/hearmeout/youtube-proxy',post(CDN),'audio/mp4'],[audio,undefined,'audio/mp4']]){
   let actor=A,cancelled=0;
   const registry=new YoutubeStreamRegistry();registry.put(VID,'audio',new URL(CDN),A);
   const h=await harness({registry,authenticate:async()=>actor,fetchImpl:async()=>{
    actor=next;
    return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('secret bytes'))},cancel(){cancelled++}}),{status:206,headers:{'content-type':type,'content-range':'bytes 0-11/12','cache-control':'public, max-age=86400'}});
   }});
   try{
    const r=await call(h,path,init);assert.equal(r.status,next?403:401);privateResponse(r);
    assert.equal(r.body.includes('secret bytes'),false);assert.equal(cancelled,1);
   }finally{await h.close()}
  }
 }
});

test('registration cannot commit after its session is revoked',async()=>{
 let checks=0;
 const h=await harness({authenticate:async()=>++checks===1?A:undefined});
 try{const r=await call(h,'/api/hearmeout/youtube-stream/register',registration());assert.equal(r.status,401);privateResponse(r);assert.equal(h.registry.size(),0)}finally{await h.close()}
});

test('registry requires scope and snapshots URL values instead of exposing mutable references',()=>{
 const registry=new YoutubeStreamRegistry();const source=new URL(CDN);
 registry.put(VID,'audio',source,A);source.hostname='attacker.test';
 const retrieved=registry.get(VID,'audio',A);assert.equal(retrieved.hostname,'rr1.googlevideo.com');
 retrieved.hostname='attacker.test';assert.equal(registry.get(VID,'audio',A).hostname,'rr1.googlevideo.com');
 assert.equal(registry.get(VID,'audio',B),undefined);assert.equal(registry.get(VID,'audio',C),undefined);
 assert.throws(()=>registry.get(VID,'audio'),/scope is required/);
 assert.throws(()=>registry.put(VID,'audio',new URL(CDN)),/scope is required/);
});
