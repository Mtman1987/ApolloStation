import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getXtreamHlsFile,xtreamHlsUrl,isXtreamHlsUrl} from '../apps/hearmeout/dist/xtream-hls.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';

// HMO-008: HLS segment serving and queue idempotency.
// Segment reads must stay inside one stream's directory, and a replayed
// enqueue with the same operationId must not add a second queue entry.

async function withHlsRoot(fn){
 const root=await mkdtemp(join(tmpdir(),'hmo-hls-seg-'));
 const previous=process.env.HEARMEOUT_HLS_DIR;
 process.env.HEARMEOUT_HLS_DIR=root;
 try{
  const stream=join(root,'vod-42');
  await mkdir(stream,{recursive:true});
  await writeFile(join(stream,'index.m3u8'),'#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nseg-000.ts\n');
  await writeFile(join(stream,'seg-000.ts'),Buffer.from([0x47,0x40,0x00,0x10]));
  const other=join(root,'vod-43');
  await mkdir(other,{recursive:true});
  await writeFile(join(other,'secret.ts'),'other stream segment');
  await fn({root,stream});
 }finally{
  if(previous===undefined)delete process.env.HEARMEOUT_HLS_DIR;else process.env.HEARMEOUT_HLS_DIR=previous;
  await rm(root,{recursive:true,force:true});
 }
}

test('playlist and segment files are served with HLS content types and sizes',async()=>{
 await withHlsRoot(async()=>{
  const index=await getXtreamHlsFile('vod-42','index.m3u8');
  assert.equal(index.contentType,'application/vnd.apple.mpegurl');
  index.stream.destroy();
  const segment=await getXtreamHlsFile('vod-42','seg-000.ts');
  assert.equal(segment.contentType,'video/mp2t');
  assert.equal(segment.contentLength,4);
  segment.stream.destroy();
 });
});

test('missing segments resolve to null, never to another stream',async()=>{
 await withHlsRoot(async()=>{
  assert.equal(await getXtreamHlsFile('vod-42','seg-999.ts'),null);
  assert.equal(await getXtreamHlsFile('vod-42','secret.ts'),null);
 });
});

test('traversal attempts are rejected before any filesystem read',async()=>{
 await withHlsRoot(async()=>{
  await assert.rejects(getXtreamHlsFile('vod-42','../vod-43/secret.ts'),/Invalid HLS file/);
  await assert.rejects(getXtreamHlsFile('vod-42','..'),/Invalid HLS file/);
  await assert.rejects(getXtreamHlsFile('vod-42','..%2Fvod-43%2Fsecret.ts'),/Invalid HLS file|null/);
 });
});

test('stream ids cannot escape the HLS root',async()=>{
 await withHlsRoot(async()=>{
  // Stream ids are sanitised to [a-z0-9-], so traversal collapses to a sibling-less name and resolves to nothing.
  assert.equal(await getXtreamHlsFile('../../etc','passwd'),null);
  await assert.rejects(getXtreamHlsFile('','index.m3u8'),/Invalid Xtream HLS stream id/);
 });
});

test('episode and VOD playback paths map to the HLS route only',()=>{
 assert.equal(xtreamHlsUrl('/activity-provider/xtream/episode/123-mkv'),'/api/watch/xtream/hls/episode-123-mkv/index.m3u8');
 assert.equal(xtreamHlsUrl('/activity-provider/xtream/vod/42'),'/api/watch/xtream/hls/vod-42/index.m3u8');
 assert.equal(isXtreamHlsUrl('/activity-provider/xtream/episode/123-mkv'),true);
 assert.equal(isXtreamHlsUrl('https://provider.example/movie.mp4'),false);
 assert.equal(xtreamHlsUrl('https://provider.example/movie.mp4'),'https://provider.example/movie.mp4');
});

test('replayed movie enqueue with the same operationId adds one queue entry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-queue-idem-'));
 const runtime=new SqliteHearMeOutRoomMediaRuntime(join(dir,'rooms.sqlite'));
 const owner={tenantId:'tenant-a',userId:'owner',displayName:'Owner',roles:['member']};
 try{
  runtime.createRoom(owner,{roomId:'queue-room',name:'Queue',privacy:'public',operationId:'create-queue-room'});
  const item={itemId:'episode-one',type:'movie',title:'Episode one',source:'url',playbackUrl:'/activity-provider/xtream/episode/123-mkv'};
  const first=runtime.enqueue(owner,{roomId:'queue-room',lane:'movie',item,operationId:'watch-accept-1'});
  const replay=runtime.enqueue(owner,{roomId:'queue-room',lane:'movie',item,operationId:'watch-accept-1'});
  assert.deepEqual(replay,first);
  const queued=runtime.getSession(owner.tenantId,'queue-room','movie');
  const count=(queued.current?1:0)+queued.queue.length;
  assert.equal(count,1,'replay must not duplicate the item');
  runtime.enqueue(owner,{roomId:'queue-room',lane:'movie',item:{...item,itemId:'episode-two',title:'Episode two'},operationId:'watch-accept-2'});
  const after=runtime.getSession(owner.tenantId,'queue-room','movie');
  assert.equal((after.current?1:0)+after.queue.length,2,'a distinct operation must add a new entry');
 }finally{
  runtime.close();
  await rm(dir,{recursive:true,force:true});
 }
});
