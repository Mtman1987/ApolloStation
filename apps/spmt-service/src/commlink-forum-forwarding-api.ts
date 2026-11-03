import type {IncomingMessage,ServerResponse} from "node:http";
import type {AuthService} from "@spmt/auth-core";
import type {ControlService} from "@spmt/control-core";
import {CommlinkForumForwardingStore,type CommlinkForumForwardRuleV1} from "@spmt/commlink-core";
export class CommlinkForumForwardingApi{
 constructor(private readonly options:{store:CommlinkForumForwardingStore;auth:AuthService;control:ControlService;accessToken(request:IncomingMessage):string|undefined}){}
 async handle(request:IncomingMessage,response:ServerResponse,url:URL){
  const stateRoute=url.pathname==="/v1/commlink/forum-forwarding/state",match=/^\/v1\/commlink\/forum-forwarding\/rules(?:\/([0-9]{5,30}))?$/.exec(url.pathname);if(!match&&!stateRoute)return false;
  try{const token=this.options.accessToken(request),tenant=String(request.headers["x-spmt-tenant"]??"");if(!token||!tenant)return json(response,401,{message:"Sign in to manage forum forwarding"});
   const principal=this.options.auth.authorize(token,request.method==="GET"?"commlink:read":"commlink:write",tenant),workspace=this.options.control.getTenant(tenant);
   if(workspace.status!=="active")return json(response,403,{message:"Forum forwarding administration is unavailable"});
   if(stateRoute){if(principal.actorType!=="service")return json(response,403,{message:"Only trusted services may access forum forwarding receipts"});const sourceGuildId=String(url.searchParams.get("sourceGuildId")??""),sourceChannelId=String(url.searchParams.get("sourceChannelId")??"");if(request.method==="GET"){if(!sourceGuildId||!sourceChannelId)return json(response,400,{message:"Source guild and channel are required"});const thread=this.options.store.getThread(tenant,sourceGuildId,sourceChannelId),sourceMessageId=url.searchParams.get("sourceMessageId"),receipt=sourceMessageId?this.options.store.getReceipt(tenant,sourceGuildId,sourceChannelId,sourceMessageId):undefined;return json(response,200,{thread,receipt});}if(request.method==="PUT"){const body=await readJson(request);if(body.thread&&typeof body.thread==="object")this.options.store.setThread({...body.thread,tenantId:tenant} as any);if(body.receipt&&typeof body.receipt==="object")this.options.store.setReceipt({...body.receipt,tenantId:tenant} as any);return json(response,200,{saved:true});}return json(response,405,{message:"Method is not supported"});}
   if(principal.actorType!=="service"&&(principal.actorType!=="user"||workspace.ownerUserId!==principal.actorId))return json(response,403,{message:"Forum forwarding administration is owner-only"});
   const sourceGuildId=match?.[1];
   if(request.method==="GET")return json(response,200,{rules:this.options.store.listRules(tenant)});
   if(request.method==="PUT"){const body=await readJson(request),input=(body.rule&&typeof body.rule==="object"?body.rule:body) as Partial<CommlinkForumForwardRuleV1>;const rule=this.options.store.putRule({...input,schemaVersion:1,tenantId:tenant,sourceGuildId:sourceGuildId??String(input.sourceGuildId??"")} as CommlinkForumForwardRuleV1);return json(response,200,{rule});}
   if(request.method==="DELETE"){if(!sourceGuildId)return json(response,400,{message:"Source guild ID is required"});return json(response,200,{deleted:this.options.store.deleteRule(tenant,sourceGuildId),sourceGuildId});}
   return json(response,405,{message:"Method is not supported"});
  }catch(error){return json(response,400,{message:error instanceof Error?error.message:"Forum forwarding request failed"});}
 }
}
async function readJson(request:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>16000)throw Error("Forum forwarding request is too large");chunks.push(Buffer.from(chunk));}const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Expected an object");return value as Record<string,unknown>;}
function json(response:ServerResponse,status:number,value:unknown){response.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});response.end(JSON.stringify(value));return true;}
