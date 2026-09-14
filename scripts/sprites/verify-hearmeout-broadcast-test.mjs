import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]).origin,buildSha=process.argv[3];
async function request(path,init){return fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(15000),...init});}
let health;
for(let attempt=0;attempt<30;attempt++){
 const response=await request('/health/hearmeout');assert.equal(response.status,200);health=await response.json();
 if(health.mediaWorker?.ready)break;await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.equal(health.buildSha,buildSha);assert.equal(health.broadcast?.singleProgram,true);assert.equal(health.broadcast?.configured,true);assert.equal(health.mediaWorker?.ready,true);
for(const path of ['/watch','/activity?roomId=any-room','/apps/hearmeout'])assert.equal((await request(path)).status,200);
const stateResponse=await request('/api/watch/broadcast/state');assert.equal(stateResponse.status,200);
let state=await stateResponse.json();const cookie=stateResponse.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
assert.equal(state.sessionId,'main-broadcast');
assert.equal((await request('/api/hearmeout/rooms')).status,401,'Private room and host workspace access remains protected');
if(origin==='http://127.0.0.1:8080'&&process.env.DEPLOY_ROLE==='release'){
 if(state.playback.status==='playing'){
  let master;const feed='/api/watch/broadcast/index.m3u8';
  for(let attempt=0;attempt<45;attempt++){const response=await request(feed);if(response.status===200){master=await response.text();break;}await new Promise(resolve=>setTimeout(resolve,1000));}
  assert.match(master??'',/#EXTM3U/);assert.match(master,/stream_[A-Za-z0-9_-]+\.m3u8/,'The requested broadcast contains playable media');
  const variant=master.split('\n').find(line=>line&&!line.startsWith('#'));assert.ok(variant);
  const path=new URL(variant,origin+feed).pathname,before=await(await request(path)).text(),starts=(await(await request('/health/hearmeout')).json()).broadcast.startedProcesses;
  await new Promise(resolve=>setTimeout(resolve,5000));
  assert.notEqual(await(await request(path)).text(),before);assert.equal((await(await request('/health/hearmeout')).json()).broadcast.startedProcesses,starts);
  assert.equal((await(await request('/health/hearmeout')).json()).broadcast.active,1);
  console.log('PASS: one independent video broadcast advances with no viewing windows or room requirement');
 }
}
const canonical=await(await request('/api/watch/broadcast/state')).json();
for(const alias of ['discord-watch-room','discord-music-room','watch-room-anywhere-movie']){
 const window=await(await request('/api/watch/sessions/'+alias+'/state')).json();
 assert.equal(window.sessionId,canonical.sessionId);assert.equal(window.broadcast.playbackUrl,canonical.broadcast.playbackUrl);
}
console.log(JSON.stringify({buildSha,origin,singleBroadcast:true,publicViewerEntry:true,mediaWorkerReady:true,privateRoomAccessProtected:true,playbackStatus:canonical.playback.status,queuedRequests:canonical.queue.length,testUrl:origin+'/apps/hearmeout'}));
