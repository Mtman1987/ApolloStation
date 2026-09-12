import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,existsSync,realpathSync,readdirSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

// The owner explicitly requested deletion of the hidden rooms and a fresh room list.
// Restrict this one-time reset to the two known Apollo HMO stores; retain recovery,
// shared identity, provider credentials, and the separate Blue production database.
const root='/home/sprite/data/release',current='/home/sprite/apollo-release/current';
const expected='04dd2e99a058b4050a5c66f7459c0a1b8ae1a5c7';
const receiptPath=root+'/recovery/hearmeout-owner-room-reset-20260912.json';
const stores=[['active','hearmeout-room-owner-canary.sqlite',12],['fallback','hearmeout-room-sandbox.sqlite',11]];
const tables=['hmo_room_chat','hmo_room_personas','hmo_persona_rooms','hmo_assistant_requests','hmo_voice_bridge','hmo_media_sessions','hmo_room_presence','hmo_room_restrictions','hmo_room_admissions','hmo_room_invitations','hmo_room_access','hmo_room_members','hmo_operations','hmo_rooms'];
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=value=>createHash('sha256').update(value).digest('hex');
const configBytes=readFileSync(root+'/hearmeout-cutover.json'),config=JSON.parse(configBytes);
if(realpathSync(current).split('/').at(-1)!==expected)throw Error('Deployed release changed before reset');
const identity=new DatabaseSync(root+'/spmt-empty-catalog-sandbox.sqlite',{readOnly:true});
const owners=identity.prepare('SELECT user_id,body FROM user_profiles WHERE username=?').all('mtman1987');
if(owners.length!==1)throw Error('Existing owner is ambiguous');
const userId=owners[0].user_id,profile=JSON.parse(owners[0].body);
const tenant=identity.prepare("SELECT id FROM tenants WHERE id=? AND owner_user_id=? AND status='active'").get(config.tenantId,userId);
if(!tenant||!profile.tenantIds?.includes(tenant.id))throw Error('Configured owner workspace does not match');
const identitySignature=()=>hash(JSON.stringify([identity.prepare('SELECT * FROM user_profiles ORDER BY user_id').all(),identity.prepare('SELECT * FROM tenants ORDER BY id').all()]));
const beforeIdentity=identitySignature();
const principal={tenantId:tenant.id,userId,displayName:profile.displayName||'MT',roles:['admin']};

function inspect(path){
 const db=new DatabaseSync(root+'/'+path,{readOnly:true});
 try{
  const present=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'hmo_%' ORDER BY name").all().map(r=>r.name);
  if(present.some(t=>!tables.includes(t)&&t!=='hmo_migration_receipt'))throw Error('Unexpected HMO table requires inspection');
  const rows=db.prepare('SELECT tenant_id,body FROM hmo_rooms').all().map(r=>({...JSON.parse(r.body),storedTenant:r.tenant_id}));
  const expired=r=>Boolean(r.expiresAt&&Date.parse(r.expiresAt)<=Date.now());
  const counts=Object.fromEntries(present.filter(t=>tables.includes(t)).map(t=>[t,db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
  const enabled=present.includes('hmo_voice_bridge')?db.prepare('SELECT body FROM hmo_voice_bridge').all().filter(r=>JSON.parse(r.body).enabled).length:0;
  return {rooms:rows.length,expired:rows.filter(expired).length,ownerWorkspace:rows.filter(r=>r.storedTenant===tenant.id).length,visibleToOwner:rows.filter(r=>r.storedTenant===tenant.id&&!expired(r)).length,otherWorkspace:rows.filter(r=>r.storedTenant!==tenant.id).length,systemRooms:rows.filter(r=>r.systemRoom).length,enabledBridges:enabled,counts,integrity:db.prepare('PRAGMA quick_check').get().quick_check};
 }finally{db.close()}
}
async function service(action){await exec('sprite-env',['services',action,'apollo-sandbox'],{timeout:60000,maxBuffer:1024*1024})}
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
 for(let i=0;i<75;i++){
  try{const r=await fetch('http://127.0.0.1:3200/health/ready',{signal:AbortSignal.timeout(1500)});if(r.ok){const h=await r.json();if(h.buildSha===expected&&h.voiceBridge?.configured&&h.voiceBridge.enabledRooms===0)return h}}catch{}
  await sleep(1000);
 }
 throw Error('Configured release did not become ready and disconnected');
}
async function verify(){
 const health=await ready(),state=Object.fromEntries(stores.map(([name,path])=>[name,inspect(path)]));
 if(Object.values(state).some(s=>s.rooms!==0||s.integrity!=='ok'||Object.values(s.counts).some(n=>n!==0)))throw Error('Room reset verification failed');
 const {SqliteHearMeOutRoomMediaRuntime}=await import(pathToFileURL(current+'/apps/hearmeout/dist/room-media-core.js'));
 const runtime=new SqliteHearMeOutRoomMediaRuntime(root+'/'+stores[0][1]);
 let visible;try{visible=runtime.listRooms(principal).length}finally{runtime.close()}
 if(visible!==0||hash(readFileSync(root+'/hearmeout-cutover.json'))!==hash(configBytes)||identitySignature()!==beforeIdentity)throw Error('Owner identity, credentials, or visible room list changed unexpectedly');
 return {health,stores:state,visibleRooms:visible,existingIdentityPreserved:true,providerConfigurationPreserved:true};
}
let paused=false;
try{
 if(existsSync(receiptPath)){
  const prior=JSON.parse(readFileSync(receiptPath,'utf8'));
  if(!prior.ok)throw Error('An incomplete reset receipt requires inspection');
  console.log(JSON.stringify({ok:true,alreadyReset:true,...await verify()}));
 }else{
  await ready();
  await service('stop');paused=true;await stopped();
  const before=Object.fromEntries(stores.map(([name,path])=>[name,inspect(path)]));
  for(const [name,,count] of stores)if(before[name].rooms!==count||before[name].enabledBridges!==0||before[name].integrity!=='ok')throw Error('Saved rooms changed since owner approval; reset stopped');
  console.log(JSON.stringify({inspection:before}));
  // VACUUM INTO creates consistent recovery copies before either store changes.
  for(const [name,path] of stores){
   const backup=root+'/recovery/hearmeout-before-owner-reset-20260912-'+name+'.sqlite';
   if(existsSync(backup))throw Error('Reset recovery copy already exists; inspect prior attempt');
   const db=new DatabaseSync(root+'/'+path);try{db.prepare('VACUUM INTO ?').run(backup)}finally{db.close()}
   chmodSync(backup,0o600);
   const check=new DatabaseSync(backup,{readOnly:true});try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok'||check.prepare('SELECT COUNT(*) AS n FROM hmo_rooms').get().n!==before[name].rooms)throw Error('Reset recovery copy verification failed')}finally{check.close()}
  }
  for(const [,path] of stores){
   const db=new DatabaseSync(root+'/'+path,{timeout:5000});
   try{
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    for(const table of tables)if(present.has(table))db.exec(`DELETE FROM "${table}"`);
    db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
   }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}finally{db.close()}
   chmodSync(root+'/'+path,0o600);
  }
  await service('start');paused=false;await verify();
  await service('stop');paused=true;await stopped();await service('start');paused=false;
  const after=await verify();
  const receipt={ok:true,completedAt:new Date().toISOString(),scope:'owner-requested Apollo HearMeOut room reset',before,...after,restartVerified:true,recoveryCopiesPreserved:true,productionTrafficMoved:false,blueDatabaseChanged:false};
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(receipt));
 }
}catch(error){console.error(String(error.message||error).replace(/(?:Bearer|FlyV1)\s+\S+/g,'[REDACTED]'));process.exitCode=1}
finally{identity.close();if(paused)try{await service('start')}catch{console.error('Supervisor restart failed; recovery required');process.exitCode=1}}
