import { PlatformOperationError, PlatformOperations, type PlatformOperationNameV1 } from "@spmt/platform-ops";
export interface ApiRequestV1 { method: string; path: string; headers?: Record<string, string | undefined>; body?: unknown; }
export interface ApiResponseV1 { status: number; body?: unknown; }
export class PlatformApiAdapter {
  constructor(private readonly operations: PlatformOperations) {}
  handle(request: ApiRequestV1): ApiResponseV1 {
    try {
      const headers=lowerHeaders(request.headers??{}); const accessToken=bearer(headers.authorization); const tenantId=headers["x-spmt-tenant"]; const correlationId=headers["x-correlation-id"]; const body=request.body&&typeof request.body==="object"&&!Array.isArray(request.body)?request.body as Record<string,unknown>:{}; const url=new URL(`https://spmt.invalid${request.path}`); let operation:PlatformOperationNameV1; let input:Record<string,unknown>;
      if(request.method==="GET"&&url.pathname==="/v1/session"){operation="session.get";input={};}
      else if(request.method==="GET"&&url.pathname==="/v1/workspace/profile"){operation="workspace.get";input={tenantId:requiredTenant(tenantId)};}
      else if(request.method==="PATCH"&&url.pathname==="/v1/workspace/profile"){operation="workspace.update";input={tenantId:requiredTenant(tenantId),expectedRevision:body.expectedRevision,patch:body.patch};}
      else if(request.method==="GET"&&url.pathname==="/v1/xp/balance"){operation="xp.balance";input={tenantId:requiredTenant(tenantId),userId:url.searchParams.get("userId")??""};}
      else if(request.method==="POST"&&url.pathname==="/v1/xp/awards"){operation="xp.award";input={tenantId:requiredTenant(tenantId),...body,idempotencyKey:headers["idempotency-key"]??body.idempotencyKey};}
      else if(request.method==="POST"&&url.pathname==="/v1/events"){operation="events.publish";input={tenantId:requiredTenant(tenantId),...body,idempotencyKey:headers["idempotency-key"]??body.idempotencyKey};}
      else if(request.method==="GET"&&url.pathname==="/v1/apps"){operation="apps.list";input={};}
      else if(request.method==="GET"&&url.pathname==="/v1/apps/installs"){operation="apps.installs";input={tenantId:requiredTenant(tenantId)};}
      else if(request.method==="GET"&&/^\/v1\/apps\/[^/]+$/.test(url.pathname)){operation="apps.get";input={appId:segment(url,3)};}
      else if(request.method==="POST"&&/^\/v1\/apps\/[^/]+\/install$/.test(url.pathname)){operation="apps.install";input={tenantId:requiredTenant(tenantId),appId:segment(url,3),grantedScopes:body.grantedScopes};}
      else if(request.method==="POST"&&/^\/v1\/apps\/[^/]+\/disable$/.test(url.pathname)){operation="apps.disable";input={tenantId:requiredTenant(tenantId),appId:segment(url,3)};}
      else if(request.method==="GET"&&url.pathname==="/v1/entitlements"){operation="apps.entitlements";input={tenantId:requiredTenant(tenantId),...(url.searchParams.get("appId")?{appId:url.searchParams.get("appId")}:{})};}
      else if(request.method==="GET"&&url.pathname==="/v1/commlink/conversations"){operation="commlink.conversations";input={tenantId:requiredTenant(tenantId),...(url.searchParams.get("userId")?{userId:url.searchParams.get("userId")}:{})};}
      else if(request.method==="GET"&&url.pathname==="/v1/commlink/messages"){operation="commlink.messages";input={tenantId:requiredTenant(tenantId),conversationId:url.searchParams.get("conversationId")??""};}
      else if(request.method==="GET"&&url.pathname==="/v1/commlink/search"){operation="commlink.search";input={tenantId:requiredTenant(tenantId),query:url.searchParams.get("q")??"",...(url.searchParams.get("userId")?{userId:url.searchParams.get("userId")}:{})};}
      else if(request.method==="POST"&&url.pathname==="/v1/commlink/messages"){operation="commlink.send";input={tenantId:requiredTenant(tenantId),...body};}
      else if(request.method==="GET"&&url.pathname==="/v1/notifications"){operation="notifications.list";input={tenantId:requiredTenant(tenantId),...(url.searchParams.get("userId")?{userId:url.searchParams.get("userId")}:{})};}
      else if(request.method==="POST"&&/^\/v1\/notifications\/[^/]+\/read$/.test(url.pathname)){operation="notifications.read";input={tenantId:requiredTenant(tenantId),notificationId:segment(url,3),...body};}
      else if(request.method==="GET"&&url.pathname==="/v1/webhooks"){operation="webhooks.list";input={tenantId:requiredTenant(tenantId),...(url.searchParams.get("appId")?{appId:url.searchParams.get("appId")}:{})};}
      else if(request.method==="POST"&&url.pathname==="/v1/webhooks"){operation="webhooks.create";input={tenantId:requiredTenant(tenantId),...body};}
      else if(request.method==="POST"&&/^\/v1\/webhooks\/[^/]+\/disable$/.test(url.pathname)){operation="webhooks.disable";input={tenantId:requiredTenant(tenantId),webhookId:segment(url,3)};}
      else if(request.method==="GET"&&url.pathname==="/v1/athena/context"){operation="athena.context.list";input={tenantId:requiredTenant(tenantId),...(url.searchParams.get("userId")?{userId:url.searchParams.get("userId")}:{})};}
      else if(request.method==="PUT"&&url.pathname==="/v1/athena/context"){operation="athena.context.upsert";input={tenantId:requiredTenant(tenantId),...body};}
      else if(request.method==="GET"&&url.pathname==="/v1/athena/commands"){operation="athena.commands.list";input={};}
      else if(request.method==="PUT"&&url.pathname==="/v1/athena/commands"){operation="athena.commands.upsert";input=body;}
      else return {status:404,body:{error:"not_found"}};
      const result=this.operations.execute({name:operation,input},{accessToken,...(correlationId?{correlationId}:{})});return {status:200,body:result.result};
    } catch(error){if(error instanceof PlatformOperationError){const status=error.code==="unauthorized"?403:error.code==="not_found"?404:error.code==="conflict"?409:400;return{status,body:{error:error.code,message:error.message}};}return{status:500,body:{error:"internal"}};}
  }
}
function lowerHeaders(headers:Record<string,string|undefined>){return Object.fromEntries(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),value]));} function bearer(value?:string){if(!value?.startsWith("Bearer ")||value.length<=7)throw new PlatformOperationError("unauthorized","Bearer access token is required");return value.slice(7);} function requiredTenant(value?:string){if(!value)throw new PlatformOperationError("invalid","x-spmt-tenant is required");return value;} function segment(url:URL,index:number){return decodeURIComponent(url.pathname.split("/")[index]??"");}
