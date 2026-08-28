import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createIntegratedSpaceMountainWebHost as createBaseIntegratedHost, type IntegratedSpaceMountainWebHostOptions } from "./integrated-server-base.js";
import { validateSandboxWebEnvironment } from "./server.js";

const SPMT_OVERLAY=/^\/v1\/overlay(?:\/|$)/;
const NEBULA_RUNTIME=/^(?:\/v1\/nebula\/(?:game-actions|game-mixes|game-mix-state)(?:\/|$)|\/assets\/nebula-game-mix\.js$|\/overlay\/game-mix\/)/;

export function createIntegratedSpaceMountainWebHost(options:IntegratedSpaceMountainWebHostOptions){
  const base=createBaseIntegratedHost({...options,port:0,host:"127.0.0.1"});let basePort=0;
  const outer=createServer(async(request,response)=>{try{const url=new URL(request.url??"/","http://spacemountain.parity");
    if(SPMT_OVERLAY.test(url.pathname))return proxyDirect(request,response,options.spmtOrigin,url.pathname+url.search,true);
    if(NEBULA_RUNTIME.test(url.pathname)&&options.chatTagOrigin)return proxyDirect(request,response,options.chatTagOrigin,url.pathname+url.search,true);
    return proxyInner(request,response,basePort);
  }catch(error){if(!response.headersSent)json(response,500,{error:"parity_gateway_failure",message:error instanceof Error?error.message:"unknown error"});else response.destroy(error instanceof Error?error:undefined);}});
  return{server:outer,async listen(){await base.listen();const address=base.server.address();if(!address||typeof address==="string")throw new Error("SpaceMountain parity base host did not bind a TCP port");basePort=address.port;await listen(outer,options.port??8080,options.host??"0.0.0.0");},async close(){if(outer.listening)await close(outer);await base.close();}};
}

function proxyDirect(request:IncomingMessage,response:ServerResponse,originValue:string,path:string,rewriteOrigin:boolean){const target=new URL(originValue);if(target.protocol!=="http:"||!["127.0.0.1","localhost","[::1]"].includes(target.hostname))throw new Error("Internal parity proxy targets must be loopback HTTP");const headers={...request.headers};delete headers.connection;headers.host=target.host;if(rewriteOrigin&&headers.origin)headers.origin=target.origin;const upstream=httpRequest({hostname:target.hostname.replace(/^\[|\]$/g,""),port:Number(target.port||80),path,method:request.method,headers},(incoming)=>{response.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(response);});upstream.on("error",(error)=>response.headersSent?response.destroy(error):json(response,502,{error:"internal_proxy_unavailable",message:error.message}));request.pipe(upstream);}
function proxyInner(request:IncomingMessage,response:ServerResponse,port:number){if(!port)throw new Error("SpaceMountain parity base host is not ready");const headers={...request.headers};delete headers.connection;const upstream=httpRequest({hostname:"127.0.0.1",port,path:request.url??"/",method:request.method,headers},(incoming)=>{response.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(response);});upstream.on("error",(error)=>response.headersSent?response.destroy(error):json(response,502,{error:"base_host_unavailable",message:error.message}));request.pipe(upstream);}
function listen(server:ReturnType<typeof createServer>,port:number,host:string){return new Promise<void>((done,reject)=>{server.once("error",reject);server.listen(port,host,()=>{server.off("error",reject);done();});});}function close(server:ReturnType<typeof createServer>){return new Promise<void>((done,reject)=>server.close((error)=>error?reject(error):done()));}function json(response:ServerResponse,status:number,value:unknown){const body=Buffer.from(JSON.stringify(value));response.writeHead(status,{"content-type":"application/json; charset=utf-8","content-length":String(body.byteLength),"cache-control":"no-store"});response.end(body);}
export type { IntegratedSpaceMountainWebHostOptions };

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const checked=validateSandboxWebEnvironment(process.env);const host=createIntegratedSpaceMountainWebHost({spmtOrigin:checked.spmtOrigin,port:Number(process.env.PORT??8080),host:process.env.HOST??"0.0.0.0",buildSha:process.env.BUILD_SHA??"dev",...(checked.chatTagOrigin?{chatTagOrigin:checked.chatTagOrigin}:{}),...(checked.candidateManifest?{candidateManifest:checked.candidateManifest}:{})});await host.listen();}
