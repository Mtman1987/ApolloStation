import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {
 GUEST_COOKIE,GUEST_TTL_SECONDS,createGuestCookieValue,guestConfigFrom,handleGuestAuthRoute,readCookie,verifyGuestCookieValue,
} from '../apps/hearmeout/dist/guest-session.js';

// Owner-approved Apollo guest session (HMO-001). Covers the signed cookie, expiry,
// tenant binding, route gating, and the rule that no secret reaches the response.

const SECRET='guest-test-secret-0123456789abcdef-XYZ';
const config={secret:SECRET,tenantId:'guest-tenant'};
const NOW=Date.UTC(2026,9,28,12,0,0);

test('guest config is off unless both secret (>=32 chars) and tenant are set',()=>{
 assert.equal(guestConfigFrom({}),undefined);
 assert.equal(guestConfigFrom({HEARMEOUT_GUEST_SECRET:'short',HEARMEOUT_GUEST_TENANT:'t'}),undefined);
 assert.equal(guestConfigFrom({HEARMEOUT_GUEST_SECRET:SECRET}),undefined);
 assert.deepEqual(guestConfigFrom({HEARMEOUT_GUEST_SECRET:SECRET,HEARMEOUT_GUEST_TENANT:'t'}),{secret:SECRET,tenantId:'t'});
});

test('a fresh cookie verifies to a unique guest member in the configured tenant',()=>{
 const a=createGuestCookieValue(config,NOW);
 const b=createGuestCookieValue(config,NOW);
 const pa=verifyGuestCookieValue(a,config,NOW);
 const pb=verifyGuestCookieValue(b,config,NOW);
 assert.equal(pa.tenantId,'guest-tenant');
 assert.match(pa.userId,/^guest_/);
 assert.notEqual(pa.userId,pb.userId);
 assert.deepEqual(pa.roles,['member']);
 assert.equal(a.includes(SECRET),false);
});

test('tampered, wrong-secret, malformed, and expired cookies are rejected',()=>{
 const value=createGuestCookieValue(config,NOW);
 const [payload,sig]=value.split('.');
 const forged=Buffer.from(JSON.stringify({sub:'guest_admin',tid:'guest-tenant',exp:9999999999})).toString('base64url');
 assert.equal(verifyGuestCookieValue(`${forged}.${sig}`,config,NOW),undefined,'payload swap');
 assert.equal(verifyGuestCookieValue(`${payload}.${sig.slice(0,-2)}aa`,config,NOW),undefined,'signature flip');
 assert.equal(verifyGuestCookieValue(value,{secret:'another-secret-0123456789abcdefghij',tenantId:'guest-tenant'},NOW),undefined,'wrong secret');
 assert.equal(verifyGuestCookieValue(value,{secret:SECRET,tenantId:'other-tenant'},NOW),undefined,'wrong tenant');
 assert.equal(verifyGuestCookieValue(`${value}.extra`,config,NOW),undefined,'extra segment');
 assert.equal(verifyGuestCookieValue('garbage',config,NOW),undefined,'malformed');
 assert.equal(verifyGuestCookieValue(undefined,config,NOW),undefined,'missing');
 assert.equal(verifyGuestCookieValue(value,config,NOW+GUEST_TTL_SECONDS*1000+1),undefined,'expired');
});

test('readCookie finds the named cookie among others',()=>{
 const request={headers:{cookie:`a=1; ${GUEST_COOKIE}=xyz.sig; b=2`}};
 assert.equal(readCookie(request,GUEST_COOKIE),'xyz.sig');
 assert.equal(readCookie({headers:{}},GUEST_COOKIE),undefined);
});

function serve(config,path,init={},now=NOW){
 const server=createServer((request,response)=>{
  const url=new URL(request.url??'/','http://hearmeout.test');
  handleGuestAuthRoute(request,response,url,config,now).then(handled=>{if(!handled){response.statusCode=418;response.end('fallthrough')}});
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',async()=>{
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={...(init.headers??{})};
  if(headers.origin==='__SELF__')headers.origin=base;
  try{
   const response=await fetch(base+path,{...init,headers});
   resolve({status:response.status,headers:response.headers,body:await response.text()});
  } finally{server.close()}
 }));
}

test('guest route is a 404 when the feature is not configured',async()=>{
 const r=await serve(undefined,'/api/auth/guest',{method:'POST',headers:{origin:'__SELF__'}});
 assert.equal(r.status,404);
 assert.equal(r.headers.get('set-cookie'),null);
});

test('guest route sets an HttpOnly cookie that never contains the secret',async()=>{
 const server=createServer((request,response)=>{
  handleGuestAuthRoute(request,response,new URL(request.url,'http://x'),config,NOW);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 try{
  const r=await fetch(`http://127.0.0.1:${port}/api/auth/guest`,{method:'POST',headers:{origin:`http://127.0.0.1:${port}`}});
  assert.equal(r.status,200);
  const cookie=r.headers.get('set-cookie');
  assert.match(cookie,/^hmo_guest=/);
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Lax/);
  assert.match(cookie,/Max-Age=43200/);
  assert.equal(cookie.includes(SECRET),false);
  const value=/hmo_guest=([^;]+)/.exec(cookie)[1];
  assert.equal(verifyGuestCookieValue(value,config,NOW).tenantId,'guest-tenant');
 } finally{server.close()}
});

test('guest route refuses requests without a same-origin header',async()=>{
 const r=await serve(config,'/api/auth/guest',{method:'POST'});
 assert.equal(r.status,403);
 assert.equal(r.headers.get('set-cookie'),null);
});

test('guest route refuses GET',async()=>{
 const r=await serve(config,'/api/auth/guest',{headers:{origin:'__SELF__'}});
 assert.equal(r.status,405);
});

test('logout expires the guest cookie',async()=>{
 const r=await serve(config,'/api/auth/guest/logout',{method:'POST',headers:{origin:'__SELF__'}});
 assert.equal(r.status,200);
 assert.match(r.headers.get('set-cookie'),/^hmo_guest=; Max-Age=0/);
});

test('other paths fall through',async()=>{
 const r=await serve(config,'/api/anything',{method:'POST',headers:{origin:'__SELF__'}});
 assert.equal(r.status,418);
});
