import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {handleMediaProxyRoute,watchAllowedHosts,isAllowedYoutubeHost,MEDIA_PROXY_MAX_REDIRECTS} from '../apps/hearmeout/dist/media-proxy-routes.js';

// HMO-001 / HMO-008 / HMO-011: media proxy and Xtream diagnostics run in the web
// process. These tests use a fake upstream fetch, so no network call or provider
// credential is involved. Each test checks that no provider URL, password, or cookie
// reaches the response body.

const PROVIDER_HOST='provider.secret.example.test';
const PROVIDER_USER='secretuser';
const PROVIDER_PASS='secretpass123';

function harness({authed=true,fetchImpl,xtreamStatus,xtreamVodUrl,watchAllowedHostsExtra}={}){
 const calls=[];
 const fetchRecorder=async(input,init)=>{calls.push({url:String(input),init});return fetchImpl(String(input),init)};
 const deps={
  authenticate:async()=>{if(!authed)throw new Error('no session');return{userId:'u1'}},
  fetchImpl:fetchRecorder,
  watchAllowedHosts:watchAllowedHostsExtra,
  xtreamStatus,
  xtreamVodUrl,
 };
 const server=createServer((request,response)=>{
  const url=new URL(request.url??'/','http://hearmeout.test');
  handleMediaProxyRoute(request,response,url,deps).then(handled=>{if(!handled){response.statusCode=404;response.end('not-media')}});
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{
  const base=`http://127.0.0.1:${server.address().port}`;
  resolve({base,calls,close:()=>new Promise(r=>server.close(r))});
 }));
}

async function run(opts,path,init){
 const h=await harness(opts);
 try{
  const response=await fetch(h.base+path,init);
  const body=await response.text();
  return{status:response.status,headers:response.headers,body,calls:h.calls};
 }finally{await h.close()}
}

const ok=(body,type='video/mp4',extra={})=>new Response(body,{status:200,headers:{'content-type':type,...extra}});
const redirect=location=>new Response(null,{status:302,headers:{location}});

test('every media route refuses an unauthenticated caller before any upstream call',async()=>{
 const paths=['/api/watch/proxy?url='+encodeURIComponent('https://test-streams.mux.dev/a.m3u8'),'/api/watch/xtream/status','/api/watch/xtream/direct-test/7'];
 for(const path of paths){
  const r=await run({authed:false,fetchImpl:()=>ok('x')},path);
  assert.equal(r.status,401,path);
  assert.equal(r.calls.length,0,path);
 }
 const post=await run({authed:false,fetchImpl:()=>ok('x')},'/api/hearmeout/youtube-proxy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://www.youtube.com/x'})});
 assert.equal(post.status,401);
 assert.equal(post.calls.length,0);
});

test('archive.org is never a playback origin, even when configured',()=>{
 assert.equal(watchAllowedHosts(['archive.org','ARCHIVE.ORG']).has('archive.org'),false);
});

test('watch proxy refuses archive.org and lookalike hosts without fetching',async()=>{
 for(const target of ['https://archive.org/download/a/b.mp4','https://test-streams.mux.dev.evil.test/a.mp4','https://evil-test-streams.mux.dev/a.mp4','http://test-streams.mux.dev/a.mp4']){
  const r=await run({fetchImpl:()=>ok('x')},'/api/watch/proxy?url='+encodeURIComponent(target));
  assert.equal(r.status,403,target);
  assert.equal(r.calls.length,0,target);
 }
});

test('watch proxy refuses a redirect into a disallowed host',async()=>{
 const r=await run({fetchImpl:(url)=>url.startsWith('https://test-streams.mux.dev/')?redirect('https://archive.org/download/x.mp4'):ok('x')},'/api/watch/proxy?url='+encodeURIComponent('https://test-streams.mux.dev/a.mp4'));
 assert.equal(r.status,403);
 assert.equal(r.calls.length,1);
 assert.equal(r.body.includes('archive.org'),false);
});

test('watch proxy caps redirect hops',async()=>{
 const r=await run({fetchImpl:()=>redirect('https://test-streams.mux.dev/loop.mp4')},'/api/watch/proxy?url='+encodeURIComponent('https://test-streams.mux.dev/loop.mp4'));
 assert.equal(r.status,502);
 assert.equal(r.calls.length,MEDIA_PROXY_MAX_REDIRECTS+1);
});

test('watch proxy rewrites manifests through the proxy and forwards only range',async()=>{
 const manifest='#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nseg1.ts\n';
 const r=await run({fetchImpl:()=>ok(manifest,'application/vnd.apple.mpegurl')},'/api/watch/proxy?url='+encodeURIComponent('https://test-streams.mux.dev/show/index.m3u8'),{headers:{range:'bytes=0-9',cookie:'sid=abc',authorization:'Bearer x'}});
 assert.equal(r.status,200);
 assert.match(r.body,/URI="\/api\/watch\/proxy\?url=/);
 assert.match(r.body,/\/api\/watch\/proxy\?url=https%3A%2F%2Ftest-streams\.mux\.dev%2Fshow%2Fseg1\.ts/);
 const sent=r.calls[0].init.headers;
 assert.equal(sent.range,'bytes=0-9');
 assert.equal(sent.cookie,undefined);
 assert.equal(sent.authorization,undefined);
});

test('youtube proxy allows exact hosts and dot-bounded suffixes only',()=>{
 assert.equal(isAllowedYoutubeHost('rr1---sn-abc.googlevideo.com'),true);
 assert.equal(isAllowedYoutubeHost('i.ytimg.com'),true);
 assert.equal(isAllowedYoutubeHost('evilgooglevideo.com'),false);
 assert.equal(isAllowedYoutubeHost('googlevideo.com.evil.test'),false);
 assert.equal(isAllowedYoutubeHost('.googlevideo.com'),false);
 assert.equal(isAllowedYoutubeHost('archive.org'),false);
});

test('youtube proxy refuses lookalike and non-youtube hosts without fetching',async()=>{
 for(const target of ['https://evilgooglevideo.com/v','https://archive.org/x','https://attacker.test/www.youtube.com']){
  const r=await run({fetchImpl:()=>ok('x')},'/api/hearmeout/youtube-proxy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:target})});
  assert.equal(r.status,400,target);
  assert.equal(r.calls.length,0,target);
 }
});

test('youtube proxy refuses cross-origin POSTs',async()=>{
 const r=await run({fetchImpl:()=>ok('x')},'/api/hearmeout/youtube-proxy',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.test'},body:JSON.stringify({url:'https://www.youtube.com/watch'})});
 assert.equal(r.status,403);
 assert.equal(r.calls.length,0);
});

test('xtream status returns whitelisted fields only',async()=>{
 const r=await run({xtreamStatus:async()=>({configured:true,userInfo:{username:PROVIDER_USER,password:PROVIDER_PASS,status:'Active',exp_date:'1900',max_connections:'2'},serverInfo:{url:PROVIDER_HOST,timezone:'UTC',time_now:'now',port:'80'}})},'/api/watch/xtream/status');
 assert.equal(r.status,200);
 for(const leak of [PROVIDER_HOST,PROVIDER_USER,PROVIDER_PASS]) assert.equal(r.body.includes(leak),false,leak);
 const parsed=JSON.parse(r.body);
 assert.equal(parsed.userInfo.status,'Active');
 assert.equal(parsed.serverInfo.timezone,'UTC');
});

test('xtream status failures return a fixed message, not the provider error',async()=>{
 const r=await run({xtreamStatus:async()=>{throw new Error(`fetch failed for https://${PROVIDER_HOST}/player_api.php?username=${PROVIDER_USER}&password=${PROVIDER_PASS}`)}},'/api/watch/xtream/status');
 assert.equal(r.status,502);
 for(const leak of [PROVIDER_HOST,PROVIDER_USER,PROVIDER_PASS]) assert.equal(r.body.includes(leak),false,leak);
});

test('direct-test probes one chunk and never returns the provider URL',async()=>{
 const providerUrl=new URL(`https://${PROVIDER_HOST}/movie/${PROVIDER_USER}/${PROVIDER_PASS}/7.mp4`);
 const r=await run({
  xtreamVodUrl:async id=>{assert.equal(id,'7');return providerUrl},
  fetchImpl:()=>new Response(new Uint8Array(200),{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-63/9999'}}),
 },'/api/watch/xtream/direct-test/7');
 assert.equal(r.status,200);
 for(const leak of [PROVIDER_HOST,PROVIDER_USER,PROVIDER_PASS,'movie/']) assert.equal(r.body.includes(leak),false,leak);
 const parsed=JSON.parse(r.body);
 assert.equal(parsed.ok,true);
 assert.equal(parsed.rangeHonored,true);
 assert.equal(parsed.firstBytesRead,64);
 assert.equal(r.calls[0].init.headers.range,'bytes=0-63');
});

test('direct-test refuses a redirect off the provider host and hides the error detail',async()=>{
 const r=await run({
  xtreamVodUrl:async()=>new URL(`https://${PROVIDER_HOST}/movie/${PROVIDER_USER}/${PROVIDER_PASS}/7.mp4`),
  fetchImpl:()=>redirect('https://cdn.other.test/x.mp4'),
 },'/api/watch/xtream/direct-test/7');
 assert.equal(r.status,502);
 assert.equal(r.calls.length,1);
 for(const leak of [PROVIDER_HOST,PROVIDER_USER,PROVIDER_PASS,'cdn.other.test']) assert.equal(r.body.includes(leak),false,leak);
});

test('direct-test rejects non-numeric ids and never fetches',async()=>{
 for(const id of ['auto','7-abc','..%2Fx']){
  const r=await run({xtreamVodUrl:async()=>{throw new Error('should not run')},fetchImpl:()=>ok('x')},'/api/watch/xtream/direct-test/'+id);
  assert.equal(r.status,400,id);
  assert.equal(r.calls.length,0,id);
 }
});

test('unknown paths fall through to the caller',async()=>{
 const r=await run({fetchImpl:()=>ok('x')},'/api/something-else');
 assert.equal(r.status,404);
 assert.equal(r.body,'not-media');
});
