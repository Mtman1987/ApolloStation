import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {ensureXtreamHls} from '../apps/hearmeout/dist/xtream-hls.js';

const command=promisify(execFile);

// Oracle installs FFmpeg. No donor or live provider is used: the normal Xtream
// URL builder, HTTP acquisition, probe, converter and mounted route are real.
// This intentionally tests the existing public Activity-compatible HLS route,
// not room authorization, Watch's donor preparation, or browser decoding.
test('uncached episode converts once, reaches EOF and serves playable HLS through Apollo',{timeout:75000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'hmo-xtream-conversion-'));
 const keys=['HEARMEOUT_HLS_DIR','HEARMEOUT_XTREAM_BASE_URL','HEARMEOUT_XTREAM_USERNAME','HEARMEOUT_XTREAM_PASSWORD','WATCH_HLS_MAX_JOBS'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const originalLog=console.log,logs=[],acquisitions=[];
 let provider,host,conversion;
 try{
  const sourcePath=join(root,'source.mp4');
  await command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x90:r=25',
   '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8','-c:v','libx264','-preset','ultrafast','-g','25',
   '-c:a','aac','-movflags','+faststart',sourcePath],{timeout:15000,maxBuffer:1024*1024});
  const source=await readFile(sourcePath);
  provider=createServer((req,res)=>{
   if(req.url!=='/series/fixture-user/fixture-secret/77.mp4'){
    res.writeHead(404);res.end();return;
   }
   acquisitions.push({method:req.method,range:req.headers.range});
   const range=/^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range??''));
   const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),source.length-1):source.length-1;
   if(start>=source.length||end<start){res.writeHead(416,{'content-range':`bytes */${source.length}`});res.end();return;}
   res.writeHead(range?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,
    ...(range?{'content-range':`bytes ${start}-${end}/${source.length}`}:{})});
   res.end(req.method==='HEAD'?undefined:source.subarray(start,end+1));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  process.env.HEARMEOUT_HLS_DIR=join(root,'hls');
  process.env.HEARMEOUT_XTREAM_BASE_URL=`http://127.0.0.1:${provider.address().port}`;
  process.env.HEARMEOUT_XTREAM_USERNAME='fixture-user';
  process.env.HEARMEOUT_XTREAM_PASSWORD='fixture-secret';
  process.env.WATCH_HLS_MAX_JOBS='1';
  console.log=(...args)=>{logs.push(args.map(String).join(' '));};
  host=createHearMeOutWebServer({databasePath:join(root,'rooms.sqlite'),spmtOrigin:'http://127.0.0.1:1',port:0});
  await host.listen();
  const streamId='episode-77-mp4',base=`http://127.0.0.1:${host.server.address().port}`;
  const indexUrl=new URL(`/api/watch/xtream/hls/${streamId}/index.m3u8`,base);
  await assert.rejects(stat(join(process.env.HEARMEOUT_HLS_DIR,streamId,'index.m3u8')),{code:'ENOENT'});

  // Four simultaneous cold viewers exposed the asynchronous registration race.
  const responses=await Promise.all(Array.from({length:4},()=>fetch(indexUrl)));
  const masters=[];
  for(const response of responses){assert.equal(response.status,200,await response.clone().text());masters.push(await response.text());}
  assert.ok(masters.every(body=>body.startsWith('#EXTM3U')));
  conversion=ensureXtreamHls(streamId);
  // This promise must settle on finite input; reconnect-at-EOF used to keep the
  // converter occupied forever. The test timeout is not a production deadline.
  await conversion;
  assert.equal(logs.filter(line=>line.includes('Starting HLS conversion')).length,1,'cold viewers share exactly one converter');
  assert.ok(acquisitions.length>=2,'real ffprobe and ffmpeg fetched the loopback source');

  const master=await (await fetch(indexUrl)).text();
  assert.doesNotMatch(master,/fixture-user|fixture-secret|https?:\/\//);
  const videoChild=master.split(/\r?\n/).find(line=>line&&!line.startsWith('#'));
  assert.ok(videoChild?.endsWith('.m3u8'));
  const playlistUrl=new URL(videoChild,indexUrl);
  const playlist=await (await fetch(playlistUrl)).text();
  assert.match(playlist,/#EXT-X-ENDLIST/,'finite VOD marks its completed playlist');
  assert.doesNotMatch(playlist,/fixture-user|fixture-secret|https?:\/\//);
  const videoSegment=playlist.split(/\r?\n/).find(line=>line&&!line.startsWith('#'));
  assert.ok(videoSegment?.endsWith('.ts'));
  const segmentUrl=new URL(videoSegment,playlistUrl),response=await fetch(segmentUrl);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp2t');
  const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>188);
  const local=join(root,'delivered.ts');await writeFile(local,bytes);
  const probe=JSON.parse((await command('ffprobe',['-v','error','-show_streams','-of','json',local],{timeout:10000})).stdout);
  assert.ok(probe.streams.some(stream=>stream.codec_type==='video'&&stream.codec_name==='h264'));
  // Audio is in a separate rendition; verify the generated ladder advertises it.
  const audioUri=/TYPE=AUDIO[^\r\n]*URI="([^"]+)"/.exec(master)?.[1];
  assert.ok(audioUri,'master advertises converted audio');
  const audioPlaylistUrl=new URL(audioUri,indexUrl);
  const audioPlaylist=await (await fetch(audioPlaylistUrl)).text();
  const audioSegment=audioPlaylist.split(/\r?\n/).find(line=>line&&!line.startsWith('#'));
  const audioResponse=await fetch(new URL(audioSegment,audioPlaylistUrl));assert.equal(audioResponse.status,200);
  const audioLocal=join(root,'delivered-audio.ts');await writeFile(audioLocal,Buffer.from(await audioResponse.arrayBuffer()));
  const audioProbe=JSON.parse((await command('ffprobe',['-v','error','-show_streams','-of','json',audioLocal],{timeout:10000})).stdout);
  assert.ok(audioProbe.streams.some(stream=>stream.codec_type==='audio'&&stream.codec_name==='aac'));
  const partial=await fetch(segmentUrl,{headers:{range:'bytes=1-188'}});
  assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),bytes.subarray(1,189));
 }finally{
  console.log=originalLog;
  await host?.close();
  if(provider){provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
  for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  await rm(root,{recursive:true,force:true});
 }
});
