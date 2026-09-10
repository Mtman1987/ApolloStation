import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthDeniedError, type AuthService } from "@spmt/auth-core";
import type { ControlService } from "@spmt/control-core";
import type { AuthorityService } from "@spmt/authority-core";
import { CommlinkOperatorStore, type CommlinkLiveChatStore } from "@spmt/commlink-core";

export class CommlinkOperatorApi {
  private readonly published=new Map<string,number>();
  constructor(private readonly options:{store:CommlinkOperatorStore;chat:CommlinkLiveChatStore;auth:AuthService;control:ControlService;authority:AuthorityService;accessToken(request:IncomingMessage):string|undefined}){}
  publish(tenant:string) {
    const state=this.options.store.read(tenant),message=state.featured?state.snapshots?.[state.featured]??this.options.chat.list({tenantId:tenant,limit:500}).find(m=>recordId(m)===state.featured):undefined;
    if(state.revision===0||this.published.get(tenant)===state.revision)return state;
    this.options.authority.publishEvent({tenantId:tenant,sourceAppId:"commlink",type:"commlink.chat.featured.v1",idempotencyKey:`chat-feature:${state.revision}`,payload:{revision:state.revision,text:message?.text??"",username:message?.username??"",style:state.style,durationMs:state.durationSeconds*1000,clear:!message}});
    this.published.set(tenant,state.revision);return state;
  }
  async handle(request:IncomingMessage,response:ServerResponse,url:URL) {
    if(!/^\/v1\/commlink\/(operator|filters|ingestion-errors)$/.test(url.pathname))return false;
    try {
      const token=this.options.accessToken(request),tenant=String(request.headers['x-spmt-tenant']??"");if(!token||!tenant)return json(response,401,{message:"Sign in to use the chat desk"});
      const principal=this.options.auth.authorize(token,request.method==="GET"?"commlink:read":"commlink:write",tenant),workspace=this.options.control.getTenant(tenant);
      if(principal.actorType!=="user"||workspace.status!=="active")return json(response,403,{message:"Chat desk access denied"});
      const path=url.pathname.split('/').at(-1),user=principal.actorId;
      if(request.method==="GET"){
        if(path==="filters")return json(response,200,{filters:this.options.store.filters(tenant,user)});
        if(path==="operator") {
          const state=this.options.store.read(tenant);
          const current=this.options.chat.list({tenantId:tenant,limit:500}).map(m=>({...m,id:recordId(m)}));
          const ids=new Set(current.map(m=>m.id));
          const retained=Object.values(state.snapshots??{}).filter(m=>!ids.has(m.id));
          return json(response,200,{state,messages:[...retained,...current],canOperate:workspace.ownerUserId===user});
        }
        if(workspace.ownerUserId!==user)return json(response,403,{message:"Only the workspace owner can inspect ingestion failures"});
        return json(response,200,{failures:this.options.store.failures(tenant)});
      }
      if(request.method!=="POST")return json(response,405,{message:"Method is not supported"});
      const body=await readJson(request);
      if(path==="filters")return json(response,200,{filters:this.options.store.saveFilters(tenant,user,body.filters)});
      if(path==="ingestion-errors"&&workspace.ownerUserId===user&&body.action==="replay"){const id=Number(body.id),message=this.options.store.replay(tenant,id);if(message.tenantId!==tenant)throw Error("Ingestion tenant mismatch");const result=this.options.chat.ingest(message);this.options.store.completeReplay(tenant,id);return json(response,200,{replayed:true,duplicate:result.duplicate});}
      if(path!=="operator"||workspace.ownerUserId!==user)return json(response,403,{message:"Only the workspace owner can change stream presentation"});
      const messages=this.options.chat.list({tenantId:tenant,limit:500}).map(m=>({...m,id:recordId(m)}));
      if(body.action==="review"){
        const eventId=String(body.eventId??""),index=messages.findIndex(m=>m.id===eventId),message=messages[index];
        if(!message||message.isBot!==true)throw new Error("Choose a bot reply from this tenant");
        const prior=messages.slice(index+1).find(m=>m.provider===message.provider&&m.channelId===message.channelId&&!m.isBot);
        const prompt=prior?.text??String(body.prompt??"");
        const saved=this.options.store.saveTrainingExample({tenantId:tenant,personaKey:`public:${message.provider}:${message.providerUserId}`,messageKey:eventId,prompt,originalResponse:message.text,response:String(body.response??message.text),vote:body.vote as "positive"|"negative",weight:Number(body.weight) as 1|2|3,reviewerUserId:user,metadata:{provider:message.provider,channelId:message.channelId,botUsername:message.username}});
        return json(response,200,{saved});
      }
      const state=this.options.store.apply(tenant,body as Parameters<CommlinkOperatorStore['apply']>[1],messages.map(m=>m.id),messages);
      this.publish(tenant);return json(response,200,{state});
    }catch(error){return json(response,error instanceof AuthDeniedError?403:400,{message:error instanceof Error?error.message:"Chat desk request failed"});}
  }
}
async function readJson(request:IncomingMessage):Promise<Record<string,unknown>>{let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>32_000)throw new Error("Request is too large");chunks.push(Buffer.from(chunk));}const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Expected an object");return value;}
function json(response:ServerResponse,status:number,value:unknown){response.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});response.end(JSON.stringify(value));return true;}
function recordId(m:{provider:string;connectionId:string;channelId:string;messageId:string}){return createHash("sha256").update(JSON.stringify([m.provider,m.connectionId,m.channelId,m.messageId])).digest("hex");}
