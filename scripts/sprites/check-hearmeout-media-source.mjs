import { lookup } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HearMeOutBroadcastEgress } from '../../apps/hearmeout/dist/broadcast-egress.js';
import { HEARMEOUT_BROADCAST_PROTOCOLS } from '../../apps/hearmeout/dist/room-broadcast.js';

// A fixed, public test asset: diagnostics never include a user's signed source
// URL, provider credential or room contents. Run before switching the release.
const source='https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const proxy=new HearMeOutBroadcastEgress(undefined,error=>console.error('Media proxy preflight:',String(error?.message??error)));
let output;
try {
  console.log('Media source DNS:',JSON.stringify(await lookup('storage.googleapis.com',{all:true})));
  const origin=await proxy.listen();
  const result=await promisify(execFile)('/home/sprite/runtime/ffmpeg-b6.1.1/ffprobe',['-v','error','-protocol_whitelist',HEARMEOUT_BROADCAST_PROTOCOLS,'-rw_timeout','10000000','-show_streams','-of','json',source],{env:{PATH:process.env.PATH,http_proxy:origin,https_proxy:origin,no_proxy:''},timeout:20000,maxBuffer:1024*1024});
  console.log('Media source streams:',JSON.stringify(JSON.parse(result.stdout).streams?.map(stream=>({type:stream.codec_type,codec:stream.codec_name}))));
  output=await mkdtemp(join(tmpdir(),'hmo-source-preflight-'));
  await promisify(execFile)('/home/sprite/runtime/ffmpeg-b6.1.1/ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-threads','2','-protocol_whitelist',HEARMEOUT_BROADCAST_PROTOCOLS,'-rw_timeout','10000000','-i',source,'-t','6','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-f','hls','-hls_time','2',join(output,'index.m3u8')],{env:{PATH:process.env.PATH,http_proxy:origin,https_proxy:origin,no_proxy:''},timeout:30000,maxBuffer:1024*1024});
  if(!(await readFile(join(output,'index.m3u8'),'utf8')).includes('#EXTM3U'))throw Error('Pinned FFmpeg produced no HLS manifest');
  console.log('PASS: pinned FFprobe and FFmpeg read the external HTTPS source through the controlled proxy');
} catch(error) {
  console.error('Fixed media source preflight failed:',String(error?.stderr??error?.message??error));
  process.exitCode=1;
} finally { await proxy.close(); if(output)await rm(output,{recursive:true,force:true}); }
