import {STREAMWEAVER_TWITCH_COMMAND_SCOPES} from "@spmt/streamweaver";
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {AuthDeniedError,type AuthService} from '@spmt/auth-core';
import type {AuthorityService} from '@spmt/authority-core';
import type {ControlService} from '@spmt/control-core';
import {storePinnedProviderAuthorization,theCountTwitchPolicy,type SqliteProviderCredentialAuthority,type ProviderCredentialV1} from '@spmt/provider-grants-core';

const ROOT='/v1/identity/twitch-bots',SCOPES=['chat:read','chat:edit'];
const BROADCASTER_SCOPES=[...new Set(Object.values(STREAMWEAVER_TWITCH_COMMAND_SCOPES).flat())];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export interface TwitchBotRole {roleId:string;tenantId:string;ownerUserId:string;providerUserId:string;login:string;}
export function parseTwitchBotRoles(raw:string|undefined):TwitchBotRole[]{
 const value:unknown=raw?JSON.parse(raw):[];
 if(!Array.isArray(value)||value.length>20)throw Error('SPMT_TWITCH_BOT_ROLES must be an array of at most 20 pinned roles');
 const seen=new Set<string>();
 return value.map(v=>{if(!v||typeof v!=='object')throw Error('Invalid Twitch bot role');const r=v as TwitchBotRole;
  for(const key of ['roleId','tenantId','ownerUserId','providerUserId','login'] as const)if(typeof r[key]!=='string'||!r[key]||r[key].length>200||!/^[A-Za-z0-9._:@/-]+$/.test(r[key]))throw Error('Invalid Twitch bot role '+key);
  if(!/^\d+$/.test(r.providerUserId)||!/^\w{1,25}$/.test(r.login)||['bot','broadcaster'].includes(r.roleId)||seen.has(r.roleId)||seen.has(r.providerUserId)||seen.has(r.login.toLowerCase()))throw Error('Duplicate or invalid pinned Twitch bot');
  if(r.roleId==='the-count'&&r.login.toLowerCase()!=='thecountspmt')throw Error('The Count must use TheCountSPMT');
  seen.add(r.roleId);seen.add(r.providerUserId);seen.add(r.login.toLowerCase());return {...r,login:r.login.toLowerCase()};});
}
type Pending={tenant:string;owner:string;broadcaster:string;login:string;role:string;expires:number};
type Connection={tenant:string;owner:string;broadcaster:string;channel:string;account:string;login:string;role:string;desired:number};
export class TwitchBotApi {
 private readonly db:DatabaseSync;
 private readonly validated=new Map<string,number>();
 constructor(private readonly options:{databasePath:string;auth:AuthService;authority:AuthorityService;control:ControlService;credentials?:SqliteProviderCredentialAuthority;client?:{clientId:string;clientSecret:string};roles?:TwitchBotRole[];publicBaseUrl:string;enabled:boolean;fetchImpl:typeof fetch;accessToken(req:IncomingMessage):string|undefined}){
  this.db=new DatabaseSync(options.databasePath,{timeout:5000});
  this.db.exec('CREATE TABLE IF NOT EXISTS twitch_bot_pending(id TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS twitch_bot_connections(tenant TEXT NOT NULL,broadcaster TEXT NOT NULL,owner TEXT NOT NULL,channel TEXT NOT NULL,account TEXT NOT NULL,login TEXT NOT NULL,role TEXT NOT NULL,desired INTEGER NOT NULL,PRIMARY KEY(tenant,broadcaster))');
 }
 close(){this.db.close()}
 private allowed(row:Connection){try{const w=this.options.control.getTenant(row.tenant);return w.status==='active'&&w.ownerUserId===row.owner&&this.options.authority.listProviderLinks(row.owner).some(p=>p.provider==='twitch'&&p.providerUserId===row.broadcaster)&&['streamweaver','chat-gateway'].every(app=>this.options.control.listInstalls(row.tenant).some(i=>i.appId===app&&i.enabled));}catch{return false}}
 private pin(role:string,tenant:string,owner:string){if(role==='bot'||role==='broadcaster')return undefined;const pin=this.options.roles?.find(r=>r.roleId===role);if(!pin||pin.tenantId!==tenant||pin.ownerUserId!==owner)throw new AuthDeniedError('This bot role is reserved for its configured owner');return pin}
 private async validate(accessToken:string,scopes=SCOPES){const r=await this.options.fetchImpl('https://id.twitch.tv/oauth2/validate',{headers:{authorization:'OAuth '+accessToken},redirect:'error',signal:AbortSignal.timeout(10000)}),v=await r.json() as {user_id?:string;login?:string;client_id?:string;scopes?:string[];expires_in?:number};if(!r.ok||v.client_id!==this.options.client?.clientId||!v.user_id||!v.login||!scopes.every(s=>v.scopes?.includes(s)))throw Error('Twitch bot authorization is no longer valid');return v}
 async validateManagedCredential(tenant:string,c:ProviderCredentialV1){
  if(c.provider!=='twitch'||!c.metadata.botOwner)return true;
  try{const w=this.options.control.getTenant(tenant);if(!this.options.enabled||w.status!=='active'||w.ownerUserId!==c.metadata.botOwner)return false;
   if(!this.options.control.listInstalls(tenant).some(i=>i.appId==='streamweaver'&&i.enabled))return false;
   const pin=this.pin(c.metadata.roleId??'bot',tenant,w.ownerUserId);if(pin&&(pin.providerUserId!==c.providerUserId||pin.login!==(c.metadata.username??'').toLowerCase()))return false;
   if(c.metadata.roleId==='broadcaster'&&!this.options.authority.listProviderLinks(w.ownerUserId).some(p=>p.provider==='twitch'&&p.providerUserId===c.providerUserId))return false;
   const key=tenant+':'+c.providerUserId+':'+hash(c.accessToken);if(Date.now()-(this.validated.get(key)??0)<1800000)return true;
   const v=await this.validate(c.accessToken,c.scopes);if(v.user_id!==c.providerUserId||v.login!.toLowerCase()!==(c.metadata.username??'').toLowerCase())return false;this.validated.set(key,Date.now());return true;
  }catch{return false}
 }
 private async discovery(req:IncomingMessage,res:ServerResponse,token:string){
  if(req.method!=='GET')return json(res,405,{message:'Use GET'});const p=this.options.auth.authorize(token,'providers:grant');if(p.actorType!=='service'||p.actorId!=='chat-gateway')throw new AuthDeniedError('Only Chat Gateway may discover bot connections');
  const connections=[];for(const r of this.db.prepare('SELECT * FROM twitch_bot_connections').all() as unknown as Connection[]){if(p.tenantMode!=='any'&&!p.tenantIds.includes(r.tenant))continue;
   let desired=this.options.enabled&&r.desired===1&&this.allowed(r);const key=r.tenant+':'+r.account;
   try{const pin=this.pin(r.role,r.tenant,r.owner);if(pin&&(pin.providerUserId!==r.account||pin.login!==r.login))throw Error('Pinned identity changed');const c=this.options.credentials?.get(r.tenant,'twitch',r.account);desired=desired&&Boolean(c&&c.state!=='revoked'&&c.state!=='reauthorization-required');
    if(desired){const credential=await this.options.credentials!.resolve({tenantId:r.tenant,provider:'twitch',providerUserId:r.account});if(!credential||!await this.validateManagedCredential(r.tenant,credential))throw Error('Authorization unavailable');}
   }catch{desired=false;this.validated.delete(key)}
   connections.push({schemaVersion:1,tenantId:r.tenant,provider:'twitch',connectionId:'twitch-bot-'+hash(r.broadcaster+':'+r.account).slice(0,16),channelId:r.channel,providerAccountId:r.account,desired});
  }return json(res,200,{connections});
 }
 async handle(req:IncomingMessage,res:ServerResponse,url:URL){if(!url.pathname.startsWith(ROOT+'/')&&url.pathname!==ROOT&&url.pathname!=='/v1/chat/twitch-bot-connections')return false;
  try{const token=this.options.accessToken(req);if(!token)return json(res,401,{message:'Sign in to manage Twitch bots'});
   if(url.pathname==='/v1/chat/twitch-bot-connections')return await this.discovery(req,res,token);
   const callback=url.pathname===ROOT+'/callback',state=url.searchParams.get('state')??'';let pending:Pending|undefined;
   if(callback){if(!state||cookie(req)!==state)throw Error('Bot authorization expired. Start again.');const r=this.db.prepare('SELECT body FROM twitch_bot_pending WHERE id=? AND expires>?').get(hash(state),Date.now());if(!r)throw Error('Bot authorization expired. Start again.');pending=JSON.parse(String(r.body));}
   const tenant=pending?.tenant??String(req.headers['x-spmt-tenant']??url.searchParams.get('tenantId')??'');if(!tenant)throw Error('Choose a workspace');
   const p=this.options.auth.authorize(token,req.method==='GET'&&url.pathname===ROOT?'identity:read':'identity:write',tenant);if(p.actorType!=='user')throw new AuthDeniedError('Use your signed-in account');
   const w=this.options.control.getTenant(tenant);if(w.status!=='active'||w.ownerUserId!==p.actorId)throw new AuthDeniedError('Only the active workspace owner can manage its bots');
   if(url.pathname===ROOT){
    if(req.method==='GET'){const connections=(this.db.prepare('SELECT * FROM twitch_bot_connections WHERE owner=?').all(p.actorId) as unknown as Connection[]).filter(r=>{try{return (p.tenantMode==='any'||p.tenantIds.includes(r.tenant))&&this.options.control.getTenant(r.tenant).ownerUserId===p.actorId}catch{return false}}).map(r=>{const c=this.options.credentials?.get(r.tenant,'twitch',r.account);return {tenantId:r.tenant,broadcasterId:r.broadcaster,channel:r.channel,botId:r.account,login:r.login,role:r.role,desired:r.desired===1,state:c?.state??'unavailable',expiresAt:c?.expiresAt,eligible:this.allowed(r)}});return json(res,200,{broadcasters:(this.options.credentials?.list(tenant)??[]).filter(c=>c.provider==='twitch'&&c.metadata.roleId==='broadcaster'&&c.metadata.botOwner===p.actorId).map(c=>({providerUserId:c.providerUserId,login:c.metadata.username,state:c.state})),authorizationOrigin:this.options.publicBaseUrl,configured:Boolean(this.options.enabled&&this.options.client&&this.options.credentials),roles:(this.options.roles??[]).filter(r=>r.ownerUserId===p.actorId&&r.tenantId===tenant).map(r=>({roleId:r.roleId,login:r.login})),connections});}
    if(req.method!=='POST')return json(res,405,{message:'Use GET or POST'});sameOrigin(req);const body=await readJson(req);if(body.action!=='disconnect'||typeof body.broadcasterId!=='string')throw Error('Choose a bot connection to disconnect');
    if(body.role==='broadcaster'){const c=this.options.credentials?.get(tenant,'twitch',body.broadcasterId);if(!c||c.metadata.botOwner!==p.actorId||c.metadata.roleId!=='broadcaster')throw new AuthDeniedError('Broadcaster authorization was not found');if(c.state!=='revoked')this.options.credentials!.revoke(tenant,'twitch',body.broadcasterId,c.revision);this.audit(tenant,p.actorId,'disconnect-broadcaster',body.broadcasterId);return json(res,200,{disconnected:true});}
    const r=this.db.prepare('SELECT * FROM twitch_bot_connections WHERE tenant=? AND broadcaster=? AND owner=?').get(tenant,body.broadcasterId,p.actorId) as unknown as Connection|undefined;if(!r)throw Error('Bot connection was not found');this.pin(r.role,tenant,p.actorId);
    this.db.prepare('UPDATE twitch_bot_connections SET desired=0 WHERE tenant=? AND broadcaster=?').run(tenant,r.broadcaster);
    if(!this.db.prepare('SELECT 1 FROM twitch_bot_connections WHERE tenant=? AND account=? AND desired=1').get(tenant,r.account)){const c=this.options.credentials?.get(tenant,'twitch',r.account);if(c&&c.state!=='revoked')this.options.credentials!.revoke(tenant,'twitch',r.account,c.revision);}
    this.validated.delete(tenant+':'+r.account);this.audit(tenant,p.actorId,'disconnect',r.account);return json(res,200,{disconnected:true});
   }
   if(!this.options.enabled||!this.options.client||!this.options.credentials)return json(res,503,{message:'Twitch bot OAuth is not configured in this environment'});
   if(req.method!=='GET')return json(res,405,{message:'Use GET'});
   if(url.pathname===ROOT+'/start'){
    const broadcaster=url.searchParams.get('broadcasterId')??'',role=url.searchParams.get('role')??'bot',pin=this.pin(role,tenant,p.actorId),login=(pin?.login??url.searchParams.get('login')??'').trim().replace(/^@/,'').toLowerCase();
    if(role!=='broadcaster'&&!/^\w{1,25}$/.test(login))throw Error('Enter the Twitch bot login');
    if(role==='bot'&&(login==='thecountspmt'||this.options.roles?.some(r=>r.login===login)))throw new AuthDeniedError('Use the reserved bot role with its owner account');
    const binding:Pending={tenant,owner:p.actorId,broadcaster,login,role,expires:Date.now()+600000};if(!this.allowed({...binding,account:'',channel:'',desired:1}))throw new AuthDeniedError('Link the broadcaster and enable StreamWeaver and Chat Gateway first');
    const value=randomBytes(32).toString('base64url');this.db.prepare('DELETE FROM twitch_bot_pending WHERE expires<?').run(Date.now());this.db.prepare('INSERT INTO twitch_bot_pending VALUES(?,?,?)').run(hash(value),JSON.stringify(binding),binding.expires);
    const target=new URL('https://id.twitch.tv/oauth2/authorize');for(const [k,v]of Object.entries({client_id:this.options.client.clientId,redirect_uri:this.options.publicBaseUrl+ROOT+'/callback',response_type:'code',scope:(role==='broadcaster'?BROADCASTER_SCOPES:SCOPES).join(' '),force_verify:'true',state:value}))target.searchParams.set(k,v);return redirect(res,target.href,value);
   }
   if(!callback||!pending)return json(res,404,{message:'Bot route was not found'});
   if(pending.owner!==p.actorId)throw new AuthDeniedError('Use the owner account that started authorization');const pin=this.pin(pending.role,tenant,p.actorId);
   if(!this.allowed({...pending,account:'',channel:'',desired:1}))throw new AuthDeniedError('The broadcaster or workspace authorization changed');
   if(!this.db.prepare('DELETE FROM twitch_bot_pending WHERE id=?').run(hash(state)).changes)throw Error('Authorization already used');
   const code=url.searchParams.get('code');if(!code||code.length>4000)throw Error('Twitch authorization did not complete');
   const response=await this.options.fetchImpl('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:this.options.client.clientId,client_secret:this.options.client.clientSecret,redirect_uri:this.options.publicBaseUrl+ROOT+'/callback',grant_type:'authorization_code',code}),redirect:'error',signal:AbortSignal.timeout(15000)}),grant=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
   if(!response.ok||!grant.access_token||!grant.refresh_token)throw Error('Twitch could not authorize the bot');const scopes=pending.role==='broadcaster'?BROADCASTER_SCOPES:SCOPES,identity=await this.validate(grant.access_token,scopes);
   if((pending.role!=='broadcaster'&&identity.login!.toLowerCase()!==pending.login)||pin&&identity.user_id!==pin.providerUserId)throw Error('Authorize the selected bot account');
   if(!pin&&(identity.login!.toLowerCase()==='thecountspmt'||this.options.roles?.some(r=>r.providerUserId===identity.user_id)))throw new AuthDeniedError('This bot identity is reserved');
   if(pending.role==='broadcaster'&&identity.user_id!==pending.broadcaster)throw Error('Authorize your selected broadcaster account');
   if(pending.role!=='broadcaster'&&identity.user_id===pending.broadcaster)throw Error('Choose a separate bot account; broadcaster authorization stays in Account');
   const lookup=await this.options.fetchImpl('https://api.twitch.tv/helix/users?id='+encodeURIComponent(pending.broadcaster),{headers:{'client-id':this.options.client.clientId,authorization:'Bearer '+grant.access_token},redirect:'error',signal:AbortSignal.timeout(10000)}),users=await lookup.json() as {data?:Array<{id:string;login:string}>};const channel=users.data?.[0];if(!lookup.ok||channel?.id!==pending.broadcaster||!/^\w{1,25}$/.test(channel.login))throw Error('Broadcaster could not be verified');
   if(!this.allowed({...pending,account:'',channel:'',desired:1}))throw new AuthDeniedError('Workspace authorization changed during consent');
   if(pending.role==='broadcaster')pending.login=identity.login!.toLowerCase();
   const previous=this.db.prepare('SELECT * FROM twitch_bot_connections WHERE tenant=? AND broadcaster=?').get(tenant,pending.broadcaster) as unknown as Connection|undefined;
   const prior=this.options.credentials.get(tenant,'twitch',identity.user_id!);if(prior&&prior.metadata.botOwner!==p.actorId)throw new AuthDeniedError('This credential is managed by another authorization path');
   const seconds=Math.min(Number(grant.expires_in),Number(identity.expires_in));if(!Number.isFinite(seconds)||seconds<30||seconds>86400)throw Error('Invalid Twitch token lifetime');
   if(pin){const policy=pin.roleId==='the-count'?theCountTwitchPolicy({tenantId:tenant,ownerUserId:p.actorId,providerUserId:pin.providerUserId}):{schemaVersion:1 as const,roleId:pin.roleId,tenantId:tenant,provider:'twitch' as const,expectedProviderUserId:pin.providerUserId,expectedLogin:pin.login,ownerUserId:p.actorId,allowedAppIds:['chat-gateway'],allowedCapabilities:['provider-chat'],allowedScopes:SCOPES};storePinnedProviderAuthorization(this.options.credentials,policy,{actorUserId:p.actorId,clientId:this.options.client.clientId,providerUserId:identity.user_id!,providerLogin:identity.login!,accessToken:grant.access_token,refreshToken:grant.refresh_token,scopes:SCOPES,expiresAt:new Date(Date.now()+seconds*1000).toISOString(),...(prior?{expectedRevision:prior.revision}:{})});}
   else this.options.credentials.put({schemaVersion:1,tenantId:tenant,provider:'twitch',providerUserId:identity.user_id!,accessToken:grant.access_token,refreshToken:grant.refresh_token,refreshMode:'oauth',metadata:{username:pending.login,clientId:this.options.client.clientId,botOwner:p.actorId,roleId:pending.role,...(pin?{identityPinned:'true'}:{})},scopes,expiresAt:new Date(Date.now()+seconds*1000).toISOString(),allowedAppIds:pending.role==='broadcaster'?['streamweaver','chat-gateway']:['chat-gateway'],allowedCapabilities:pending.role==='broadcaster'?Object.keys(STREAMWEAVER_TWITCH_COMMAND_SCOPES):['provider-chat'],...(prior?{expectedRevision:prior.revision}:{})});
   if(pending.role==='broadcaster'){this.audit(tenant,p.actorId,'authorize-broadcaster',identity.user_id!);return redirect(res,this.options.publicBaseUrl+'/apps/streamweaver?botConnected=1','');}
   this.db.prepare('INSERT INTO twitch_bot_connections VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(tenant,broadcaster) DO UPDATE SET owner=excluded.owner,channel=excluded.channel,account=excluded.account,login=excluded.login,role=excluded.role,desired=1').run(tenant,pending.broadcaster,p.actorId,channel.login.toLowerCase(),identity.user_id!,pending.login,pending.role);
   if(previous&&previous.account!==identity.user_id&&!this.db.prepare('SELECT 1 FROM twitch_bot_connections WHERE tenant=? AND account=? AND desired=1').get(tenant,previous.account)){const old=this.options.credentials.get(tenant,'twitch',previous.account);if(old&&old.state!=='revoked')this.options.credentials.revoke(tenant,'twitch',previous.account,old.revision);}
   this.validated.set(tenant+':'+identity.user_id+':'+hash(grant.access_token),Date.now());this.audit(tenant,p.actorId,'authorize',identity.user_id!);return redirect(res,this.options.publicBaseUrl+'/apps/streamweaver?botConnected=1','');
  }catch(e){const message=e instanceof Error?e.message:'Bot request failed';if(url.pathname===ROOT+'/callback')return redirect(res,this.options.publicBaseUrl+'/apps/streamweaver?botError='+encodeURIComponent(message.slice(0,200)),'');return json(res,e instanceof AuthDeniedError?403:400,{message});}
 }
 private audit(tenantId:string,actorId:string,action:string,account:string){this.options.authority.audit({tenantId,actorType:'user',actorId,action:'identity.bot.'+action,target:'provider:twitch:'+account,outcome:'accepted'})}
}
function cookie(req:IncomingMessage){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('spmt_twitch_bot_state='))?.slice('spmt_twitch_bot_state='.length)}
function sameOrigin(req:IncomingMessage){if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw new AuthDeniedError('Use this workspace to change its bot')}
function redirect(res:ServerResponse,location:string,state:string){res.writeHead(302,{location,'cache-control':'no-store','set-cookie':`spmt_twitch_bot_state=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${state?600:0}`});res.end();return true}
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));return true}
async function readJson(req:IncomingMessage):Promise<Record<string,unknown>>{const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=c.length;if(size>4000)throw Error('Request too large');chunks.push(Buffer.from(c))}const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected an object');return value}
