import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaBinary } from '../scripts/test-media-binaries.mjs';
import { HearMeOutPreparedMedia, preparedHearMeOutEnvironment, preparedHearMeOutUrl } from '../apps/hearmeout/dist/prepared-media.js';
import { HearMeOutYoutubeResolverCoordinator, acceptHearMeOutBrowserResolvedStream } from '../apps/hearmeout/dist/youtube-resolver.js';
import { HearMeOutRoomBroadcast } from '../apps/hearmeout/dist/room-broadcast.js';
import { SqliteHearMeOutRoomMediaRuntime } from '../apps/hearmeout/dist/room-media-core.js';

const id = 'aqz-KE-bpKQ', owner = { tenantId: 'owner-tenant', userId: 'owner', displayName: 'Owner', roles: ['admin'] };
const remoteOrigin = 'https://hmo-dj-worker.fly.dev', path = `/watch/youtube/hls/${id}/index.m3u8`, authorization = 'Bearer prepared-worker-test-credential';

test('prepared-media failures identify the failing worker stage without exposing provider response details',async()=>{
 for(const [status,body,code,message] of [[401,'Unauthorized','worker-auth',/service access/],[502,'No YouTube video stream resolved https://r1.googlevideo.com/v?token=secret','video-unavailable',/video stream/],[502,'HTTP Error 403 Forbidden Bearer secret','provider-denied',/YouTube refused/],[503,'private debug output','worker-http',/HTTP 503/]]){
  const prepared=new HearMeOutPreparedMedia({origin:remoteOrigin,authorization,tenantId:owner.tenantId},async()=>new Response(body,{status}));
  await assert.rejects(()=>prepared.upstream(id),error=>{assert.equal(error.code,code);assert.equal(error.httpStatus,status);assert.match(error.message,message);assert.doesNotMatch(error.message,/secret|googlevideo|debug output/);return true;});
  const resolution=await new HearMeOutYoutubeResolverCoordinator(prepared,{preparedMediaOrigin:remoteOrigin}).resolve(id);
  assert.equal(resolution.result,null);assert.match(resolution.attempts.find(attempt=>attempt.stage==='upstream').message,message);
 }
});

test('prepared input is confined to the configured tenant and media paths without forwarding credentials to redirects', async () => {
  for (const value of ['/dj', '/voice-bridge', '/watch/cache/control', path+'?source=https://example.com', path+'?machine=x&machine=y', `/watch/youtube/hls/${id}/../private.ts`])
    assert.equal(preparedHearMeOutUrl(remoteOrigin+value,remoteOrigin),undefined,value);
  assert.ok(preparedHearMeOutUrl(remoteOrigin+path+'?machine=ab123',remoteOrigin));
  assert.throws(()=>acceptHearMeOutBrowserResolvedStream({videoId:id,videoUrl:remoteOrigin+path,audioUrl:remoteOrigin+path}),/not allowed/);
  let calls=0;
  const prepared=new HearMeOutPreparedMedia({origin:remoteOrigin,authorization,tenantId:owner.tenantId},async(url,init)=>{
    calls++;assert.equal(new URL(url).pathname,path);assert.equal(init.headers.authorization,authorization);assert.equal(init.redirect,'manual');
    return new Response(null,{status:302,headers:{location:'https://unrelated.example/private'}});
  });
  assert.throws(()=>prepared.localSource(new URL(remoteOrigin+path),'other-tenant','http://127.0.0.1:1'),/not available/);
  await assert.rejects(()=>prepared.upstream(id),/HTTP 302/);assert.equal(calls,1);
  for(const manifest of ['#EXTM3U\nhttps://unrelated.example/segment.ts', '#EXTM3U\n/watch/youtube/hls/abcdefghijk/part000.ts', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://unrelated.example/key"']){
    const unsafe=new HearMeOutPreparedMedia({origin:remoteOrigin,authorization,tenantId:owner.tenantId},async()=>new Response(manifest));
    await assert.rejects(()=>unsafe.upstream(id),/unrelated source/);
  }
  assert.throws(()=>preparedHearMeOutEnvironment({HEARMEOUT_PREPARED_MEDIA_ENABLED:'1'}),/incomplete/);
  const configured=preparedHearMeOutEnvironment({HEARMEOUT_PREPARED_MEDIA_ENABLED:'1',HEARMEOUT_VOICE_BRIDGE_ORIGIN:remoteOrigin,HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION:authorization,HEARMEOUT_MEDIA_TENANT_ID:owner.tenantId});
  assert.equal(configured.tenantId,owner.tenantId);
});

test('existing authenticated prepared video feeds one real Apollo room encoder and keeps advancing without windows',{timeout:40000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'hmo-prepared-input-'));
  let upstream,feed,broadcast,rooms;const requested=[],diagnostics=[];
  try {
    execFileSync(mediaBinary('ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=96x64:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','60','-c:v','libx264','-preset','ultrafast','-g','50','-c:a','aac','-f','hls','-hls_time','2','-hls_list_size','0','-hls_segment_filename',join(root,'part%03d.ts'),join(root,'index.m3u8')],{timeout:10000});
    upstream=createServer(async(req,res)=>{
      try {
        assert.equal(req.headers.authorization,authorization);assert.equal(req.method,'GET');
        const url=new URL(req.url,'http://worker');requested.push(url.pathname);
        assert.ok(url.pathname.startsWith(`/watch/youtube/hls/${id}/`));
        const name=url.pathname.split('/').at(-1);assert.match(name,/^(?:index\.m3u8|part\d+\.ts)$/);
        let bytes=await readFile(join(root,name));
        if(name.endsWith('.m3u8'))bytes=Buffer.from(bytes.toString().replace(/(part\d+\.ts)/g,'$1?machine=ab123'));
        else assert.equal(req.headers['fly-force-instance-id'],'ab123');
        res.writeHead(200,{'content-type':name.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t','content-length':bytes.length});res.end(bytes);
      } catch(error) {res.writeHead(500);res.end(String(error));}
    });
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${upstream.address().port}`,options={origin,authorization,tenantId:owner.tenantId};
    const resolved=await new HearMeOutYoutubeResolverCoordinator(new HearMeOutPreparedMedia(options),{preparedMediaOrigin:origin}).resolve(id);
    assert.equal(resolved.result.stage,'upstream');assert.equal(resolved.result.videoUrl,origin+path);assert.equal(JSON.stringify(resolved).includes(authorization),false);
    rooms=new SqliteHearMeOutRoomMediaRuntime(':memory:');
    rooms.createRoom(owner,{roomId:'isolated',name:'Isolated broadcast',privacy:'public',operationId:'create'});
    // The loopback fixture uses the existing relative-media URL contract;
    // the configured production worker returns its HTTPS media URL.
    rooms.enqueue(owner,{roomId:'isolated',lane:'movie',operationId:'video',item:{itemId:id,type:'movie',title:'Prepared video',source:'youtube',playbackUrl:new URL(resolved.result.videoUrl).pathname,durationSeconds:60}});
    // Diagnostics are enabled only for this credential-free local fixture.
    broadcast=new HearMeOutRoomBroadcast(rooms,{ffmpegBinary:mediaBinary('ffmpeg'),ffprobeBinary:mediaBinary('ffprobe'),cachePath:join(root,'broadcast'),spmtOrigin:origin,preparedMedia:options,onDiagnostic:value=>{diagnostics.push({...value,message:value.message.slice(-1600)});if(diagnostics.length>10)diagnostics.shift();}});await broadcast.listen();
    feed=createServer((req,res)=>broadcast.serve(owner.tenantId,'isolated','movie',req.url.slice(1),res));await new Promise(resolve=>feed.listen(0,'127.0.0.1',resolve));
    const feedOrigin=`http://127.0.0.1:${feed.address().port}`;
    // The production source probe itself has a 20-second budget.
    let master='';const deadline=Date.now()+25000;
    while(Date.now()<deadline){const response=await fetch(feedOrigin+'/index.m3u8');if(response.ok){master=await response.text();break;}await new Promise(resolve=>setTimeout(resolve,150));}
    assert.match(master,/#EXTM3U/,JSON.stringify({status:broadcast.status(),requested:requested.slice(-12),diagnostics}));assert.equal(broadcast.status().startedProcesses,1);
    const variant=master.split('\n').find(line=>line&&!line.startsWith('#'));
    const before=await (await fetch(feedOrigin+'/'+variant)).text();
    rooms.leaveRoom(owner,'isolated','leave');
    let after=before;const progressDeadline=Date.now()+8000;
    while(Date.now()<progressDeadline&&after===before){await new Promise(resolve=>setTimeout(resolve,200));const response=await fetch(feedOrigin+'/'+variant);if(response.ok)after=await response.text();}
    assert.match(after,/#EXTM3U/);assert.notEqual(after,before,'The same encoder must produce another segment while no members are present');
    for(let window=0;window<4;window++)assert.equal((await fetch(feedOrigin+'/index.m3u8')).status,200);
    assert.equal(broadcast.status().startedProcesses,1);assert.ok(requested.some(value=>value.endsWith('.ts')));
    assert.equal(requested.some(value=>value.startsWith('/dj')||value.startsWith('/voice-bridge')),false);
  } finally {
    await broadcast?.close();rooms?.close();
    for(const server of [feed,upstream])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await rm(root,{recursive:true,force:true});
  }
});
