import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {AuthDeniedError,type AuthService} from '@spmt/auth-core';
import type {AuthorityService} from '@spmt/authority-core';
import type {ControlService} from '@spmt/control-core';
import type {SqliteProviderCredentialAuthority} from '@spmt/provider-grants-core';
const ROOT='/v1/identity/providers/youtube',READ='https://www.googleapis.com/auth/youtube.readonly',CHAT='https://www.googleapis.com/auth/youtube.force-ssl';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
type Pending={tenant:string;user:string;purpose:'identity'|'chat';verifier:string;expires:number};
/** Server-bound state + PKCE; provider refresh tokens never leave the canonical credential authority. */
export class YouTubeOAuthApi {
 private readonly db:DatabaseSync;
 constructor(private readonly options:{databasePath:string;auth:AuthService;authority:AuthorityService;control:ControlService;credentials?:SqliteProviderCredentialAuthority;client?:{clientId:string;clientSecret:string};publicBaseUrl:string;enabled:boolean;fetchImpl:typeof fetch;accessToken(request:IncomingMessage):string|undefined}){this.db=new DatabaseSync(options.databasePath,{timeout:5000});this.db.exec('CREATE TABLE IF NOT EXISTS youtube_oauth_pending(id TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS youtube_chat_connections(tenant TEXT NOT NULL,channel TEXT NOT NULL,owner TEXT NOT NULL,desired INTEGER NOT NULL,PRIMARY KEY(tenant,channel))');}
 close(){this.db.close()}
 async handle(req:IncomingMessage,res:ServerResponse,url:URL){if(!url.pathname.startsWith(ROOT+'/')&&url.pathname!=='/v1/chat/youtube-connections')return false;try{
  const token=this.options.accessToken(req);if(!token)return json(res,401,{message:'Sign in to link YouTube'});
  if(url.pathname==='/v1/chat/youtube-connections'){
   if(req.method!=='GET')return json(res,405,{message:'Use GET'});
   const p=this.options.auth.authorize(token,'providers:grant');if(p.actorType!=='service'||p.actorId!=='chat-gateway')return json(res,403,{message:'Only Chat Gateway may discover provider connections'});
   const connections=this.db.prepare('SELECT tenant,channel,owner,desired FROM youtube_chat_connections').all().filter(r=>p.tenantMode==='any'||p.tenantIds.includes(String(r.tenant))).map(r=>{const tenant=String(r.tenant),channel=String(r.channel);let enabled=false;try{const workspace=this.options.control.getTenant(tenant);enabled=workspace.status==='active'&&workspace.ownerUserId===r.owner&&['streamweaver','chat-gateway'].every(app=>this.options.control.listInstalls(tenant).some(i=>i.appId===app&&i.enabled))&&this.options.authority.listProviderLinks(String(r.owner)).some(l=>l.provider==='youtube'&&l.providerUserId===channel)}catch{}return {schemaVersion:1,tenantId:tenant,provider:'youtube',connectionId:'youtube-oauth-'+hash(channel).slice(0,16),channelId:channel,providerAccountId:channel,desired:this.options.enabled&&r.desired===1&&enabled};});
   return json(res,200,{connections});
  }
  const callback=url.pathname===ROOT+'/callback',state=callback?url.searchParams.get('state')??'':'',cookieState=cookie(req,'spmt_youtube_state');
  let pending:Pending|undefined;
  if(callback){if(!state||state!==cookieState)throw Error('YouTube link request expired. Start again.');const row=this.db.prepare('SELECT body FROM youtube_oauth_pending WHERE id=? AND expires>?').get(hash(state),Date.now());if(!row)throw Error('YouTube link request expired. Start again.');pending=JSON.parse(String(row.body));}
  const tenant=pending?.tenant??String(req.headers['x-spmt-tenant']??url.searchParams.get('tenantId')??'');if(!tenant)throw Error('Choose a workspace');
  const principal=this.options.auth.authorize(token,req.method==='GET'&&url.pathname===ROOT+'/connections'?'identity:read':'identity:write',tenant);if(principal.actorType!=='user')return json(res,403,{message:'Use your signed-in account'});
  const workspace=this.options.control.getTenant(tenant);if(workspace.status!=='active')return json(res,403,{message:'Workspace is suspended'});
  const owner=()=>{if(workspace.ownerUserId!==principal.actorId)throw new AuthDeniedError('Only the workspace owner can connect YouTube chat')};
  if(url.pathname===ROOT+'/connections'){
   owner();if(req.method==='GET')return json(res,200,{configured:Boolean(this.options.client&&this.options.credentials&&this.options.enabled),connections:this.db.prepare('SELECT channel AS channelId,desired FROM youtube_chat_connections WHERE tenant=? AND owner=?').all(tenant,principal.actorId)});
   if(req.method!=='POST')return json(res,405,{message:'Use GET or POST'});const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return json(res,403,{message:'Use this workspace to change connections'});
   const body=await readJson(req);if(body.action!=='disconnect'||typeof body.channelId!=='string')throw Error('Choose a YouTube channel to disconnect');
   const row=this.db.prepare('SELECT channel FROM youtube_chat_connections WHERE tenant=? AND channel=? AND owner=?').get(tenant,body.channelId,principal.actorId);if(!row)throw Error('YouTube connection was not found');
   const credential=this.options.credentials?.get(tenant,'youtube',body.channelId);if(credential&&credential.state!=='revoked')this.options.credentials!.revoke(tenant,'youtube',body.channelId,credential.revision);
   this.db.prepare('UPDATE youtube_chat_connections SET desired=0 WHERE tenant=? AND channel=?').run(tenant,body.channelId);return json(res,200,{disconnected:true});
  }
  if(!this.options.enabled||!this.options.client)return json(res,503,{message:'YouTube OAuth is not configured in this environment'});
  if(req.method!=='GET')return json(res,405,{message:'Use GET'});
  if(url.pathname===ROOT+'/start'){
   const purpose=url.searchParams.get('purpose')==='chat'?'chat':'identity';if(purpose==='chat'){owner();if(!this.options.credentials)throw Error('The provider credential authority is unavailable');if(!this.options.control.listInstalls(tenant).some(i=>i.appId==='streamweaver'&&i.enabled))throw Error('Enable StreamWeaver before connecting chat');if(!this.options.control.listInstalls(tenant).some(i=>i.appId==='chat-gateway'&&i.enabled))throw Error('Enable Chat Gateway before connecting YouTube chat')}
   const value=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),binding:Pending={tenant,user:principal.actorId,purpose,verifier,expires:Date.now()+600000};
   this.db.prepare('DELETE FROM youtube_oauth_pending WHERE expires<?').run(Date.now());this.db.prepare('INSERT INTO youtube_oauth_pending VALUES(?,?,?)').run(hash(value),JSON.stringify(binding),binding.expires);
   const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [k,v]of Object.entries({client_id:this.options.client.clientId,redirect_uri:this.options.publicBaseUrl+ROOT+'/callback',response_type:'code',scope:purpose==='chat'?CHAT:READ,state:value,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',...(purpose==='chat'?{access_type:'offline',prompt:'consent'}:{})}))target.searchParams.set(k,v);
   res.writeHead(302,{location:target.href,'cache-control':'no-store','set-cookie':stateCookie(value)});res.end();return true;
  }
  if(!callback||!pending)return json(res,404,{message:'YouTube route was not found'});
  if(pending.user!==principal.actorId)throw Error('Sign in with the account that started this YouTube link');if(pending.purpose==='chat')owner();
  if(!this.db.prepare('DELETE FROM youtube_oauth_pending WHERE id=?').run(hash(state)).changes)throw Error('YouTube link request was already used');
  const code=url.searchParams.get('code');if(!code||code.length>4000)throw Error('YouTube authorization did not complete');
  const response=await this.options.fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:this.options.client.clientId,client_secret:this.options.client.clientSecret,redirect_uri:this.options.publicBaseUrl+ROOT+'/callback',grant_type:'authorization_code',code,code_verifier:pending.verifier}),headers:{'content-type':'application/x-www-form-urlencoded'},redirect:'error',signal:AbortSignal.timeout(15000)}),grant=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok||typeof grant.access_token!=='string')throw Error('YouTube could not authorize this account');
  const scopes=String(grant.scope??'').split(' ');if(pending.purpose==='chat'?!scopes.includes(CHAT):!scopes.some(s=>s===READ||s===CHAT))throw Error('YouTube did not grant the requested permission');
  const identityResponse=await this.options.fetchImpl('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',{headers:{authorization:'Bearer '+grant.access_token},redirect:'error',signal:AbortSignal.timeout(15000)}),identity=await identityResponse.json().catch(()=>({})) as {items?:Array<{id?:string;snippet?:{title?:string}}>};
  const channel=identity.items?.[0];if(!identityResponse.ok||identity.items?.length!==1||!channel?.id||!/^[A-Za-z0-9_-]{1,200}$/.test(channel.id))throw Error('Select a YouTube account with one channel and authorize again');
  this.options.authority.linkProvider(principal.actorId,'youtube',channel.id);
  if(pending.purpose==='chat'){
   if(!this.options.credentials||typeof grant.refresh_token!=='string'||!grant.refresh_token)throw Error('YouTube offline consent is required. Connect again.');
   const seconds=Number(grant.expires_in);if(!Number.isFinite(seconds)||seconds<30||seconds>86400)throw Error('YouTube returned an invalid token lifetime');
   const prior=this.options.credentials.get(tenant,'youtube',channel.id);
   this.options.credentials.put({schemaVersion:1,tenantId:tenant,provider:'youtube',providerUserId:channel.id,accessToken:grant.access_token,refreshToken:grant.refresh_token,refreshMode:'oauth',metadata:{channelId:channel.id,username:String(channel.snippet?.title??channel.id).slice(0,120)},scopes,expiresAt:new Date(Date.now()+seconds*1000).toISOString(),allowedAppIds:['chat-gateway'],allowedCapabilities:['provider-chat'],...(prior?{expectedRevision:prior.revision}:{})});
   this.db.prepare('INSERT INTO youtube_chat_connections VALUES(?,?,?,1) ON CONFLICT(tenant,channel) DO UPDATE SET owner=excluded.owner,desired=1').run(tenant,channel.id,principal.actorId);
  }
  this.options.authority.audit({tenantId:tenant,actorType:'user',actorId:principal.actorId,action:'identity.providers.link',target:'provider:youtube:'+channel.id,outcome:'accepted'});
  const target=new URL('/',this.options.publicBaseUrl);target.searchParams.set('view','account');target.searchParams.set('providerLinked','youtube');res.writeHead(302,{location:target.href,'cache-control':'no-store','set-cookie':stateCookie('')});res.end();return true;
 }catch(error){if(url.pathname===ROOT+'/callback'){const target=new URL('/',this.options.publicBaseUrl);target.searchParams.set('view','account');target.searchParams.set('providerLinkError',error instanceof Error?error.message.slice(0,200):'YouTube authorization failed');res.writeHead(302,{location:target.href,'cache-control':'no-store','set-cookie':stateCookie('')});res.end();return true}return json(res,error instanceof AuthDeniedError?403:400,{message:error instanceof Error?error.message:'YouTube request failed'})}}
}
function cookie(req:IncomingMessage,name:string){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)}
function stateCookie(value:string){return `spmt_youtube_state=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value?600:0}`}
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));return true}
async function readJson(req:IncomingMessage):Promise<Record<string,unknown>>{const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=c.length;if(size>4000)throw Error('Request is too large');chunks.push(Buffer.from(c))}const body=JSON.parse(Buffer.concat(chunks).toString());if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Expected an object');return body}
