import {readFileSync,realpathSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const root='/home/sprite/data/release',current='/home/sprite/apollo-release/current',expected='04dd2e99a058b4050a5c66f7459c0a1b8ae1a5c7';
const target=JSON.parse(readFileSync('/tmp/hmo-test-target.json','utf8'));
if(!target.ok||!target.selectedChannelWasEmpty||Date.now()-Date.parse(target.checkedAt)>10*60*1000||target.workerBridgeSha256!=='01f19336bb9e619a0d18941e76fa89974b487ddcfe1771b5ff0938c03a0a1dbd')throw Error('A fresh verified empty test channel is required');
if(realpathSync(current).split('/').at(-1)!==expected)throw Error('Release changed before verification');
const config=JSON.parse(readFileSync(root+'/hearmeout-cutover.json','utf8'));
process.env.HEARMEOUT_CONTROLLED_BRIDGE='1';process.env.HEARMEOUT_VOICE_BRIDGE_ORIGIN=config.workerOrigin;
await import(pathToFileURL(current+'/scripts/offline-network-guard.mjs'));
const load=p=>import(pathToFileURL(current+'/apps/hearmeout/dist/'+p));
const {SqliteHearMeOutRoomMediaRuntime}=await load('room-media-core.js');
const {SqliteHearMeOutVoiceBridgeStore,HearMeOutVoiceBridgeController}=await load('voice-bridge.js');
const {HttpHearMeOutVoiceBridgeWorker}=await load('legacy-worker-adapter.js');
const {hearMeOutProviderRoomName}=await load('room-identity.js');
const {HearMeOutLiveKitSigner,verifyHearMeOutLiveKitToken}=await load('livekit-signer.js');
const identities=new DatabaseSync(root+'/spmt-empty-catalog-sandbox.sqlite',{readOnly:true});
const users=identities.prepare('SELECT user_id,body FROM user_profiles WHERE username=?').all('mtman1987');
if(users.length!==1)throw Error('Existing owner is ambiguous');
const userId=users[0].user_id,profile=JSON.parse(users[0].body);
const tenant=identities.prepare("SELECT id FROM tenants WHERE id=? AND owner_user_id=? AND status='active'").get(config.tenantId,userId);identities.close();
if(!tenant||!profile.tenantIds?.includes(tenant.id))throw Error('Existing owner workspace does not match configuration');
const principal={tenantId:tenant.id,userId,displayName:profile.displayName||'MT',roles:['admin']};
const database=root+'/hearmeout-room-owner-canary.sqlite';
const rooms=new SqliteHearMeOutRoomMediaRuntime(database),store=new SqliteHearMeOutVoiceBridgeStore(database);
const worker=new HttpHearMeOutVoiceBridgeWorker({workerOrigin:config.workerOrigin,getAuthorization:()=>config.workerAuthorization,allowedTenantIds:[tenant.id],timeoutMs:60000});
const controller=new HearMeOutVoiceBridgeController(rooms,store,worker);
const roomId='apollo-verification-'+Date.now(),providerRoom=hearMeOutProviderRoomName(tenant.id,roomId);
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let created=false,attempted=false,stopped=false,removed=false,result={},failure;
const requireValue=(value,message)=>{if(!value)throw Error(message)};
try{
 const response=await fetch(config.workerOrigin+'/voice-bridge',{headers:{Authorization:config.workerAuthorization},redirect:'manual',signal:AbortSignal.timeout(15000)});
 const prior=response.ok?await response.json():{};requireValue(Array.isArray(prior.instances)&&prior.instances.length===0,'Worker became busy before Apollo test');
 rooms.createRoom(principal,{roomId,name:'Temporary migration verification',privacy:'private',operationId:roomId+':create'});created=true;
 await controller.setRoomOutbound(principal,roomId,false);await controller.setDiscordReceiveGain(principal,roomId,0.23);
 attempted=true;
 await controller.start(principal,{roomId,guildId:target.guildId,voiceChannelId:target.voiceChannelId});
 const started=(await controller.status(principal,roomId)).worker;
 requireValue(started.running===true&&started.roomId===providerRoom&&started.discordReceiveGain===0.23&&started.roomVoiceOutboundEnabled===false,'Provider startup did not match Apollo room/gain/privacy');
 const signer=new HearMeOutLiveKitSigner(config.livekitApiKey,config.livekitApiSecret);
 const grant=signer.sign({tenantId:tenant.id,roomId,roomName:providerRoom,participantIdentity:'migration-verification',ttlSeconds:60,canPublish:true,canSubscribe:true});
 requireValue(verifyHearMeOutLiveKitToken(grant.token,config.livekitApiSecret).video.room===started.roomId,'Browser and worker provider room names differ');
 await controller.setDiscordReceiveGain(principal,roomId,0.41);
 const twoWay=(await controller.setRoomOutbound(principal,roomId,true)).worker;
 requireValue((twoWay.status||twoWay).roomVoiceOutboundEnabled===true,'Two-way gate was not applied');
 await controller.setRoomOutbound(principal,roomId,false);
 await exec('sprite-env',['services','restart','apollo-sandbox'],{timeout:60000,maxBuffer:1024*1024});
 let health;
 for(let i=0;i<90;i++){try{const r=await fetch('http://127.0.0.1:3200/health/ready',{signal:AbortSignal.timeout(1000)});if(r.ok){health=await r.json();if(health.buildSha===expected&&health.voiceBridge?.configured&&health.voiceBridge.enabledRooms===1)break}}catch{}await sleep(1000)}
 requireValue(health?.buildSha===expected&&health.voiceBridge?.enabledRooms===1,'Configured server failed restart verification');
 const resumed=(await controller.status(principal,roomId)).worker;
 requireValue(resumed.running===true&&resumed.startedAt===started.startedAt&&resumed.discordReceiveGain===0.41&&resumed.roomVoiceOutboundEnabled===false,'Provider state did not survive Apollo restart');
 result={providerRoomIdentityMatched:true,liveKitGrantMatched:true,startupGain:0.23,updatedGain:0.41,twoWayGateVerified:true,listenOnlyGateVerified:true,providerSurvivedSupervisorRestart:true,duplicateStartAvoided:true};
}catch(error){failure=String(error.message||error).replace(/(?:Bearer|FlyV1)\s+\S+/g,'[REDACTED]')}
finally{
 if(created){
  try{
   if(attempted)await controller.stop(principal,roomId);
   await sleep(3000);stopped=(await worker.status({tenantId:tenant.id,roomId})).running===false;
   if(stopped){rooms.deleteRoom(principal,roomId,roomId+':delete');const cleanup=new DatabaseSync(database);cleanup.prepare('DELETE FROM hmo_voice_bridge WHERE tenant_id=? AND room_id=?').run(tenant.id,roomId);cleanup.close();removed=true;}
   else throw Error('Provider bridge remained running');
  }catch(error){failure=(failure?failure+'; ':'')+'Cleanup: '+String(error.message||error).replace(/(?:Bearer|FlyV1)\s+\S+/g,'[REDACTED]')}
 }
 store.close();rooms.close();rmSync('/tmp/hmo-test-target.json',{force:true});
}
const db=new DatabaseSync(database,{readOnly:true});const roomCount=db.prepare('SELECT COUNT(*) AS n FROM hmo_rooms').get().n,integrity=db.prepare('PRAGMA quick_check').get().quick_check;db.close();
const output={ok:!failure&&stopped&&removed,...result,bridgeStopped:stopped,temporaryRoomRemoved:removed,roomCount,integrity,humanAudioVerified:false,productionTrafficMoved:false,...(failure?{error:failure}:{})};
console.log(JSON.stringify(output));if(!output.ok)process.exitCode=1;
