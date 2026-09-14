import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {createIntegratedSpaceMountainWebHost} from '../apps/spacemountain-web/dist/integrated-server.js';

test('the configured Discord proxy can request the same public broadcast through actual Apollo ingress',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hmo-discord-origin-')),clientId='1279582181768957963',discordOrigin=`https://${clientId}.discordsays.com`,resolved=[];
 const spmt=createServer((req,res)=>{res.writeHead(401,{'content-type':'application/json'});res.end('{"error":"unauthorized"}');});
 let hmo,ingress,unconfigured;
 try{
  await new Promise(resolve=>spmt.listen(0,'127.0.0.1',resolve));const spmtOrigin=`http://127.0.0.1:${spmt.address().port}`;
  hmo=createHearMeOutWebServer({spmtOrigin,port:0,databasePath:join(root,'rooms.sqlite'),singleBroadcast:{tenantId:'owner-tenant',executionUserId:'owner'},activity:{tenantId:'owner-tenant',clientId},suiteMediaResolver:{async resolve(input){resolved.push(input);return{itemId:'test-video',title:input.query,type:input.lane,source:'fixture',playbackUrl:'https://media.example/test.mp4',durationSeconds:210};}}});
  await hmo.listen();const options={spmtOrigin,host:'127.0.0.1',port:0,greenAppOrigins:{hearmeout:`http://127.0.0.1:${hmo.server.address().port}`}};
  ingress=createIntegratedSpaceMountainWebHost({...options,hearMeOutActivityClientId:clientId});await ingress.listen();
  const base=`http://127.0.0.1:${ingress.server.address().port}`;
  const entry=await fetch(base+'/?frame_id=discord-window',{headers:{'x-forwarded-proto':'https'}});
  assert.equal(entry.status,200);assert.match(await entry.text(),/Music or movie request/);
  const setCookie=entry.headers.get('set-cookie');assert.match(setCookie,/SameSite=None; Secure; Partitioned/);const cookie=setCookie.split(';')[0];
  const request=(origin,path='/api/watch/broadcast/requests',method='POST')=>fetch(base+path,{method,headers:{origin,cookie,'content-type':'application/json','idempotency-key':'discord-request'},body:JSON.stringify({query:'A video',lane:'movie'})});
  const accepted=await request(discordOrigin);assert.equal(accepted.status,201,await accepted.clone().text());const state=await accepted.json();assert.equal(state.sessionId,'main-broadcast');assert.match(state.current.requestedBy.userId,/^guest:/);
  assert.equal((await request(discordOrigin)).status,201);assert.equal(resolved.length,1);
  assert.equal((await(await fetch(base+'/api/watch/broadcast/state')).json()).current.requestId,state.current.requestId);
  for(const origin of ['https://other.discordsays.com',`http://${clientId}.discordsays.com`,discordOrigin+'.example',discordOrigin+':444','https://discord.com','null'])assert.equal((await request(origin)).status,403,origin);
  for(const path of ['/api/hearmeout/rooms','/v1/apps','/sandbox/auth/register','/api/watch/broadcast/requests/extra'])assert.equal((await request(discordOrigin,path)).status,403,path);
  assert.equal((await request(discordOrigin,undefined,'DELETE')).status,403);
  assert.equal(resolved.length,1,'Rejected cross-origin requests never reach the resolver');
  const invalid=await fetch(base+'/api/watch/broadcast/requests',{method:'POST',headers:{origin:discordOrigin,'content-type':'application/json'},body:'{}'});
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'Enter a video title or link');assert.equal(resolved.length,1);
  const native=await fetch(base+'/api/watch/broadcast/requests',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({query:'A song',lane:'music'})});assert.equal(native.status,201);assert.equal(resolved[1].lane,'music');
  unconfigured=createIntegratedSpaceMountainWebHost(options);await unconfigured.listen();
  assert.equal((await fetch(`http://127.0.0.1:${unconfigured.server.address().port}/api/watch/broadcast/requests`,{method:'POST',headers:{origin:discordOrigin},body:'{}'})).status,403);
 }finally{await unconfigured?.close();await ingress?.close();await hmo?.close();spmt.closeAllConnections();await new Promise(resolve=>spmt.close(resolve));await rm(root,{recursive:true,force:true});}
});
