import assert from 'node:assert/strict';
import { HEARMEOUT_TEST_SOURCE, HEARMEOUT_TEST_TITLE } from './hearmeout-test-source.mjs';

const origin = new URL(process.argv[2]).origin, buildSha = process.argv[3];
async function request(path) { return fetch(origin + path, {redirect:'manual', signal:AbortSignal.timeout(15000)}); }
let health;
for (let attempt = 0; attempt < 30; attempt++) {
  const response = await request('/health/hearmeout');
  assert.equal(response.status, 200, 'HMO health must be reachable without a Sprite login');
  health = await response.json();
  if (health.mediaWorker?.ready) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.equal(health.buildSha, buildSha);
assert.equal(health.broadcast?.configured, true, 'Room broadcaster must be configured');
assert.equal(health.mediaWorker?.ready, true, 'Assigned media worker must hold a current ready lease');
assert.equal((await request('/apps/hearmeout')).status, 200);
const activity = await request('/activity?sessionId=discord-watch-room');
assert.equal(activity.status, 200);
assert.match(await activity.text(), /HearMeOut Discord Activity/);
const state = await request('/api/watch/sessions/discord-watch-room/state');
assert.equal(state.status, 200);
const room = await state.json();
assert.equal(room.roomId, 'discord-activity');
assert.equal(room.broadcast?.configured, true);
assert.equal((await request('/api/hearmeout/rooms')).status, 401, 'Native room listing still requires an Apollo account');
assert.equal((await request('/api/hearmeout/rooms/discord-activity/broadcast/movie/index.m3u8')).status, 401, 'Native feed still requires an Apollo account');
const privateAlias = await request('/api/watch/sessions/private-room/state');
assert.equal(privateAlias.status, 403, 'Activity cannot select an arbitrary private room');
// On the protected Sprite, prove that the deployed encoder can read a real
// public video and advance its feed. Public verification only reads the result.
if (origin === 'http://127.0.0.1:8080' && process.env.DEPLOY_ROLE === 'release') {
  const {readFile} = await import('node:fs/promises');
  const {SqliteHearMeOutRoomMediaRuntime} = await import('../../apps/hearmeout/dist/room-media-core.js');
  const config = JSON.parse(await readFile('/home/sprite/data/release/hearmeout-cutover.json','utf8'));
  const rooms = new SqliteHearMeOutRoomMediaRuntime('/home/sprite/data/release/hearmeout-room-owner-canary.sqlite');
  const current = rooms.getSession(config.tenantId,'discord-activity','movie');
  let probeRequest;
  const principal = {tenantId:config.tenantId,userId:'discord-activity',displayName:'Discord Activity',roles:['admin']};
  try {
    // Never replace or clear a person's existing selection.
    if (!current.current && current.queue.length === 0) {
      const queued = rooms.enqueue(principal,{roomId:'discord-activity',lane:'movie',operationId:'deployment-broadcast:'+buildSha,item:{itemId:'deployment-broadcast:'+buildSha,type:'movie',title:HEARMEOUT_TEST_TITLE,source:'deployment-check',playbackUrl:HEARMEOUT_TEST_SOURCE}});
      probeRequest = queued.current?.requestId;
    }
    if (probeRequest || current.playback.status === 'playing') {
      const feed = '/api/watch/sessions/discord-watch-room/broadcast/index.m3u8';
      let master;
      for (let attempt=0;attempt<45;attempt++) {
        const response=await request(feed);
        if(response.status===200){master=await response.text();break;}
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      assert.match(master ?? '',/#EXTM3U/,'The deployed encoder must produce a playable HLS manifest');
      assert.match(master,/stream_video\.m3u8/,'The movie broadcast must contain actual video');
      const variant=master.split('\n').find(line=>line&&!line.startsWith('#'));
      assert.ok(variant);
      const path=new URL(variant,origin+feed).pathname;
      const before=await (await request(path)).text();
      const starts=(await (await request('/health/hearmeout')).json()).broadcast.startedProcesses;
      await new Promise(resolve=>setTimeout(resolve,5000));
      assert.notEqual(await (await request(path)).text(),before,'Broadcast must advance without any viewer windows');
      assert.equal((await (await request('/health/hearmeout')).json()).broadcast.startedProcesses,starts,'One encoder must remain the source');
      console.log('PASS: deployed external video produces one advancing room broadcast with zero viewer windows');
    }
  } finally {
    if(probeRequest && rooms.getSession(config.tenantId,'discord-activity','movie').current?.requestId===probeRequest)
      rooms.control(principal,{roomId:'discord-activity',lane:'movie',action:'next',expectedRequestId:probeRequest,operationId:'deployment-broadcast-finish:'+buildSha});
    rooms.close();
  }
}
console.log(JSON.stringify({buildSha, origin, broadcasterConfigured:true, mediaWorkerReady:true, activityRoom:room.roomId, accountRequired:true, privateRoomsProtected:true}));
