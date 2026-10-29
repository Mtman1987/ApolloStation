import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {createHearMeOutWatchRuntime} from '../apps/hearmeout/dist/watch-runtime.js';
import {HEARMEOUT_DONOR_DEFAULT_ORIGIN} from '../apps/hearmeout/dist/donor-origin.js';

// Real mounted request -> real Watch runtime -> real Apollo HLS disk handler.
// Only catalog lookup and donor acquisition are fake; no donor/provider runs.
// Cached fixture bytes prove HTTP delivery, not conversion or browser decoding.
const episode={id:'xtream-episode-7-mkv',title:'Example S01E02',
 metadata:{kind:'series-episode',seriesId:'9',seriesTitle:'Example',seasonNumber:1,episodeNumber:2},
 playbackUrl:'/activity-provider/xtream/episode/7-mkv'};
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nstream_video.m3u8\n';
const variant='#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nstream_video_seg_00000.ts\n#EXT-X-ENDLIST\n';
const media=Buffer.from([0x47,0x40,0x00,0x10,1,2,3,4]);

test('requested episode delivers its Apollo HLS ladder and bounded ranges without origin disclosure',async t=>{
 const root=await mkdtemp(join(tmpdir(),'hmo-episode-hls-'));
 const previous=process.env.HEARMEOUT_HLS_DIR;
 let auth,host;
 process.env.HEARMEOUT_HLS_DIR=join(root,'hls');
 try{
  const dir=join(process.env.HEARMEOUT_HLS_DIR,'episode-7-mkv');
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'index.m3u8'),master);
  await writeFile(join(dir,'stream_video.m3u8'),variant);
  await writeFile(join(dir,'stream_video_seg_00000.ts'),media);
  auth=createServer((req,res)=>{
   if(req.url!=='/v1/session'||req.headers.cookie!=='sid=alice'){res.writeHead(401);res.end('{}');return;}
   res.setHeader('content-type','application/json');
   res.end(JSON.stringify({actorId:'alice',displayName:'Alice',tenantIds:['crew'],scopes:[]}));
  });
  await new Promise(resolve=>auth.listen(0,'127.0.0.1',resolve));
  const acquisitions=[];
  const watch=createHearMeOutWatchRuntime({statePath:join(root,'watch.sqlite'),donorOrigin:HEARMEOUT_DONOR_DEFAULT_ORIGIN,
   findSeriesEpisode:async()=>episode,getNextSeriesEpisode:async()=>null,
   fetchImpl:async url=>{acquisitions.push(String(url));return new Response(master);}});
  host=createHearMeOutWebServer({databasePath:join(root,'rooms.sqlite'),spmtOrigin:`http://127.0.0.1:${auth.address().port}`,port:0,watch});
  await host.listen();
  const base=`http://127.0.0.1:${host.server.address().port}`;
  const headers={'content-type':'application/json',cookie:'sid=alice',origin:base};
  const created=await fetch(base+'/api/hearmeout/rooms',{method:'POST',headers,body:JSON.stringify({name:'Episode Night',privacy:'public'})});
  assert.equal(created.status,201);
  const roomId=(await created.json()).roomId;
  const joined=await fetch(base+`/api/hearmeout/rooms/${roomId}/join`,{method:'POST',headers,body:'{}'});
  assert.equal(joined.status,200);await joined.text();
  const request=await fetch(base+`/api/hearmeout/rooms/${roomId}/watch/request`,{method:'POST',headers,body:JSON.stringify({query:'Example S01E02'})});
  const reply=await request.text();assert.equal(request.status,201,reply);
  const session=JSON.parse(reply).session;
  const item=(session.current??session.queue.at(-1)).item;
  assert.equal(item.playbackUrl,'/api/watch/xtream/hls/episode-7-mkv/index.m3u8');
  assert.doesNotMatch(reply,/https?:\/\/|password|Bearer/i);
  assert.equal(acquisitions.length,1);
  assert.equal(acquisitions[0],HEARMEOUT_DONOR_DEFAULT_ORIGIN+item.playbackUrl);
  const indexUrl=new URL(item.playbackUrl,base);

  await t.test('master and child resolve inside Apollo and deliver actual bytes',async()=>{
   const index=await fetch(indexUrl);
   assert.equal(index.status,200);assert.equal(index.headers.get('cache-control'),'no-store');
   assert.equal(await index.text(),master);
   const variantUrl=new URL('stream_video.m3u8',indexUrl);
   const playlist=await fetch(variantUrl);assert.equal(playlist.status,200);
   assert.equal(await playlist.text(),variant);
   const segment=await fetch(new URL('stream_video_seg_00000.ts',variantUrl));
   assert.equal(segment.status,200);assert.equal(segment.headers.get('content-type'),'video/mp2t');
   assert.deepEqual(Buffer.from(await segment.arrayBuffer()),media);
  });
  const segmentUrl=new URL('stream_video_seg_00000.ts',indexUrl);
  await t.test('closed, open and suffix ranges return exact 206 bytes',async()=>{
   for(const [range,start,end] of [['bytes=1-3',1,3],['bytes=4-',4,7],['bytes=-2',6,7],['bytes=0-99',0,7]]){
    const response=await fetch(segmentUrl,{headers:{range}});
    assert.equal(response.status,206,range);
    assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${media.length}`);
    assert.equal(response.headers.get('content-length'),String(end-start+1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),media.subarray(start,end+1));
   }
  });
  await t.test('invalid ranges and missing children fail without cache or origin leakage',async()=>{
   for(const range of ['bytes=99-','bytes=-0','bytes=-','bytes=4-2','bytes=0-1,4-5','bytes=9007199254740992-']){
    const response=await fetch(segmentUrl,{headers:{range}});assert.equal(response.status,416,range);
    assert.equal(response.headers.get('content-range'),'bytes */8');
    assert.equal(response.headers.get('cache-control'),'no-store');await response.text();
   }
   const missing=await fetch(new URL('absent.ts',indexUrl));assert.equal(missing.status,404);await missing.text();
   const malformed=await fetch(base+'/api/watch/xtream/hls/episode-7-mkv/%ZZ.ts');
   assert.equal(malformed.status,400);assert.deepEqual(await malformed.json(),{error:'invalid_hls_reference'});
  });
  await t.test('unsafe manifest children and oversized manifests never reach viewers',async()=>{
   for(const body of ['#EXTM3U\nhttps://provider.invalid/user/secret/segment.ts\n',
    '#EXTM3U\n../episode-8-mkv/segment.ts\n',
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://provider.invalid/secret"\n',
    '#EXTM3U\n'+'x'.repeat(1024*1024)]){
    await writeFile(join(dir,'unsafe.m3u8'),body);
    const response=await fetch(new URL('unsafe.m3u8',indexUrl));assert.equal(response.status,502);
    const text=await response.text();assert.deepEqual(JSON.parse(text),{error:'HLS media is unavailable'});
    assert.doesNotMatch(text,/provider|secret|https?:\/\/|\/tmp\//);
   }
  });
 }finally{
  await host?.close();
  if(auth){auth.closeAllConnections();await new Promise(resolve=>auth.close(resolve));}
  if(previous===undefined)delete process.env.HEARMEOUT_HLS_DIR;else process.env.HEARMEOUT_HLS_DIR=previous;
  await rm(root,{recursive:true,force:true});
 }
});