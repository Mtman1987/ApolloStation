import {createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AuthService} from '@spmt/auth-core';
import type {ControlService} from '@spmt/control-core';
import {CommlinkSocialStreamStore,normalizeSocialStream,type CommlinkLiveChatStore,type CommlinkOperatorStore} from '@spmt/commlink-core';
export class CommlinkSocialStreamApi {
 private readonly windows=new Map<string,{at:number;count:number}>();
 constructor(private readonly options:{store:CommlinkSocialStreamStore;chat:CommlinkLiveChatStore;operator:CommlinkOperatorStore;auth:AuthService;control:ControlService;accessToken(request:IncomingMessage):string|undefined;publish(tenant:string):void}){}
 async handle(request:IncomingMessage,response:ServerResponse,url:URL){const match=/^\/v1\/commlink\/social-stream(?:\/([A-Za-z0-9._:@-]{1,200}))?$/.exec(url.pathname);if(!match)return false;let tenant='';try{
  if(match[1]){
   tenant=match[1];const bearer=request.headers.authorization?.replace(/^Bearer /,'')??'';
   if(request.method!=='POST')return json(response,405,{message:'Use POST for Social Stream ingestion'});
   if(!this.options.store.authorize(tenant,bearer))return json(response,401,{message:'Social Stream authorization failed'});
   if(this.options.control.getTenant(tenant).status!=='active'||!this.options.control.listInstalls(tenant).some(i=>i.appId==='streamweaver'&&i.enabled))return json(response,403,{message:'StreamWeaver is not enabled'});
   const now=Date.now(),window=this.windows.get(tenant);if(!window||now-window.at>=60000)this.windows.set(tenant,{at:now,count:1});else if(++window.count>1000)return json(response,429,{message:'Social Stream rate limit reached'});
   const normalized=normalizeSocialStream({...await readJson(request),...(url.searchParams.get('visibility')==='private'?{private:true}:{})},tenant);
   if(this.options.store.hasReceipt(tenant,normalized.receipt))return json(response,200,{accepted:true,duplicate:true});
   if(normalized.visibility==='private'){const result=this.options.store.ingestPrivate(normalized.record,normalized.operation);this.options.store.received(tenant,normalized.receipt);return json(response,202,{accepted:true,target:'private',duplicate:result.duplicate});}
   const result=this.options.chat.ingestMirror(normalized.record,normalized.operation),r=result.record,id=createHash('sha256').update(JSON.stringify([r.provider,r.connectionId,r.channelId,r.messageId])).digest('hex');
   this.options.operator.reviseMessage(tenant,{...r,id},normalized.operation==='delete');this.options.publish(tenant);this.options.store.received(tenant,normalized.receipt);
   return json(response,202,{accepted:true,duplicate:result.duplicate});
  }
  tenant=typeof request.headers['x-spmt-tenant']==='string'?request.headers['x-spmt-tenant']:'';const token=this.options.accessToken(request);if(!tenant||!token)return json(response,401,{message:'Sign in to manage Social Stream'});
  const principal=this.options.auth.authorize(token,request.method==='GET'?'commlink:read':'commlink:write',tenant),workspace=this.options.control.getTenant(tenant);
  if(principal.actorType!=='user'||principal.actorId!==workspace.ownerUserId||workspace.status!=='active')return json(response,403,{message:'Only the workspace owner can manage Social Stream'});
  if(request.method==='GET')return json(response,200,{...this.options.store.status(tenant),privateMessages:this.options.store.privateMessages(tenant),ingestPath:'/v1/commlink/social-stream/'+encodeURIComponent(tenant)});
  if(request.method!=='POST')return json(response,405,{message:'Method is not supported'});
  const origin=request.headers.origin;if(origin&&new URL(origin).host!==request.headers.host)return json(response,403,{message:'Use this workspace to manage the bridge'});
  const body=await readJson(request);if(body.action==='clear-private'){this.options.store.clearPrivate(tenant);return json(response,200,{cleared:true})}if(body.action==='rotate')return json(response,200,{token:this.options.store.rotate(tenant)});if(body.action==='disable'){this.options.store.disable(tenant);return json(response,200,{disabled:true})}throw Error('Choose rotate or disable');
 }catch(error){if(match[1]&&tenant)this.options.store.failed(tenant);return json(response,400,{message:error instanceof Error?error.message:'Social Stream request failed'})}}
}
async function readJson(request:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>64000)throw Error('Social Stream request is too large');chunks.push(Buffer.from(chunk))}const body=JSON.parse(Buffer.concat(chunks).toString());if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Expected an object');return body}
function json(response:ServerResponse,status:number,body:unknown){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(body));return true}
