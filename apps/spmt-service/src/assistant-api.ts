import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthDeniedError, type AuthService } from "@spmt/auth-core";
import type { ControlService } from "@spmt/control-core";
import type { ExecutionJobService } from "@spmt/execution-core";
import type { SqliteMediaAssetStore } from "@spmt/platform-data-sqlite";
import { StellarAssistantStore, StellarPrivateAssistant, STELLAR_CHAT_CAPABILITY_ID, STELLAR_SPEECH_CAPABILITIES, TTS_VOICE_OPTIONS } from "@spmt/stellar-core";

export class SpmtAssistantApi {
  constructor(private readonly options: { store: StellarAssistantStore; privateAssistant?:StellarPrivateAssistant; auth: AuthService; control: ControlService; jobs: ExecutionJobService; assets: SqliteMediaAssetStore; enabled: boolean; accessToken(request: IncomingMessage): string | undefined }) {}
  async handle(request: IncomingMessage, response: ServerResponse, url: URL) {
    if (!url.pathname.startsWith("/v1/assistant/")) return false;
    try {
      const tenant = header(request,"x-spmt-tenant") ?? url.searchParams.get("tenantId") ?? "", token = this.options.accessToken(request);
      if (!tenant || !token) return json(response,401,{message:"Sign in to use the assistant"});
      const write = !["GET","HEAD"].includes(request.method ?? "GET");
      const principal = this.options.auth.authorize(token,write?"assistants:invoke":"assistants:read",tenant);
      if (principal.actorType !== "user") return json(response,403,{message:"Use the signed-in user's assistant session"});
      if (this.options.control.getTenant(tenant).status !== "active") return json(response,403,{message:"Workspace is suspended"});
      const user = principal.actorId, path = url.pathname.slice("/v1/assistant/".length);
      if (request.method === "GET") {
        if (path === "preferences") return json(response,200,{preferences:this.options.store.preferences(tenant,user),voices:TTS_VOICE_OPTIONS.map(({id,label,description})=>({id,label,description}))});
        if (path === "notes") return json(response,200,{notes:this.options.store.notes(tenant,user)});
        if (path === "conversation" && this.options.privateAssistant) return json(response,200,{thread:this.options.privateAssistant.read(tenant,user)});
        if(path==="conversation/feed"&&this.options.privateAssistant)return json(response,200,this.options.privateAssistant.feed(tenant,user,Number(url.searchParams.get("after")??0),url.searchParams.get("epoch")??undefined));
        if (/^jobs\/[A-Za-z0-9._:-]+$/.test(path)) {
          const job=this.options.jobs.get(tenant,path.slice(5));
          if(!job||job.billedUserId!==user||job.capabilityId!==STELLAR_CHAT_CAPABILITY_ID||job.input.conversationId!==`stellar:private:${user}`)return json(response,404,{message:"Private assistant job was not found"});
          return json(response,200,{job});
        }
        if (/^speech\/jobs\/[A-Za-z0-9._:-]+$/.test(path)) {
          const job = this.options.jobs.get(tenant,path.split("/").at(-1)!);
          if (!job || job.billedUserId !== user || !STELLAR_SPEECH_CAPABILITIES.includes(job.capabilityId)) return json(response,404,{message:"Speech job was not found"});
          return json(response,200,{job});
        }
      }
      if (request.method === "DELETE" && path.startsWith("notes/")) { this.options.store.deleteNote(tenant,user,decodeURIComponent(path.slice(6))); return json(response,200,{deleted:true}); }
      if (request.method !== "POST") return json(response,405,{message:"Method is not supported"});
      const body = await readJson(request);
      if (path === "preferences") return json(response,200,this.options.store.savePreferences(tenant,user,body));
      if (path === "notes") return json(response,200,this.options.store.saveNote(tenant,user,body));
      if(path === "conversation/clear" && this.options.privateAssistant)return json(response,200,{thread:this.options.privateAssistant.clear(tenant,user)});
      if(["conversation","conversation/condense","persona/optimize"].includes(path)&&this.options.privateAssistant) {
        if(!this.options.enabled)return json(response,503,{message:"External assistant execution is disabled in this environment"});
        const appId=header(request,"x-spmt-app")??"streamweaver",key=header(request,"idempotency-key");
        if(!this.options.control.listInstalls(tenant).some(i=>i.appId===appId&&i.enabled))return json(response,403,{message:"Enable the source app in this workspace"});
        if(!key||key.length>200)return json(response,400,{message:"A request identifier is required"});
        if(path==="persona/optimize"&&this.options.control.getTenant(tenant).ownerUserId!==user)return json(response,403,{message:"Only the workspace owner can optimize its persona"});
        const result=path==="conversation"?this.options.privateAssistant.send(tenant,user,body.message,key,appId):path==="conversation/condense"?this.options.privateAssistant.summarize(tenant,user,body.title):this.options.privateAssistant.optimize(tenant,user,body.instructions,key,appId);
        return json(response,202,result);
      }
      if (!["speech/synthesize","speech/transcribe"].includes(path)) return json(response,404,{message:"Assistant route was not found"});
      if (!this.options.enabled) return json(response,503,{message:"External speech is disabled in this environment"});
      const capabilityId = path.endsWith("synthesize") ? STELLAR_SPEECH_CAPABILITIES[0]! : STELLAR_SPEECH_CAPABILITIES[1]!;
      if (!this.options.jobs.hasReadyWorker({executionOwner:"stellar-core",executionTarget:"sprite",capabilityId})) return json(response,503,{message:"No speech worker is currently available"});
      const appId = header(request,"x-spmt-app") ?? "streamweaver";
      if (!this.options.control.listInstalls(tenant).some(i=>i.appId===appId&&i.enabled)) return json(response,403,{message:"Enable the source app in this workspace"});
      const input: Record<string,unknown> = {kind:"stellar.speech.request.v1",remember:false,mediaVisibility:"private"};
      if (path.endsWith("synthesize")) {
        if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 20_000) return json(response,400,{message:"Speech text must contain 1–20000 characters"});
        const voice = body.voice ?? this.options.store.preferences(tenant,user).voice;
        if (!TTS_VOICE_OPTIONS.some(v=>v.id===voice)) return json(response,400,{message:"Choose a supported voice"});
        input.text = body.text; input.voice = voice;
      } else {
        const id = String(body.mediaAssetId ?? ""), asset = this.options.assets.get(id);
        if (!asset || asset.tenantId !== tenant || asset.ownerUserId !== user || !asset.contentType.startsWith("audio/")) return json(response,404,{message:"Your recording was not found"});
        input.mediaAssetIds=[id];
      }
      const idempotencyKey = header(request,"idempotency-key");
      if (!idempotencyKey || idempotencyKey.length > 200) return json(response,400,{message:"A request identifier is required"});
      const prior=this.options.jobs.findIdempotent(tenant,appId,user,idempotencyKey);
      if(prior&&(prior.capabilityId!==capabilityId||JSON.stringify(prior.input)!==JSON.stringify(input)))return json(response,409,{message:"Request identifier already used with different speech"});
      const result=this.options.jobs.create({tenantId:tenant,ownerAppId:appId,executionOwner:"stellar-core",capabilityId,requestedByType:"user",requestedById:user,billedUserId:user,meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"sprite",meteringTarget:"hosted",idempotencyKey,input});
      return json(response,202,{job:result.job});
    } catch(error) { return json(response,error instanceof AuthDeniedError?403:400,{message:error instanceof AuthDeniedError?"Assistant access denied":error instanceof Error?error.message:"Assistant request failed"}); }
  }
}
function header(request:IncomingMessage,name:string) { const value=request.headers[name];return typeof value==="string"?value:undefined; }
async function readJson(request:IncomingMessage):Promise<Record<string,unknown>> { const chunks:Buffer[]=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>100_000)throw new Error("Request is too large");chunks.push(Buffer.from(chunk));}const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Request must be an object");return value; }
function json(response:ServerResponse,status:number,value:unknown) { response.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});response.end(JSON.stringify(value));return true; }
