import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {chmod,mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {delimiter} from 'node:path';
import {ensureXtreamHls} from '../apps/hearmeout/dist/xtream-hls.js';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {createHearMeOutWatchRuntime} from '../apps/hearmeout/dist/watch-runtime.js';

// Real mounted request -> real Watch runtime -> real Apollo HLS disk handler.
// Catalog lookup is injected; queueing does not call a donor/provider.
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
  const watch=createHearMeOutWatchRuntime({statePath:join(root,'watch.sqlite'),
   findSeriesEpisode:async()=>episode,getNextSeriesEpisode:async()=>null});
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
  assert.equal(item.playbackUrl,'/api/watch/xtream/hls/episode-7-mkv/index.m3u8');
  const indexUrl=new URL(item.playbackUrl,base);

  await t.test('master and child resolve inside Apollo and deliver actual bytes',async()=>{
   const index=await fetch(indexUrl);
   assert.equal(index.status,200);assert.equal(index.headers.get('cache-control'),'private, no-store');
   assert.equal(index.headers.get('vary'),'Cookie, Authorization');
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
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(response.headers.get('vary'),'Cookie, Authorization');await response.text();
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

test('episode HLS conversion runs the real FFmpeg orchestration and reuses a valid cached ladder',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hmo-episode-convert-'));
 const bin=join(root,'bin'),hls=join(root,'hls'),count=join(root,'ffmpeg-count');
 const previous={PATH:process.env.PATH,HLS:process.env.HEARMEOUT_HLS_DIR,BASE:process.env.HEARMEOUT_XTREAM_BASE_URL,USER:process.env.HEARMEOUT_XTREAM_USERNAME,PASS:process.env.HEARMEOUT_XTREAM_PASSWORD};
 try{
  await mkdir(bin,{recursive:true});
  const ffprobe=join(bin,'ffprobe'),ffmpeg=join(bin,'ffmpeg');
  await writeFile(ffprobe, '#!/bin/sh\\nprintf '%s\\n' '{"streams":[{"index":0,"codec_type":"video"},{"index":1,"codec_type":"audio","tags":{"language":"eng"}}]}'\\n');
  await writeFile(ffmpeg,`#!/bin/sh
printf 'run\\n' >> '${count}'
segment_pattern=''
output=''
want_segment=0
for arg in "$@"; do
 if [ "$want_segment" = "1" ]; then segment_pattern="$arg"; want_segment=0; continue; fi
 if [ "$arg" = "-hls_segment_filename" ]; then want_segment=1; continue; fi
 output="$arg"
done
dir=$(dirname "$output")
case "$segment_pattern" in
 */stream_%v_seg_%05d.ts) ;;
 *) exit 9;;
esac
segment="$dir/stream_v0_seg_00000.ts"
printf '#EXTM3U\\n#EXT-X-STREAM-INF:BANDWIDTH=128000\\nstream_v0.m3u8\\n' > "$dir/index.m3u8"
printf '#EXTM3U\\n#EXTINF:6,\\nstream_v0_seg_00000.ts\\n#EXT-X-ENDLIST\\n' > "$dir/stream_v0.m3u8"
printf 'fixture-segment' > "$segment"
exit 0
`);
  await chmod(ffprobe,0o755);await chmod(ffmpeg,0o755);
  process.env.PATH=bin+delimiter+(previous.PATH||'');
  process.env.HEARMEOUT_HLS_DIR=hls;
  process.env.HEARMEOUT_XTREAM_BASE_URL='https://provider.example';
  process.env.HEARMEOUT_XTREAM_USERNAME='fixture-user';
  process.env.HEARMEOUT_XTREAM_PASSWORD='fixture-password';
  await ensureXtreamHls('episode-7-mkv');
  const dir=join(hls,'episode-7-mkv');
  assert.match(await readFile(join(dir,'index.m3u8'),'utf8'),/stream_v0\.m3u8/);
  assert.match(await readFile(join(dir,'stream_v0.m3u8'),'utf8'),/stream_v0_seg_00000\.ts/);
  assert.equal(await readFile(join(dir,'stream_v0_seg_00000.ts'),'utf8'),'fixture-segment');
  await ensureXtreamHls('episode-7-mkv');
  assert.equal((await readFile(count,'utf8')).trim().split(/\r?\n/).length,1,'valid cache is not reconverted');
 }finally{
  for(const [key,value] of [['PATH',previous.PATH],['HEARMEOUT_HLS_DIR',previous.HLS],['HEARMEOUT_XTREAM_BASE_URL',previous.BASE],['HEARMEOUT_XTREAM_USERNAME',previous.USER],['HEARMEOUT_XTREAM_PASSWORD',previous.PASS]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await rm(root,{recursive:true,force:true});
 }
});
