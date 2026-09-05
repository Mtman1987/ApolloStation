import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {SpmtClient} from '../packages/sdk/dist/index.js';
import {CompanionExecutionWorker} from '../apps/companion/dist/execution-worker.js';
import {SqliteCompanionDeviceRelay} from '../apps/companion/dist/device-relay.js';
import {CompanionObsWebSocket} from '../apps/companion/dist/obs-adapter.js';

const args=new Map();for(let index=2;index<process.argv.length;index+=2){const name=process.argv[index],value=process.argv[index+1];if(!['--origin','--pair-code','--state','--obs-url'].includes(name)||!value)throw new Error('Use --origin, --pair-code, --state and --obs-url with values');args.set(name,value)}
const statePath=resolve(args.get('--state')??resolve(homedir(),'.spmt','companion-obs.json'));
function checkedOrigin(value){const url=new URL(value);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('SPMT origin must be HTTPS or local development HTTP');return url.origin}
let settings;
if(args.has('--pair-code')){
  if(existsSync(statePath))throw new Error('This state file is already paired. Use a separate --state file to pair another device.');
  const origin=checkedOrigin(args.get('--origin')??'https://spmt.live');let code=args.get('--pair-code');if(code.startsWith('spmt-companion:')){const url=new URL(code);if(url.hostname!=='pair')throw new Error('Use the pairing link issued by Devices');code=url.searchParams.get('code')}
  if(!code||code.length>512)throw new Error('The one-time pairing code is invalid');
  const paired=await new SpmtClient({baseUrl:origin,appId:'companion'}).exchangeDeviceBootstrap(code);
  settings={schemaVersion:1,origin,serviceId:paired.serviceId,credential:paired.credential,device:paired.device};
  mkdirSync(dirname(statePath),{recursive:true,mode:0o700});const temporary=statePath+'.tmp';writeFileSync(temporary,JSON.stringify(settings,null,2),{mode:0o600,flag:'wx'});renameSync(temporary,statePath);chmodSync(statePath,0o600);
}else{if(!existsSync(statePath))throw new Error('Create a pairing code on StreamWeaver’s Devices page, then start once with --pair-code');try{settings=JSON.parse(readFileSync(statePath,'utf8'))}catch{throw new Error('The saved Companion pairing could not be read; restore its valid state file.')}}
const origin=checkedOrigin(settings.origin),device=settings.device;if(settings.schemaVersion!==1||!device?.tenantId||!device?.deviceId||settings.serviceId!==`companion:${device.deviceId}`||typeof settings.credential!=='string')throw new Error('The saved Companion pairing is invalid');if(args.has('--origin')&&checkedOrigin(args.get('--origin'))!==origin)throw new Error('The origin differs from this device’s saved pairing');
let cached;
const getAccessToken=async()=>{if(cached&&cached.until>Date.now()+60000)return cached.token;const response=await fetch(origin+'/v1/auth/service-token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({serviceId:settings.serviceId,credential:settings.credential}),redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error(`Companion authentication failed (${response.status}); check the device pairing`);const result=await response.json();if(typeof result.accessToken!=='string'||!Number.isFinite(Date.parse(result.accessExpiresAt)))throw new Error('Companion authentication returned an invalid session');cached={token:result.accessToken,until:Date.parse(result.accessExpiresAt)};return cached.token};
const client=new SpmtClient({baseUrl:origin,appId:'companion',getAccessToken}),relay=new SqliteCompanionDeviceRelay(statePath+'.sqlite'),obs=new CompanionObsWebSocket({url:args.get('--obs-url')??'ws://127.0.0.1:4455',password:process.env.OBS_PASSWORD});
relay.pairDevice({tenantId:device.tenantId,appId:'spmt',scopes:['devices:pair']},{deviceId:device.deviceId,name:device.name,capabilities:device.capabilities.filter(capability=>['obs.scene','media.playback'].includes(capability)),pairedAt:device.pairedAt});
const worker=new CompanionExecutionWorker(client,relay,obs,{workerId:device.deviceId,tenantId:device.tenantId,deviceId:device.deviceId}),controller=new AbortController(),startedAt=new Date().toISOString();let reportAt=0;
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
console.log(`Companion ${device.name} is connecting to local OBS.`);
try{while(!controller.signal.aborted){if(Date.now()>=reportAt){await obs.request('GetVersion');await worker.report(startedAt);reportAt=Date.now()+10000}if(!await worker.runOnce())await new Promise(done=>{const timer=setTimeout(done,750),abort=()=>{clearTimeout(timer);done()};controller.signal.addEventListener('abort',abort,{once:true});setTimeout(()=>controller.signal.removeEventListener('abort',abort),800)})}}
finally{controller.abort();obs.close();relay.close()}
