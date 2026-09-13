import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {AuthDeniedError,type AuthService} from '@spmt/auth-core';
import type {AuthorityService} from '@spmt/authority-core';
import type {ControlService} from '@spmt/control-core';
import type {CommunityAssistantRuntimeV1} from '@spmt/platform-ops';
import {TTS_VOICE_OPTIONS} from '@spmt/stellar-core';
const ROOT='/v1/assistant/public-personas';
type Published={tenantId:string;owner:string;personaId:string;sourcePersonaId:string;displayName:string;aliases:string[];instructions:string;voice:string;avatarUrl?:string;revision:number;enabled:boolean};
/** Explicit owner-published snapshots. Instructions stay private to canonical job construction. */
export class PublicPersonaApi {
 private readonly db:DatabaseSync;
 constructor(private readonly options:{path:string;auth:AuthService;authority:AuthorityService;control:ControlService;runtime:CommunityAssistantRuntimeV1;accessToken(request:IncomingMessage):string|undefined}){this.db=new DatabaseSync(options.path,{timeout:5000});this.db.exec('CREATE TABLE IF NOT EXISTS public_room_personas(tenant TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT');}
 close(){this.db.close()}
 private all(){return this.db.prepare('SELECT body FROM public_room_personas').all().map(r=>JSON.parse(String(r.body)) as Published)}
 private eligible(p:Published){try{const t=this.options.control.getTenant(p.tenantId);return p.enabled&&t.status==='active'&&t.ownerUserId===p.owner&&this.options.control.listInstalls(p.tenantId).some(i=>i.appId==='streamweaver'&&i.enabled)}catch{return false}}
 private metadata(p:Published){return {personaId:p.personaId,targetTenantId:p.tenantId,sourcePersonaId:p.sourcePersonaId,displayName:p.displayName,wakeNames:[p.displayName,...p.aliases],voice:p.voice,...(p.avatarUrl?{avatarUrl:p.avatarUrl}:{}),revision:p.revision,canInvite:this.eligible(p),canTalk:this.eligible(p)&&this.options.runtime.status().availability==='available',transportHealthy:false};}
 async handle(req:IncomingMessage,res:ServerResponse,url:URL){if(url.pathname!==ROOT&&url.pathname!==ROOT+'/invocations')return false;
  try{const token=this.options.accessToken(req),tenant=typeof req.headers['x-spmt-tenant']==='string'?req.headers['x-spmt-tenant']:'';if(!token||!tenant)return json(res,401,{message:'Sign in to a workspace'});const metadataRead=req.method==='GET'&&url.pathname===ROOT&&url.searchParams.get('own')!=='true',actor=this.options.auth.authorize(token,metadataRead?'assistants:read':'assistants:invoke',tenant);if(actor.actorType!=='user'&&!(metadataRead&&actor.actorId==='hearmeout'))return json(res,403,{message:'Use your signed-in account'});const workspace=this.options.control.getTenant(tenant);if(workspace.status!=='active')return json(res,403,{message:'Workspace is suspended'});
   if(req.method==='GET'&&url.pathname===ROOT){if(url.searchParams.get('own')==='true'){if(workspace.ownerUserId!==actor.actorId)return json(res,403,{message:'Only the owner can manage public sharing'});const own=this.all().find(p=>p.tenantId===tenant);return json(res,200,{published:own?{...this.metadata(own),enabled:this.eligible(own)}:null,voices:TTS_VOICE_OPTIONS.map(v=>({id:v.id,label:v.label}))});}return json(res,200,{personas:this.all().filter(p=>this.eligible(p)).map(p=>this.metadata(p)).sort((a,b)=>a.displayName.localeCompare(b.displayName))});}
   if(req.method!=='POST')return json(res,405,{message:'Use GET or POST'});if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{message:'Use this workspace to change personas'});
   const body=await read(req);
   if(url.pathname===ROOT+'/invocations'){
    if(!this.options.control.listInstalls(tenant).some(i=>i.appId==='hearmeout'&&i.enabled))return json(res,403,{message:'Enable HearMeOut to use room personas'});
    const p=this.all().find(p=>p.personaId===body.personaId&&this.eligible(p));if(!p)return json(res,404,{message:'This persona is no longer shared for room use'});
    const message=label(body.message,4000),roomId=id(body.roomId),requestId=label(req.headers['idempotency-key'],200),key='hmo-public:'+createHash('sha256').update(JSON.stringify([actor.actorId,roomId,p.personaId,requestId])).digest('hex');
    const accepted=this.options.runtime.accept({schemaVersion:1,tenantId:tenant,userId:actor.actorId,requestedByType:'user',requestedById:actor.actorId,callerAppId:'hearmeout',message,surface:'app',routingPreference:'automatic',remember:false,conversationId:`hearmeout:${roomId}:${p.personaId}`,presentation:{sourceAppId:'streamweaver',personaId:p.personaId,displayName:p.displayName,instructions:p.instructions,memoryPolicy:'off'},idempotencyKey:key});
    return json(res,202,{...accepted,personaId:p.personaId,displayName:p.displayName,voice:p.voice});
   }
   if(workspace.ownerUserId!==actor.actorId)return json(res,403,{message:'Only the workspace owner can publish a persona'});
   const prior=this.all().find(p=>p.tenantId===tenant);
   if(body.action==='withdraw'){if(prior){this.db.prepare('UPDATE public_room_personas SET body=? WHERE tenant=?').run(JSON.stringify({...prior,enabled:false,revision:prior.revision+1}),tenant);this.options.authority.audit({tenantId:tenant,actorType:'user',actorId:actor.actorId,action:'persona.public.withdraw',target:prior.personaId,outcome:'accepted'});}return json(res,200,{withdrawn:true});}
   if(body.action!=='publish')throw Error('Choose publish or withdraw');if(!this.options.control.listInstalls(tenant).some(i=>i.appId==='streamweaver'&&i.enabled))return json(res,403,{message:'Enable StreamWeaver before publishing'});
   const sourcePersonaId=id(body.personaId),displayName=label(body.displayName,120),instructions=label(body.instructions,4000),voice=label(body.voice,200);if(!TTS_VOICE_OPTIONS.some(v=>v.id===voice))throw Error('Choose a supported voice');
   const aliases=Array.isArray(body.aliases)?[...new Set(body.aliases.map(v=>label(v,96)))].slice(0,50):[];
   if(/[\r\n]/.test(displayName)||aliases.some(a=>/[\r\n]/.test(a)))throw Error("Persona names must be single-line labels");
   if([tenant,sourcePersonaId,displayName,...aliases].some(v=>['count','thecount','thecountspmt'].includes(v.toLowerCase().replace(/[^a-z0-9]/g,''))))throw Error('The Count is not available for public room conversation');
   let avatarUrl:string|undefined;if(body.avatarUrl){const u=new URL(label(body.avatarUrl,2048));if(u.protocol!=='https:'||u.username||u.password)throw Error('Avatar must use HTTPS');avatarUrl=u.href;}
   const published:Published={tenantId:tenant,owner:actor.actorId,personaId:'swpublic_'+createHash('sha256').update(JSON.stringify([tenant,sourcePersonaId])).digest('hex').slice(0,32),sourcePersonaId,displayName,aliases,instructions,voice,...(avatarUrl?{avatarUrl}:{}),revision:(prior?.revision??0)+1,enabled:true};
   this.db.prepare('INSERT INTO public_room_personas VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET body=excluded.body').run(tenant,JSON.stringify(published));this.options.authority.audit({tenantId:tenant,actorType:'user',actorId:actor.actorId,action:'persona.public.publish',target:published.personaId,outcome:'accepted'});return json(res,200,{published:this.metadata(published)});
  }catch(error){return json(res,error instanceof AuthDeniedError?403:400,{message:error instanceof Error?error.message:'Public persona request failed'});}
 }
}
function id(value:unknown){const s=label(value,200);if(!/^[A-Za-z0-9._:@/-]+$/.test(s))throw Error('Persona or room identifier is invalid');return s}
function label(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw Error('Persona request field is invalid');return value.trim()}
async function read(req:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const c of req){size+=c.length;if(size>16000)throw Error('Persona request is too large');chunks.push(Buffer.from(c))}const body=JSON.parse(Buffer.concat(chunks).toString());if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Expected a persona request');return body as Record<string,unknown>}
function json(res:ServerResponse,status:number,body:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));return true}
