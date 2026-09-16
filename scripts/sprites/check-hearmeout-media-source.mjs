import { lookup } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HearMeOutBroadcastEgress } from '../../apps/hearmeout/dist/broadcast-egress.js';
import { HEARMEOUT_BROADCAST_PROTOCOLS } from '../../apps/hearmeout/dist/room-broadcast.js';
import { HEARMEOUT_TEST_SOURCE as source } from './hearmeout-test-source.mjs';

// A fixed, public test asset: diagnostics never include a user's signed source
// URL, provider credential or room contents. Run before switching the release.
const proxy=new HearMeOutBroadcastEgress(undefined,error=>console.error('Media proxy preflight:',String(error?.message??error)));
try {
  console.log('Media source DNS:',JSON.stringify(await lookup(new URL(source).hostname,{all:true})));
  const origin=await proxy.listen();
  // Only the fixed, credential-free asset is diagnosed here. A bounded range
  // reveals an upstream XML/HTTP rejection without logging user media URLs.
  const request=await promisify(execFile)('/usr/bin/curl',['--silent','--show-error','--proxy',origin,'--noproxy','','--range','0-1023','--max-time','15','--max-filesize','4096','--include',source],{env:{PATH:process.env.PATH},timeout:20000,maxBuffer:16384}).catch(error=>({stdout:error.stdout??'',stderr:error.stderr??''}));
  const httpResponse=String(request.stdout);
  console.log('Fixed source HTTP response:',/HTTP\/[^ ]+ [45]\d\d/.test(httpResponse)?httpResponse.slice(0,4096):httpResponse.split('\r\n\r\n').filter(part=>part.startsWith('HTTP/')).join('\n').slice(0,4096));
  if(request.stderr)console.log('Fixed source HTTP error:',request.stderr);
  const result=await promisify(execFile)('/home/sprite/runtime/ffmpeg-btbn-8.1.2-g1a748fe2cd/ffprobe',['-v','error','-protocol_whitelist',HEARMEOUT_BROADCAST_PROTOCOLS,'-rw_timeout','10000000','-show_streams','-of','json',source],{env:{PATH:process.env.PATH,http_proxy:origin,https_proxy:origin,no_proxy:''},timeout:20000,maxBuffer:1024*1024});
  console.log('Media source streams:',JSON.stringify(JSON.parse(result.stdout).streams?.map(stream=>({type:stream.codec_type,codec:stream.codec_name}))));
  await promisify(execFile)('/home/sprite/runtime/ffmpeg-btbn-8.1.2-g1a748fe2cd/ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-threads','2','-protocol_whitelist',HEARMEOUT_BROADCAST_PROTOCOLS,'-rw_timeout','10000000','-i',source,'-t','6','-map','0:v:0?','-map','0:a:0?','-f','null','-'],{env:{PATH:process.env.PATH,http_proxy:origin,https_proxy:origin,no_proxy:''},timeout:30000,maxBuffer:1024*1024});
  console.log('PASS: pinned FFprobe and FFmpeg read and decode the external HTTPS source through the controlled proxy');
} catch(error) {
  console.error('Fixed media source preflight failed:',String(error?.stderr??error?.message??error));
  process.exitCode=1;
} finally { await proxy.close(); }
