import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {handleMediaProxyRoute,YoutubeStreamRegistry,YOUTUBE_STREAM_TTL_MS,YOUTUBE_STREAM_WINDOW_BYTES,YOUTUBE_STREAM_MAX_ENTRIES} from '../apps/hearmeout/dist/media-proxy-routes.js';

// HMO-004: YouTube audio and video chunk proxies run in the web process. These tests use
// a fake upstream fetch, so no network call is made. Each test checks that the CDN URL,
// its signature, and any cookie stay out of responses and out of forwarded headers.

const VID='dQw4w9WgXcQ';
const SECRET_SIG='SECRETSIG123';
const CDN=`https://rr1---sn-test.googlevideo.com/videoplayback?id=${VID}&sig=${SECRET_SIG}&mime=audio%2Fmp4`;
const VIDEO_CDN=`https://rr1---sn-test.googlevideo.com/videoplayback?id=${VID}&sig=${SECRET_SIG}&mime=video%2Fmp4`;

function harness({authed=true,fetchImpl,registry=new YoutubeStreamRegistry()}={}){
 const calls=[];
 const fetchRecorder=async(input,init)=>{calls.push({url:String(input),init});return fetchImpl?fetchImpl(String(input),init):new Response('',{status:500})};
 const deps={
  authenticate:async()=>{if(!authed)throw new Error('no session');return{userId:'u1'}},
  fetchImpl:fetchRecorder,
  youtubeStreams:registry,
 };
 const server=createServer((request,response)=>{
  const url=new URL(request.url??'/','http://hearmeout.test');
  handleMediaProxyRoute(request,response,url,deps).then(handled=>{if(!handled){response.statusCode=404;response.end('not-media')}});
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{
  const base=`http://127.0.0.1:${server.address().port}`;
  resolve({base,calls,registry,close:()=>new Promise(r=>server.close(r))});
 }));
}

async function call(h,path,init){
 const response=await fetch(h.base+path,init);
 const body=await response.text();
 return{status:response.status,headers:response.headers,body};
}

function register(h,body,extra={}){
 return call(h,'/api/hearmeout/youtube-stream/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),...extra});
}

const partial=(body,contentType,range)=>new Response(body,{status:206,headers:{'content-type':contentType,'content-range':range,'content-length':String(body.length)}});

test('every youtube stream route refuses an unauthenticated caller before any upstream call',async()=>{
 const h=await harness({authed:false,fetchImpl:()=>partial('x','audio/mp4','bytes 0-0/1')});
 try{
  h.registry.put(VID,'audio',new URL(CDN));
  const reg=await register(h,{videoId:VID,kind:'audio',url:CDN});
  assert.equal(reg.status,401);
  for(const path of [`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`,`/api/hearmeout/youtube-video/proxy?videoId=${VID}`]){
   const r=await call(h,path);
   assert.equal(r.status,401,path);
  }
  assert.equal(h.calls.length,0);
 }finally{await h.close()}
});

test('register accepts a YouTube CDN audio URL and returns a proxy path, never the URL',async()=>{
 const h=await harness({fetchImpl:()=>partial('x','audio/mp4','bytes 0-0/10')});
 try{
  const r=await register(h,{videoId:VID,kind:'audio',url:CDN});
  assert.equal(r.status,200);
  assert.equal(JSON.parse(r.body).proxyPath,`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`);
  assert.equal(r.body.includes(SECRET_SIG),false);
  assert.equal(r.body.includes('googlevideo'),false);
  assert.equal(h.registry.size(),1);
 }finally{await h.close()}
});

test('register refuses lookalike hosts, http, non-youtube hosts, bad ids, and wrong media type',async()=>{
 const h=await harness({fetchImpl:()=>partial('x','audio/mp4','bytes 0-0/10')});
 try{
  const bad=[
   [{videoId:VID,kind:'audio',url:'https://evilgooglevideo.com/videoplayback?mime=audio%2Fmp4'},400],
   [{videoId:VID,kind:'audio',url:'https://googlevideo.com.attacker.test/videoplayback?mime=audio%2Fmp4'},400],
   [{videoId:VID,kind:'audio',url:'http://rr1.googlevideo.com/videoplayback?mime=audio%2Fmp4'},400],
   [{videoId:VID,kind:'audio',url:'https://169.254.169.254/latest/meta-data'},400],
   [{videoId:VID,kind:'audio',url:'https://archive.org/download/x.mp4?mime=audio%2Fmp4'},400],
   [{videoId:'short',kind:'audio',url:CDN},400],
   [{videoId:VID,kind:'playlist',url:CDN},400],
   [{videoId:VID,kind:'audio',url:VIDEO_CDN},415],
   [{videoId:VID,kind:'video',url:CDN},415],
  ];
  for(const [body,status] of bad){
   const r=await register(h,body);
   assert.equal(r.status,status,JSON.stringify(body));
   assert.equal(r.body.includes(SECRET_SIG),false);
  }
  assert.equal(h.registry.size(),0);
  assert.equal(h.calls.length,0);
 }finally{await h.close()}
});

test('register refuses cross-origin POSTs',async()=>{
 const h=await harness();
 try{
  const r=await register(h,{videoId:VID,kind:'audio',url:CDN},{headers:{'content-type':'application/json',origin:'https://evil.test'}});
  assert.equal(r.status,403);
  assert.equal(h.registry.size(),0);
 }finally{await h.close()}
});

test('audio proxy returns 404 when nothing is registered for the video',async()=>{
 const h=await harness({fetchImpl:()=>partial('x','audio/mp4','bytes 0-0/10')});
 try{
  const r=await call(h,`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`);
  assert.equal(r.status,404);
  assert.equal(h.calls.length,0);
 }finally{await h.close()}
});

test('proxy rejects invalid video ids without touching the registry or upstream',async()=>{
 const h=await harness({fetchImpl:()=>partial('x','audio/mp4','bytes 0-0/10')});
 try{
  for(const id of ['','../etc/passwd','abc','dQw4w9WgXcQ&x=1']){
   const r=await call(h,`/api/hearmeout/youtube-audio/proxy?videoId=${encodeURIComponent(id)}`);
   assert.equal(r.status,400,id);
  }
  assert.equal(h.calls.length,0);
 }finally{await h.close()}
});

test('proxy forwards one bounded window and never the whole file',async()=>{
 const h=await harness({fetchImpl:(url,init)=>{
  assert.equal(init.headers.range,`bytes=0-${YOUTUBE_STREAM_WINDOW_BYTES-1}`);
  return partial('abcd','audio/mp4; codecs="mp4a.40.2"',`bytes 0-3/${YOUTUBE_STREAM_WINDOW_BYTES*50}`);
 }});
 try{
  h.registry.put(VID,'audio',new URL(CDN));
  const r=await call(h,`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`);
  assert.equal(r.status,206);
  assert.equal(r.body,'abcd');
  assert.equal(r.headers.get('content-range'),`bytes 0-3/${YOUTUBE_STREAM_WINDOW_BYTES*50}`);
  assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'),null);
  assert.equal(r.body.includes(SECRET_SIG),false);
  assert.equal(h.calls.length,1);
 }finally{await h.close()}
});

test('proxy caps a client range to one window and forwards no cookie or authorization',async()=>{
 let seen;
 const h=await harness({fetchImpl:(url,init)=>{seen=init;return partial('z','audio/mp4','bytes 100-100/999999999')}});
 try{
  h.registry.put(VID,'audio',new URL(CDN));
  const r=await call(h,`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`,{headers:{range:'bytes=100-',cookie:'spmt=secret',authorization:'Bearer abc'}});
  assert.equal(r.status,206);
  assert.equal(seen.headers.range,`bytes=100-${100+YOUTUBE_STREAM_WINDOW_BYTES-1}`);
  assert.equal(seen.headers.cookie,undefined);
  assert.equal(seen.headers.authorization,undefined);
 }finally{await h.close()}
});

test('proxy refuses an upstream that ignores the range instead of streaming the whole file',async()=>{
 const h=await harness({fetchImpl:()=>new Response('FULLFILE'.repeat(1000),{status:200,headers:{'content-type':'audio/mp4'}})});
 try{
  h.registry.put(VID,'audio',new URL(CDN));
  const r=await call(h,`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`);
  assert.equal(r.status,502);
  assert.equal(r.body.includes('FULLFILE'),false);
  assert.equal(r.body.includes(SECRET_SIG),false);
 }finally{await h.close()}
});

test('proxy refuses an upstream response of the wrong media type',async()=>{
 const h=await harness({fetchImpl:()=>partial('x','text/html','bytes 0-0/10')});
 try{
  h.registry.put(VID,'audio',new URL(CDN));
  const r=await call(h,`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`);
  assert.equal(r.status,502);
 }finally{await h.close()}
});

test('proxy refuses a redirect off the YouTube hosts and does not fetch the target',async()=>{
 const h=await harness({fetchImpl:(url)=>{
  if(url.startsWith('https://rr1---sn-test.googlevideo.com'))return new Response(null,{status:302,headers:{location:'https://internal.example.test/secret'}});
  return partial('x','audio/mp4','bytes 0-0/10');
 }});
 try{
  h.registry.put(VID,'audio',new URL(CDN));
  const r=await call(h,`/api/hearmeout/youtube-audio/proxy?videoId=${VID}`);
  assert.equal(r.status,403);
  assert.equal(h.calls.some(c=>c.url.includes('internal.example.test')),false);
 }finally{await h.close()}
});

test('video proxy serves only video registrations',async()=>{
 const h=await harness({fetchImpl:()=>partial('v','video/mp4','bytes 0-0/10')});
 try{
  h.registry.put(VID,'audio',new URL(CDN));
  const r=await call(h,`/api/hearmeout/youtube-video/proxy?videoId=${VID}`);
  assert.equal(r.status,404);
  h.registry.put(VID,'video',new URL(VIDEO_CDN));
  const ok=await call(h,`/api/hearmeout/youtube-video/proxy?videoId=${VID}`);
  assert.equal(ok.status,206);
  assert.equal(ok.headers.get('content-type'),'video/mp4');
 }finally{await h.close()}
});

test('registry expires entries after the TTL and caps its size',()=>{
 let now=1_000;
 const registry=new YoutubeStreamRegistry(()=>now);
 registry.put(VID,'audio',new URL(CDN));
 assert.ok(registry.get(VID,'audio'));
 now+=YOUTUBE_STREAM_TTL_MS;
 assert.equal(registry.get(VID,'audio'),undefined);

 const capped=new YoutubeStreamRegistry(()=>now);
 for(let i=0;i<YOUTUBE_STREAM_MAX_ENTRIES+10;i+=1){
  capped.put(`vid_${String(i).padStart(7,'0')}`,'audio',new URL(CDN));
 }
 assert.equal(capped.size(),YOUTUBE_STREAM_MAX_ENTRIES);
 assert.equal(capped.get('vid_0000000','audio'),undefined);
 assert.ok(capped.get(`vid_${String(YOUTUBE_STREAM_MAX_ENTRIES+9).padStart(7,'0')}`,'audio'));
});
