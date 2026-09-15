import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {HearMeOutRoomBroadcast} from '../apps/hearmeout/dist/room-broadcast.js';

const session={schemaVersion:1,tenantId:'tenant',roomId:'main-broadcast',sessionId:'main-broadcast',lane:'movie',current:{requestId:'one',item:{itemId:'song',type:'music',title:'Song',source:'test',playbackUrl:'https://example.com/song'}},queue:[],playback:{status:'playing',position:0,updatedAt:new Date().toISOString(),muted:false,volume:100},revision:1};

test('broadcast readiness waits for a real variant segment instead of sending viewers to an empty HLS feed',t=>{
  const root=mkdtempSync(join(tmpdir(),'hmo-ready-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const runtime={getSession:()=>session,getBroadcastIdentity:()=>({instanceId:'instance'}),broadcastSessions:()=>[],claimBroadcast:()=>false,releaseBroadcast(){},finishBroadcastRequest(){}};
  const broadcast=new HearMeOutRoomBroadcast(runtime,{ffmpegBinary:'/bin/false',ffprobeBinary:'/bin/false',cachePath:root,spmtOrigin:'http://127.0.0.1'});
  const key=createHash('sha256').update(JSON.stringify([session.tenantId,session.roomId,session.lane,'instance'])).digest('hex'),signature=createHash('sha256').update(JSON.stringify([session.current.requestId,session.current.item.playbackUrl,session.playback.status,session.playback.position,session.playback.updatedAt])).digest('hex'),epoch='current-epoch',dir=join(root,key);mkdirSync(dir);broadcast.runs.set(key,{session,cacheKey:key,signature,owner:'test',process:{},retryAt:0,failed:false,started:1,outputEpoch:epoch});
  assert.equal(broadcast.ready(session.tenantId,session.roomId,session.lane),false);
  writeFileSync(join(dir,'index.m3u8'),'#EXTM3U\nstream_0.m3u8\n');
  writeFileSync(join(dir,'stream_0.m3u8'),'#EXTM3U\nstale-epoch_0_000001.ts\n');
  writeFileSync(join(dir,'stale-epoch_0_000001.ts'),'old song');
  assert.equal(broadcast.ready(session.tenantId,session.roomId,session.lane),false);
  writeFileSync(join(dir,'stream_0.m3u8'),'#EXTM3U\ncurrent-epoch_0_000001.ts\n');
  assert.equal(broadcast.ready(session.tenantId,session.roomId,session.lane),false);
  writeFileSync(join(dir,'current-epoch_0_000001.ts'),'media');
  assert.equal(broadcast.ready(session.tenantId,session.roomId,session.lane),true);
});
