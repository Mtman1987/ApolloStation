import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {handleTwitchLoginRoute,twitchLoginConfigFrom,verifyTwitchSessionCookie,TWITCH_SESSION_COOKIE,TWITCH_STATE_COOKIE} from '../apps/hearmeout/dist/twitch-login.js';
import {createGuestCookieValue,guestConfigFrom} from '../apps/hearmeout/dist/guest-session.js';

// HMO-001 Twitch login. The fake fetch stands in for id.twitch.tv and api.twitch.tv.
// Checks: state binding, fixed error codes, the session cookie, and that the access
// token and client secret never reach a response.

const SECRET='twitch-test-signing-secret-0123456789-abc';
const CLIENT_SECRET='client-secret-value-XYZ-987';
const ACCESS_TOKEN='access-token-value-QWE-555';
const env={
 HEARMEOUT_GUEST_SECRET:SECRET,
 HEARMEOUT_GUEST_TENANT:'tenant-a',
 TWITCH_CLIENT_ID:'client-id-abc',
 TWITCH_CLIENT_SECRET:CLIENT_SECRET,
 TWITCH_REDIRECT_URI:'https://hearmeout.example.test/api/auth/twitch/callback',
};
const config=twitchLoginConfigFrom(env);

function twitchFetch({tokenOk=true,userOk=true,users=[{id:'4242',login:'streamer',display_name:'Streamer'}]}={}){
 const calls=[];
 const impl=async(input,init={})=>{
  const url=String(input);
  calls.push({url,init});
  if(url.startsWith('https://id.twitch.tv/oauth2/token'))return tokenOk?new Response(JSON.stringify({access_token:ACCESS_TOKEN}),{status:200,headers:{'content-type':'application/json'}}):new Response('no',{status:400});
  if(url.startsWith('https://api.twitch.tv/helix/users'))return userOk?new Response(JSON.stringify({data:users}),{status:200,headers:{'content-type':'application/json'}}):new Response('no',{status:401});
  throw new Error('unexpected url '+url);
 };
 return {impl,calls};
}

async function serve(cfg,path,{method='GET',cookie,fetchDeps={}}={}){
 const server=createServer((request,response)=>{
  handleTwitchLoginRoute(request,response,new URL(request.url??'/','https://hearmeout.example.test'),cfg,fetchDeps).then(handled=>{if(!handled){response.statusCode=418;response.end('fallthrough')}});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const headers=cookie?{cookie}:{};
  const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,redirect:'manual',headers});
  return{status:response.status,location:response.headers.get('location')??'',setCookie:response.headers.getSetCookie?.()??[],body:await response.text(),headers:response.headers};
 } finally{server.close()}
}

test('twitch config needs client id, secret, redirect, and guest signing config',()=>{
 assert.equal(twitchLoginConfigFrom({...env,TWITCH_CLIENT_SECRET:''}),undefined);
 assert.equal(twitchLoginConfigFrom({...env,TWITCH_REDIRECT_URI:''}),undefined);
 assert.equal(twitchLoginConfigFrom({...env,HEARMEOUT_GUEST_SECRET:''}),undefined);
 assert.equal(twitchLoginConfigFrom({...env,TWITCH_REDIRECT_URI:'http://evil.example.test/cb'}),undefined,'plain http off loopback');
 assert.equal(twitchLoginConfigFrom({...env,TWITCH_REDIRECT_URI:'not a url'}),undefined);
 assert.equal(twitchLoginConfigFrom({...env,TWITCH_REDIRECT_URI:'http://127.0.0.1:3000/cb'}).redirectUri,'http://127.0.0.1:3000/cb');
 assert.ok(config);
});

test('login routes are a 404 when Twitch login is not configured',async()=>{
 const r=await serve(undefined,'/api/auth/twitch');
 assert.equal(r.status,404);
 assert.equal(r.setCookie.length,0);
});

test('start redirects to Twitch with a state that matches the HttpOnly state cookie',async()=>{
 const r=await serve(config,'/api/auth/twitch');
 assert.equal(r.status,302);
 const location=new URL(r.location);
 assert.equal(location.origin+location.pathname,'https://id.twitch.tv/oauth2/authorize');
 assert.equal(location.searchParams.get('client_id'),'client-id-abc');
 assert.equal(location.searchParams.get('response_type'),'code');
 assert.equal(location.searchParams.get('redirect_uri'),env.TWITCH_REDIRECT_URI);
 assert.equal(r.location.includes(CLIENT_SECRET),false);
 const state=location.searchParams.get('state');
 const cookie=r.setCookie.find(c=>c.startsWith(TWITCH_STATE_COOKIE+'='));
 assert.match(cookie,/HttpOnly/);
 assert.match(cookie,/SameSite=Lax/);
 assert.equal(cookie.split(';')[0],`${TWITCH_STATE_COOKIE}=${state}`);
});

test('callback without a matching state cookie fails closed and makes no Twitch call',async()=>{
 const fake=twitchFetch();
 const missing=await serve(config,'/api/auth/twitch/callback?code=abc&state=s1',{fetchDeps:{fetchImpl:fake.impl}});
 assert.equal(missing.status,302);
 assert.equal(missing.location,'/?login_error=twitch_state');
 const mismatch=await serve(config,'/api/auth/twitch/callback?code=abc&state=s1',{cookie:`${TWITCH_STATE_COOKIE}=s2`,fetchDeps:{fetchImpl:fake.impl}});
 assert.equal(mismatch.location,'/?login_error=twitch_state');
 assert.equal(fake.calls.length,0);
});

test('callback with an error parameter reports the denial and clears the state cookie',async()=>{
 const r=await serve(config,'/api/auth/twitch/callback?error=access_denied&state=s1',{cookie:`${TWITCH_STATE_COOKIE}=s1`});
 assert.equal(r.location,'/?login_error=twitch_denied');
 assert.match(r.setCookie[0],new RegExp(`^${TWITCH_STATE_COOKIE}=; Max-Age=0`));
});

test('successful callback issues a Twitch session cookie and leaks no token or secret',async()=>{
 const fake=twitchFetch();
 const r=await serve(config,'/api/auth/twitch/callback?code=code-1&state=s1',{cookie:`${TWITCH_STATE_COOKIE}=s1`,fetchDeps:{fetchImpl:fake.impl,now:Date.now()}});
 assert.equal(r.status,302);
 assert.equal(r.location,'/');
 const sessionCookie=r.setCookie.find(c=>c.startsWith(TWITCH_SESSION_COOKIE+'='));
 assert.match(sessionCookie,/HttpOnly/);
 for(const leak of [ACCESS_TOKEN,CLIENT_SECRET,SECRET]){
  assert.equal(r.location.includes(leak),false);
  assert.equal(r.body.includes(leak),false);
  assert.equal(r.setCookie.join(';').includes(leak),false,'cookie must not carry '+leak);
 }
 const token=/hmo_twitch=([^;]+)/.exec(sessionCookie)[1];
 const principal=verifyTwitchSessionCookie(token,config);
 assert.equal(principal.userId,'twitch_4242');
 assert.equal(principal.tenantId,'tenant-a');
 assert.equal(principal.displayName,'Streamer');
 assert.deepEqual(principal.roles,['member']);

 const tokenCall=fake.calls.find(c=>c.url.startsWith('https://id.twitch.tv/oauth2/token'));
 assert.equal(tokenCall.init.body.get('client_secret'),CLIENT_SECRET);
 assert.equal(tokenCall.init.body.get('redirect_uri'),env.TWITCH_REDIRECT_URI);
});

test('failed token exchange or invalid user record issues no session',async()=>{
 const badToken=twitchFetch({tokenOk:false});
 const a=await serve(config,'/api/auth/twitch/callback?code=c&state=s1',{cookie:`${TWITCH_STATE_COOKIE}=s1`,fetchDeps:{fetchImpl:badToken.impl}});
 assert.equal(a.location,'/?login_error=twitch_exchange');
 assert.equal(a.setCookie.some(c=>c.startsWith(TWITCH_SESSION_COOKIE+'=')),false);

 const badUser=twitchFetch({users:[{id:'../../admin',login:'x'}]});
 const b=await serve(config,'/api/auth/twitch/callback?code=c&state=s1',{cookie:`${TWITCH_STATE_COOKIE}=s1`,fetchDeps:{fetchImpl:badUser.impl}});
 assert.equal(b.location,'/?login_error=twitch_exchange');
 assert.equal(b.setCookie.some(c=>c.startsWith(TWITCH_SESSION_COOKIE+'=')),false);
});

test('a guest cookie does not verify as a Twitch session, and a wrong tenant is refused',()=>{
 const guest=guestConfigFrom(env);
 const guestCookie=createGuestCookieValue(guest);
 assert.equal(verifyTwitchSessionCookie(guestCookie,config),undefined);
 const otherTenant={...config,tenantId:'tenant-b'};
 const fake=twitchFetch();
 return serve(config,'/api/auth/twitch/callback?code=c&state=s1',{cookie:`${TWITCH_STATE_COOKIE}=s1`,fetchDeps:{fetchImpl:fake.impl}}).then(r=>{
  const token=/hmo_twitch=([^;]+)/.exec(r.setCookie.find(c=>c.startsWith(TWITCH_SESSION_COOKIE+'=')))[1];
  assert.equal(verifyTwitchSessionCookie(token,otherTenant),undefined);
 });
});

test('non-GET methods are refused',async()=>{
 const r=await serve(config,'/api/auth/twitch',{method:'POST'});
 assert.equal(r.status,405);
});
