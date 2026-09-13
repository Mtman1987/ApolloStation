import assert from 'node:assert/strict';

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
console.log(JSON.stringify({buildSha, origin, broadcasterConfigured:true, mediaWorkerReady:true, activityRoom:room.roomId, accountRequired:true, privateRoomsProtected:true}));
