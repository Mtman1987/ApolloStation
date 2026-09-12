import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
const root='/home/sprite/data/release';
const db=new DatabaseSync(root+'/spmt-empty-catalog-sandbox.sqlite',{readOnly:true});
const profiles=db.prepare('SELECT user_id,body FROM user_profiles WHERE username=?').all('mtman1987');
let owner={profiles:profiles.length,activeTenants:0};
if(profiles.length===1){const p=JSON.parse(profiles[0].body);owner.activeTenants=db.prepare("SELECT id FROM tenants WHERE owner_user_id=? AND status='active'").all(profiles[0].user_id).filter(t=>p.tenantIds?.includes(t.id)).length;}
db.close();
const path=root+'/hearmeout-room-sandbox.sqlite';
let roomStore={present:existsSync(path)};
if(roomStore.present){const h=new DatabaseSync(path,{readOnly:true});roomStore.bytes=statSync(path).size;roomStore.integrity=h.prepare('PRAGMA quick_check').get().quick_check;roomStore.tables=h.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);if(roomStore.tables.includes('hmo_rooms'))roomStore.rooms=h.prepare('SELECT COUNT(*) AS n FROM hmo_rooms').get().n;h.close();}
const names=['HMO_WORKER_SHARED_SECRET','HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION','HEARMEOUT_VOICE_BRIDGE_ORIGIN','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'];
const services=[];
for(const pid of readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{const cmd=readFileSync('/proc/'+pid+'/cmdline','utf8');if(!cmd.includes('hearmeout/dist/web-server'))continue;const env=Object.fromEntries(readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));services.push({mode:env.SPMT_OUTBOUND_MODE,configuration:Object.fromEntries(names.map(n=>[n,Boolean(env[n])]))});}catch{}}
console.log(JSON.stringify({release:realpathSync('/home/sprite/apollo-release/current').split('/').at(-1),owner,roomStore,services,privateConfigurationFiles:readdirSync(root).filter(n=>/^(?:hearmeout|livekit|hmo-)/.test(n)).map(n=>({name:n,bytes:statSync(root+'/'+n).size}))}));
