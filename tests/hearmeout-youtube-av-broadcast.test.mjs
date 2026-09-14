import {mediaBinary} from '../scripts/test-media-binaries.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {HearMeOutRoomBroadcast} from '../apps/hearmeout/dist/room-broadcast.js';

const owner={tenantId:'youtube-av',userId:'owner',displayName:'Owner',roles:['admin']};

async function waitFor(read,check,ms=15000){const end=Date.now()+ms;let value;do{value=await read();if(check(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<end);assert.fail(JSON.stringify(value));}
function serveBytes(bytes,counter){return(req,res)=>{counter.count++;const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''),start=Number(range?.[1]??0),end=range?.[2]?Number(range[2]):bytes.length-1;res.writeHead(range?206:200,{'content-length':end-start+1,'accept-ranges':'bytes',...(range?{'content-range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(bytes.subarray(start,end+1));};}

test('separate YouTube video and audio inputs become one advancing music broadcast encoder',{timeout:30000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hmo-youtube-av-broadcast-')),videoFile=join(dir,'video.mp4'),audioFile=join(dir,'audio.m4a');let server,rooms,broadcast;
  try{
    execFileSync(mediaBinary('ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x90:r=25','-t','20','-an','-c:v','libx264','-preset','ultrafast','-g','50','-movflags','+faststart',videoFile],{timeout:15000});
    execFileSync(mediaBinary('ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','20','-vn','-c:a','aac','-b:a','96k',audioFile],{timeout:15000});
    const video=await readFile(videoFile),audio=await readFile(audioFile),videoReads={count:0},audioReads={count:0},videoToken='v'.repeat(43),audioToken='a'.repeat(43);
    server=createServer((req,res)=>{if(req.url===`/v1/media/public/${videoToken}`)return serveBytes(video,videoReads)(req,res);if(req.url===`/v1/media/public/${audioToken}`)return serveBytes(audio,audioReads)(req,res);res.statusCode=404;res.end();});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
    rooms=new SqliteHearMeOutRoomMediaRuntime(':memory:');rooms.createRoom(owner,{roomId:'room',name:'YouTube',privacy:'public',operationId:'create'});
    rooms.enqueue(owner,{roomId:'room',lane:'music',operationId:'play',item:{itemId:'abcdefghijk',type:'music',title:'Split YouTube source',source:'youtube',playbackUrl:`/v1/media/public/${videoToken}`,durationSeconds:20,metadata:{videoId:'abcdefghijk',audioPlaybackUrl:`/v1/media/public/${audioToken}`}}});
    broadcast=new HearMeOutRoomBroadcast(rooms,{ffmpegBinary:mediaBinary('ffmpeg'),ffprobeBinary:mediaBinary('ffprobe'),cachePath:join(dir,'feed'),spmtOrigin:origin});await broadcast.listen();
    await waitFor(()=>broadcast.status(),status=>status.active===1&&status.startedProcesses===1);
    const [cacheDir]=await waitFor(()=>readdir(join(dir,'feed')),entries=>entries.length===1),root=join(dir,'feed',cacheDir);
    const master=await waitFor(async()=>{try{return await readFile(join(root,'index.m3u8'),'utf8')}catch{return''}},body=>body.includes('#EXTM3U')&&body.includes('stream_video.m3u8')&&body.includes('TYPE=AUDIO'));
    assert.match(master,/stream_video\.m3u8/);assert.match(master,/TYPE=AUDIO/);
    await waitFor(()=>Promise.resolve({video:videoReads.count,audio:audioReads.count}),counts=>counts.video>=2&&counts.audio>=2);
    assert.equal(broadcast.status().startedProcesses,1,'one FFmpeg process owns both transport tracks');
    assert.equal(broadcast.status().active,1);assert.equal(rooms.getSession(owner.tenantId,'room','music').playback.status,'playing');
  }finally{await broadcast?.close();rooms?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(dir,{recursive:true,force:true});}
});
