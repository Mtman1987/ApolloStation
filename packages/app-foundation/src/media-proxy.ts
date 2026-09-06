import type {IncomingMessage,ServerResponse} from "node:http";
import {MEDIA_ASSET_MAX_BYTES} from "@spmt/contracts";
import {fetchAppSessionContext,requireSameOrigin,sendJson} from "./product-web.js";

/** Standalone app counterpart of the shell's media proxy. It forwards the user's session. */
export async function proxyAppMedia(input:{appId:string;spmtOrigin:string;request:IncomingMessage;response:ServerResponse;url:URL;fetchImpl?:typeof fetch}):Promise<boolean>{
  const {request,response,url}=input;if(!url.pathname.startsWith("/v1/media/")&&!url.pathname.startsWith("/v1/assistant/")&&!/^\/v1\/commlink\/(operator|filters|ingestion-errors)$/.test(url.pathname))return false;
  const method=request.method??"GET",publicRead=["GET","HEAD"].includes(method)&&/^\/v1\/media\/public\/[A-Za-z0-9_-]{43}$/.test(url.pathname);
  try{
    if(!["GET","HEAD","POST","DELETE"].includes(method))return sendJson(response,405,{message:"Media method is not supported"});
    if(!["GET","HEAD"].includes(method))requireSameOrigin(request);
    const context=publicRead?undefined:await fetchAppSessionContext({appId:input.appId,spmtOrigin:input.spmtOrigin,request});
    const headers=new Headers({accept:request.headers.accept??"application/json","x-spmt-app":input.appId});
    if(context)headers.set("x-spmt-tenant",context.tenantId);
    for(const name of ["cookie","authorization","content-type","idempotency-key","range"]){const value=request.headers[name];if(typeof value==="string")headers.set(name,value);}
    let body:Uint8Array|undefined;
    if(!["GET","HEAD"].includes(method)){const chunks:Buffer[]=[];let size=0;const maximum=url.pathname==="/v1/media/assets"?MEDIA_ASSET_MAX_BYTES:65536;for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>maximum)return sendJson(response,413,{message:"Media request is too large"});chunks.push(bytes);}body=Buffer.concat(chunks);}
    const upstream=await(input.fetchImpl??fetch)(input.spmtOrigin.replace(/\/$/,"")+url.pathname+url.search,{method,headers,...(body?{body:new Blob([new Uint8Array(body).buffer])}:{}),redirect:"error",signal:AbortSignal.timeout(30000)});
    if(Number(upstream.headers.get("content-length")??0)>MEDIA_ASSET_MAX_BYTES)return sendJson(response,502,{message:"Media response is too large"});
    const reader=upstream.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
    if(reader)try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MEDIA_ASSET_MAX_BYTES)return sendJson(response,502,{message:"Media response is too large"});chunks.push(part.value);}}finally{await reader.cancel();}
    const responseHeaders:Record<string,string>={"cache-control":"private, no-store","x-content-type-options":"nosniff"};
    for(const name of ["content-type","content-length","content-range","accept-ranges","content-disposition","cross-origin-resource-policy","access-control-allow-origin","access-control-expose-headers"]){const value=upstream.headers.get(name);if(value)responseHeaders[name]=value;}
    response.writeHead(upstream.status,responseHeaders);response.end(method==="HEAD"?undefined:Buffer.concat(chunks));return true;
  }catch(error){return sendJson(response,403,{message:error instanceof Error?error.message:"Media request failed"});}
}
