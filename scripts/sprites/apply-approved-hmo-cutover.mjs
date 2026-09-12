import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, realpathSync, readdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const exec=promisify(execFile),root='/home/sprite/data/release',current='/home/sprite/apollo-release/current';
const expected='04dd2e99a058b4050a5c66f7459c0a1b8ae1a5c7';
const capsule='/tmp/hmo-approved-capsule.json';
if(realpathSync(current).split('/').at(-1)!==expected)throw Error('Deployed release changed; migration stopped');
if(existsSync(root+'/hearmeout-cutover.json'))throw Error('Cutover configuration already exists; inspect its receipt');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function service(action){await exec('sprite-env',['services',action,'apollo-sandbox'],{timeout:60000,maxBuffer:1024*1024});}
async function stopped(){
 for(let i=0;i<30;i++){
  const pids=readdirSync('/proc').filter(p=>/^\d+$/.test(p)).filter(p=>{try{return readFileSync('/proc/'+p+'/cmdline','utf8').includes('apps/hearmeout/dist/web-server.js')}catch{return false}});
  if(!pids.length)return;
  if(i===5)for(const pid of pids)try{process.kill(Number(pid),'SIGTERM')}catch{}
  await sleep(500);
 }
 throw Error('HearMeOut writer did not stop');
}
async function ready(){
 for(let i=0;i<90;i++){
  try{const r=await fetch('http://127.0.0.1:3200/health/ready',{signal:AbortSignal.timeout(1500)});if(r.ok){const h=await r.json();if(h.buildSha===expected&&h.voiceBridge?.configured===true&&h.voiceBridge.enabledRooms===0)return h}}catch{}
  await sleep(1000);
 }
 throw Error('Configured HearMeOut release did not become ready');
}
function inspect(){
 const identity=new DatabaseSync(root+'/spmt-empty-catalog-sandbox.sqlite',{readOnly:true});
 const rows=identity.prepare('SELECT user_id,body FROM user_profiles WHERE username=?').all('mtman1987');
 if(rows.length!==1)throw Error('Owner identity changed');
 const profile=JSON.parse(rows[0].body),userId=rows[0].user_id;
 const tenants=identity.prepare("SELECT id FROM tenants WHERE owner_user_id=? AND status='active'").all(userId).filter(t=>profile.tenantIds?.includes(t.id));identity.close();
 if(tenants.length!==1)throw Error('Owner workspace changed');
 const config=JSON.parse(readFileSync(root+'/hearmeout-cutover.json','utf8'));
 if(config.tenantId!==tenants[0].id)throw Error('Configured workspace differs from existing owner');
 const receipt=JSON.parse(readFileSync(root+'/recovery/hearmeout-cutover-receipt.json','utf8'));
 const stores={};
 for(const [name,path] of [['original','hearmeout-room-sandbox.sqlite'],['migrated','hearmeout-room-owner-canary.sqlite'],['recovery','recovery/hearmeout-before-cutover.sqlite']]){
  const db=new DatabaseSync(root+'/'+path,{readOnly:true});
  stores[name]={integrity:db.prepare('PRAGMA quick_check').get().quick_check,rooms:db.prepare('SELECT COUNT(*) AS n FROM hmo_rooms').get().n};
  if(name==='migrated'){
   const row=db.prepare('SELECT body FROM hmo_rooms WHERE tenant_id=? AND room_id=?').get(config.tenantId,'discord-activity');
   if(!row||JSON.parse(row.body).systemRoom!==true||JSON.parse(row.body).tenantId!==config.tenantId)throw Error('Canonical room is not in the existing owner workspace');
   if(receipt.ownerUserId!==userId||receipt.tenantId!==config.tenantId)throw Error('Migration ownership receipt differs from the existing owner');
   if(db.prepare('SELECT body FROM hmo_voice_bridge').all().some(r=>JSON.parse(r.body).enabled))throw Error('A bridge started before the explicit live test');
  }
  db.close();
 }
 if(Object.values(stores).some(s=>s.integrity!=='ok')||stores.original.rooms!==receipt.beforeRooms||stores.recovery.rooms!==receipt.beforeRooms||stores.migrated.rooms!==receipt.afterRooms)throw Error('Room recovery reconciliation failed');
 return {stores,existingOwnerPreserved:true,existingWorkspacePreserved:true,importedQueueItems:receipt.importedQueueItems,playbackState:receipt.playbackState,sourceDatabaseSha256:receipt.sourceDatabaseSha256,blueRecovery:receipt.blueRecovery.snapshot};
}
let paused=false;
try{
 await service('stop');paused=true;await stopped();
 const {installHearMeOutCutover}=await import(pathToFileURL(current+'/scripts/sprites/install-hearmeout-cutover.mjs'));
 const installed=await installHearMeOutCutover(capsule,root);console.log(JSON.stringify({installation:installed}));
 await service('start');paused=false;const first=await ready();const firstState=inspect();
 await service('stop');paused=true;await stopped();await service('start');paused=false;
 const restarted=await ready(),afterRestart=inspect();
 if(JSON.stringify(firstState)!==JSON.stringify(afterRestart))throw Error('Migrated room state changed across restart');
 console.log(JSON.stringify({ok:true,release:expected,firstHealth:first,restartedHealth:restarted,restartVerified:true,...afterRestart,productionTrafficMoved:false}));
 rmSync(capsule,{force:true});
}catch(error){
 console.error(String(error.message||error).replace(/(?:Bearer|FlyV1)\s+\S+/g,'[REDACTED]'));process.exitCode=1;
}finally{if(paused)try{await service('start')}catch{console.error('Supervisor restart failed; recovery required');process.exitCode=1;}}
