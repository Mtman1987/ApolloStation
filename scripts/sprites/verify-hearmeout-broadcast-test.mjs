import assert from 'node:assert/strict';
import {deploymentRequest} from './deployment-request.mjs';
const origin=new URL(process.argv[2]).origin,buildSha=process.argv[3];
const request=(path,init,options)=>deploymentRequest(origin,path,init,options);
let health;
let healthFailure;const healthDeadline=Date.now()+5*60_000;
while(Date.now()<healthDeadline){
 try{const response=await request('/health/hearmeout',undefined,{attempts:1,timeoutMs:5000});assert.equal(response.status,200);health=await response.json();healthFailure=undefined;}
 catch(error){healthFailure=error;}
 if(health?.mediaWorker?.ready)break;await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!health?.mediaWorker?.ready&&healthFailure)throw new Error('HearMeOut health did not become reachable before the deployment deadline',{cause:healthFailure});
assert.equal(health.buildSha,buildSha);assert.equal(health.broadcast?.singleProgram,true);assert.equal(health.broadcast?.configured,true);assert.equal(health.mediaWorker?.ready,true);
assert.match(health.activityClientId,/^\d{5,30}$/);
const activityOrigin=`https://${health.activityClientId}.discordsays.com`;
// A Discord-origin request reaches HearMeOut but cannot invent a global player.
const activityRequest=await request('/api/watch/broadcast/requests',{method:'POST',headers:{origin:activityOrigin,'content-type':'application/json'},body:'{}'});
assert.equal(activityRequest.status,400,'Configured Discord requests must reach the broadcast route');
assert.equal((await activityRequest.json()).error,'Choose a watch party');
assert.equal((await request('/api/hearmeout/rooms',{method:'POST',headers:{origin:activityOrigin,'content-type':'application/json'},body:'{}'})).status,403);
const stationResponse=await request('/sandbox/health');assert.equal(stationResponse.status,200);
const station=await stationResponse.json();assert.equal(station.spmt?.runtimeMode,'sandbox');assert.equal(station.spmt?.usageLimitsEnforced,false,'Development media requests must not be stopped by a production plan allowance');
for(const path of ['/watch','/activity','/apps/hearmeout'])assert.equal((await request(path)).status,200);
assert.equal((await request('/api/watch/broadcast/state')).status,400,'A state read without a party cannot fall back to a global player');
assert.equal((await request('/api/hearmeout/rooms')).status,401,'Private room and host workspace access remains protected');
for(const alias of ['main-broadcast','discord-watch-room','discord-music-room']){
 const response=await request('/api/watch/sessions/'+alias+'/state');assert.equal(response.status,410,'Legacy shared player aliases stay retired');
}
assert.equal((await request('/api/watch/sessions/watch-room-anywhere-movie/state')).status,404,'Unknown parties cannot alias another room');
const directoryResponse=await request('/api/watch/broadcast/rooms');assert.equal(directoryResponse.status,200);const directory=await directoryResponse.json();
assert.ok(Array.isArray(directory.rooms));assert.equal(directory.rooms.some(room=>['main-broadcast','discord-watch-room','discord-music-room'].includes(room.roomId)),false,'No retired shared player appears in the directory');
const feeds=new Set();let playingState;
for(const room of directory.rooms){
 const response=await request('/api/watch/broadcast/state?roomId='+encodeURIComponent(room.roomId));assert.equal(response.status,200);const state=await response.json();assert.equal(state.sessionId,room.roomId);assert.ok(!feeds.has(state.broadcast.playbackUrl),'Each party has its own feed');feeds.add(state.broadcast.playbackUrl);if(!playingState&&state.playback.status==='playing'&&state.current)playingState=state;
}
if(origin==='http://127.0.0.1:8080'&&process.env.DEPLOY_ROLE==='release'&&playingState){
 let master;const feed=playingState.broadcast.playbackUrl;
 for(let attempt=0;attempt<45;attempt++){const response=await request(feed);if(response.status===200){master=await response.text();break;}await new Promise(resolve=>setTimeout(resolve,1000));}
 assert.match(master??'',/#EXTM3U/);assert.match(master,/stream_[A-Za-z0-9_-]+\.m3u8/,'The active room-owned broadcast contains playable media');
 const variant=master.split('\n').find(line=>line&&!line.startsWith('#'));assert.ok(variant);
 const path=new URL(variant,origin+feed).pathname,before=await(await request(path)).text(),starts=(await(await request('/health/hearmeout')).json()).broadcast.startedProcesses;
 await new Promise(resolve=>setTimeout(resolve,5000));
 assert.notEqual(await(await request(path)).text(),before);assert.equal((await(await request('/health/hearmeout')).json()).broadcast.startedProcesses,starts);assert.ok((await(await request('/health/hearmeout')).json()).broadcast.active>=1);
}
for(const entry of ['/watch','/activity']){const html=await(await request(entry)).text();assert.match(html,/id="party-lobby"/);assert.match(html,/id="party-create"/);assert.match(html,/Browse and watch any active party/);}
console.log(JSON.stringify({buildSha,origin,roomOwnedWatchParties:true,activeParties:directory.rooms.length,publicViewerEntry:true,mediaWorkerReady:true,discordRequestOriginAccepted:true,privateRoomAccessProtected:true,developmentUsageLimitsEnforced:station.spmt.usageLimitsEnforced,testUrl:origin+'/apps/hearmeout'}));
