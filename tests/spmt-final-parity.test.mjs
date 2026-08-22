import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { SpmtMcpServer, SPMT_MCP_PROTOCOL_VERSION } from "../packages/mcp/dist/index.js";

function verifier() { return "v".repeat(64); }
function challenge(value) { return createHash("sha256").update(value,"ascii").digest("base64url"); }
async function jsonRequest(url, options={}) { const response=await fetch(url,options); const body=await response.json(); return {response,body}; }

async function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),"spmt-final-"));
  const deliveries=[];
  const service=createSpmtService({databasePath:join(dir,"spmt.db"),webhookKey:Buffer.alloc(32,9),port:0,host:"127.0.0.1",fetchImpl:async(url,options)=>{deliveries.push({url:String(url),options});return new Response("ok",{status:200});}});
  await service.listen();
  t.after(async()=>{await service.close();rmSync(dir,{recursive:true,force:true});});
  const address=service.server.address(); assert.ok(address&&typeof address!=="string");
  const base=`http://127.0.0.1:${address.port}`;
  const registration=await jsonRequest(`${base}/v1/auth/register`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"captain",displayName:"Captain",password:"correct-horse-battery-staple"})});
  assert.equal(registration.response.status,201);
  const tenantId=registration.body.tenantId; const userId=registration.body.profile.userId;
  const login=await jsonRequest(`${base}/v1/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"captain",password:"correct-horse-battery-staple"})});
  assert.equal(login.response.status,200); assert.match(login.response.headers.get("set-cookie")??"",/HttpOnly/);
  return {service,base,tenantId,userId,userToken:login.body.tokens.accessToken,deliveries};
}

test("human login and confidential OAuth preserve state, exact redirect, userinfo and one-time code semantics", async(t)=>{
  const f=await fixture(t); const secret="space-mountain-client-secret-12345";
  f.service.registerOAuthClient({clientId:"space-mountain",name:"SpaceMountain",redirectUris:["https://spacemountain.live/auth/callback"],scopes:["workspace:read","apps:read"],clientSecret:secret,requirePkce:false});
  const authorize=await fetch(`${f.base}/v1/oauth/authorize?client_id=space-mountain&redirect_uri=${encodeURIComponent("https://spacemountain.live/auth/callback")}&state=state-123&scope=${encodeURIComponent("workspace:read apps:read")}`,{headers:{authorization:`Bearer ${f.userToken}`},redirect:"manual"});
  assert.equal(authorize.status,302); const location=new URL(authorize.headers.get("location")); assert.equal(location.origin+location.pathname,"https://spacemountain.live/auth/callback"); assert.equal(location.searchParams.get("state"),"state-123"); const code=location.searchParams.get("code"); assert.ok(code);
  const exchange=await jsonRequest(`${f.base}/v1/oauth/token`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({grant_type:"authorization_code",code,client_id:"space-mountain",client_secret:secret,redirect_uri:"https://spacemountain.live/auth/callback"})}); assert.equal(exchange.response.status,200); assert.equal(exchange.body.user.userId,f.userId);
  const info=await jsonRequest(`${f.base}/v1/oauth/userinfo`,{headers:{authorization:`Bearer ${exchange.body.access_token}`}}); assert.equal(info.response.status,200); assert.equal(info.body.username,"captain"); assert.deepEqual(info.body.tenantIds,[f.tenantId]);
  const replay=await jsonRequest(`${f.base}/v1/oauth/token`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({grant_type:"authorization_code",code,client_id:"space-mountain",client_secret:secret,redirect_uri:"https://spacemountain.live/auth/callback"})}); assert.equal(replay.response.status,400);
  const wrongRedirect=await fetch(`${f.base}/v1/oauth/authorize?client_id=space-mountain&redirect_uri=${encodeURIComponent("https://evil.example/callback")}&state=s`,{headers:{authorization:`Bearer ${f.userToken}`},redirect:"manual"}); assert.equal(wrongRedirect.status,400);
});

test("public OAuth client requires PKCE S256 and preserves tenant membership",async(t)=>{
  const f=await fixture(t); const codeVerifier=verifier();
  f.service.registerOAuthClient({clientId:"public-reference",name:"Reference",redirectUris:["https://example.test/callback"],scopes:["workspace:read"],requirePkce:true});
  const authorize=await fetch(`${f.base}/v1/oauth/authorize?client_id=public-reference&redirect_uri=${encodeURIComponent("https://example.test/callback")}&state=abc&scope=workspace%3Aread&code_challenge=${challenge(codeVerifier)}&code_challenge_method=S256`,{headers:{authorization:`Bearer ${f.userToken}`},redirect:"manual"}); assert.equal(authorize.status,302); const code=new URL(authorize.headers.get("location")).searchParams.get("code"); assert.ok(code);
  const bad=await jsonRequest(`${f.base}/v1/oauth/token`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({grant_type:"authorization_code",code,client_id:"public-reference",redirect_uri:"https://example.test/callback",code_verifier:"x".repeat(64)})}); assert.equal(bad.response.status,400);
  const good=await jsonRequest(`${f.base}/v1/oauth/token`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({grant_type:"authorization_code",code,client_id:"public-reference",redirect_uri:"https://example.test/callback",code_verifier:codeVerifier})});
  // failed PKCE must not consume the code
  assert.equal(good.response.status,200); assert.deepEqual(good.body.user.tenantIds,[f.tenantId]);
});

test("Commlink, notifications, signed webhooks and Stellar Core metadata use scoped public operations",async(t)=>{
  const f=await fixture(t); const appId="flagship-app"; const credential="flagship-service-secret-123456789";
  f.service.control.registerApp({appId,name:"Flagship",description:"reference integration",version:"1",launchUrl:"https://example.test/",allowedScopes:[],surfaces:["standalone"],status:"active"});
  f.service.auth.registerServiceIdentity({serviceId:appId,credential,scopes:["commlink:read","commlink:write","commlink:any","notifications:send","notifications:read","notifications:any","webhooks:read","webhooks:write","events:write","stellar:context:read","stellar:context:write","stellar:context:any","stellar:capabilities:read","stellar:catalog:write"],tenantMode:"allow-list",tenantIds:[f.tenantId]});
  const serviceToken=f.service.auth.issueServiceAccess(appId,credential).accessToken; const headers={authorization:`Bearer ${serviceToken}`,"x-spmt-tenant":f.tenantId,"content-type":"application/json"};
  const conversation=await jsonRequest(`${f.base}/v1/commlink/conversations`,{method:"POST",headers,body:JSON.stringify({participantUserIds:[f.userId],kind:"app",title:"Flagship updates"})}); assert.equal(conversation.response.status,200);
  const message=await jsonRequest(`${f.base}/v1/commlink/messages`,{method:"POST",headers,body:JSON.stringify({conversationId:conversation.body.id,recipientUserIds:[f.userId],text:"Build is ready"})}); assert.equal(message.response.status,200);
  const search=await jsonRequest(`${f.base}/v1/commlink/search?q=ready&userId=${encodeURIComponent(f.userId)}`,{headers}); assert.equal(search.response.status,200); assert.equal(search.body[0].text,"Build is ready");
  const note=await jsonRequest(`${f.base}/v1/notifications`,{method:"POST",headers,body:JSON.stringify({userId:f.userId,type:"build.ready",title:"Ready",body:"Green build ready"})}); assert.equal(note.response.status,200);
  const userNotes=await jsonRequest(`${f.base}/v1/notifications`,{headers:{authorization:`Bearer ${f.userToken}`,"x-spmt-tenant":f.tenantId}}); assert.equal(userNotes.response.status,200); assert.equal(userNotes.body[0].title,"Ready");
  const webhook=await jsonRequest(`${f.base}/v1/webhooks`,{method:"POST",headers,body:JSON.stringify({url:"https://hooks.example.test/spmt",events:["workspace.changed"]})}); assert.equal(webhook.response.status,200); assert.ok(webhook.body.signingSecret); const stored=f.service.platformStore.getWebhook(webhook.body.webhook.id); assert.ok(stored); assert.ok(!JSON.stringify(stored).includes(webhook.body.signingSecret));
  const event=await jsonRequest(`${f.base}/v1/events`,{method:"POST",headers:{...headers,"idempotency-key":"workspace-1"},body:JSON.stringify({type:"workspace.changed",payload:{revision:2}})}); assert.equal(event.response.status,200); const outbox=await f.service.runOutboxOnce(); assert.equal(outbox.delivered,1); assert.equal(f.deliveries.length,1); const delivery=f.deliveries[0]; assert.equal(delivery.url,"https://hooks.example.test/spmt"); const signature=delivery.options.headers["x-spmt-signature"]; assert.match(signature,/^sha256=/); const timestamp=delivery.options.headers["x-spmt-timestamp"]; const eventId=delivery.options.headers["x-spmt-event-id"]; const expected=createHmac("sha256",webhook.body.signingSecret).update(`${timestamp}.${eventId}.${delivery.options.body}`).digest("hex"); assert.equal(signature,`sha256=${expected}`);
  const capability=await jsonRequest(`${f.base}/v1/stellar/capabilities`,{method:"PUT",headers,body:JSON.stringify({id:"stream.status",title:"Stream status",description:"Reads stream status",requiredScopes:["stream:read"],availability:"unavailable",unavailableReason:"StreamWeaver Green is not migrated yet"})}); assert.equal(capability.response.status,200); assert.equal(capability.body.availability,"unavailable");
  const context=await jsonRequest(`${f.base}/v1/stellar/context`,{method:"PUT",headers,body:JSON.stringify({userId:f.userId,kind:"summary",text:"Prefers concise stream summaries",tags:["preference"]})}); assert.equal(context.response.status,200);
  const contextList=await jsonRequest(`${f.base}/v1/stellar/context?userId=${encodeURIComponent(f.userId)}`,{headers}); assert.equal(contextList.response.status,200); assert.equal(contextList.body[0].text,"Prefers concise stream summaries");
  const legacyId="legacy-athena-client"; const legacyCredential="legacy-athena-client-secret-123456";
  f.service.auth.registerServiceIdentity({serviceId:legacyId,credential:legacyCredential,scopes:["athena:context:read","athena:context:write","athena:commands:read","athena:catalog:write"],tenantMode:"allow-list",tenantIds:[f.tenantId]});
  const legacyToken=f.service.auth.issueServiceAccess(legacyId,legacyCredential).accessToken; const legacyHeaders={authorization:`Bearer ${legacyToken}`,"x-spmt-tenant":f.tenantId,"content-type":"application/json"};
  const legacyContext=await jsonRequest(`${f.base}/v1/athena/context?userId=${encodeURIComponent(f.userId)}`,{headers:legacyHeaders}); assert.equal(legacyContext.response.status,200); assert.equal(legacyContext.body[0].text,"Prefers concise stream summaries");
  const legacyCapability=await jsonRequest(`${f.base}/v1/athena/commands`,{method:"PUT",headers:legacyHeaders,body:JSON.stringify({id:"legacy.status",title:"Legacy status",description:"Transition alias proof",requiredScopes:[],availability:"available"})}); assert.equal(legacyCapability.response.status,200); assert.equal(legacyCapability.body.id,"legacy.status");
  const legacyMcp=new SpmtMcpServer(f.service.operations).handle({jsonrpc:"2.0",id:9,method:"tools/call",params:{name:"spmt.athena.commands.list",arguments:{}}},{accessToken:legacyToken,protocolVersion:SPMT_MCP_PROTOCOL_VERSION}); assert.ok(legacyMcp.result.structuredContent.some((item)=>item.id==="legacy.status"));
});
