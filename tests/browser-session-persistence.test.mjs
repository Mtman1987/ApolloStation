import assert from 'node:assert/strict';
import test from 'node:test';
import {scryptSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthService} from '../packages/auth-core/dist/index.js';
import {SqliteAuthorityStore} from '../packages/authority-sqlite/dist/index.js';
import {createSpmtService} from '../apps/spmt-service/dist/index.js';
import {createSpaceMountainWebHost} from '../apps/spacemountain-web/dist/server.js';

test('browser session survives access expiry, long absence and authority restart until explicit logout',()=>{
  const dir=mkdtempSync(join(tmpdir(),'apollo-session-'));const path=join(dir,'auth.sqlite');let seconds=0;
  let store=new SqliteAuthorityStore(path);
  const now=()=>new Date(Date.UTC(2026,8,21)+seconds*1000).toISOString();
  let auth=new AuthService({store,now});
  try{
    const short=auth.issueHumanSession({userId:'user-a',scopes:['workspace:read'],tenantIds:['tenant-a']});
    const browser=auth.issueBrowserSession(short.accessToken);
    for(seconds of [899,900,1200,86400,400*86400])assert.equal(auth.authorize(browser.accessToken,'workspace:read','tenant-a').actorId,'user-a');
    assert.throws(()=>auth.authorize(short.accessToken,'workspace:read','tenant-a'),/expired/);
    assert.throws(()=>auth.authorize(browser.accessToken,'workspace:read','tenant-b'),/tenant/);
    store.close();store=new SqliteAuthorityStore(path);auth=new AuthService({store,now});
    assert.equal(auth.isBrowserSession(browser.accessToken),true);
    auth.revokeBrowserSession(browser.accessToken);
    assert.equal(auth.authenticateAccessToken(browser.accessToken),undefined);
    assert.throws(()=>auth.issueBrowserSession(browser.accessToken),/signed-in/);
    store.close();store=new SqliteAuthorityStore(path);auth=new AuthService({store,now});
    assert.equal(auth.authenticateAccessToken(browser.accessToken),undefined);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('browser login persists its HttpOnly cookie and logout revokes it through the web facade',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'apollo-session-http-'));
  const spmt=createSpmtService({databasePath:join(dir,'spmt.sqlite'),webhookKey:Buffer.alloc(32,9),host:'127.0.0.1',port:0,runtimeMode:'sandbox'});
  let web;
  try{
    await spmt.listen();web=createSpaceMountainWebHost({spmtOrigin:`http://127.0.0.1:${spmt.server.address().port}`,host:'127.0.0.1',port:0});await web.listen();
    const origin=`http://127.0.0.1:${web.server.address().port}`;
    // Legacy SPMT accounts may have passwords shorter than the sandbox's new-account policy.
    spmt.authority.ensureUser('usr_legacy-owner');
    spmt.control.registerTenant({tenantId:'tenant_legacy-owner',ownerUserId:'usr_legacy-owner',displayName:'Legacy Owner'});
    spmt.authority.getOrCreateWorkspace('tenant_legacy-owner');
    spmt.data.registerUser({userId:'usr_legacy-owner',username:'legacy-owner',displayName:'Legacy Owner',password:'initial-valid-password',tenantIds:['tenant_legacy-owner']});
    const legacyCredential=spmt.data.store.getUserCredential('usr_legacy-owner');
    spmt.data.store.putUserCredential('usr_legacy-owner',legacyCredential.salt,scryptSync('old-pass',legacyCredential.salt,32).toString('hex'));
    const legacyLogin=await fetch(origin+'/sandbox/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'legacy-owner',password:'old-pass'})});
    assert.equal(legacyLogin.status,200,'existing SPMT credentials must not be rejected by the new-account password-length rule');
    const legacyCookie=legacyLogin.headers.get('set-cookie').split(';')[0];
    const legacySession=await fetch(origin+'/v1/session',{headers:{cookie:legacyCookie}});
    assert.equal(legacySession.status,200);
    assert.equal((await legacySession.json()).actorId,'usr_legacy-owner');
    const registered=await fetch(origin+'/sandbox/auth/register',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'session-captain',displayName:'Captain',password:'session-test-password'})});
    assert.equal(registered.status,201);assert.doesNotMatch(await registered.text(),/accessToken|refreshToken/);
    const header=registered.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/Secure/);assert.match(header,/Max-Age=34560000/);
    const cookie=header.split(';')[0];const token=decodeURIComponent(cookie.slice('spmt_token='.length));assert.equal(spmt.auth.isBrowserSession(token),true);
    const session=await fetch(origin+'/v1/session',{headers:{cookie}});assert.equal(session.status,200);assert.match(session.headers.get('set-cookie'),/Max-Age=34560000/);await session.text();
    const principal=spmt.auth.authenticateAccessToken(token);
    const legacy=spmt.auth.issueHumanSession({userId:principal.actorId,scopes:principal.scopes,tenantIds:principal.tenantIds});
    const upgraded=await fetch(origin+'/v1/session',{headers:{cookie:`spmt_token=${legacy.accessToken}`}});
    assert.equal(upgraded.status,200);const upgradedHeader=upgraded.headers.get('set-cookie');assert.match(upgradedHeader,/Max-Age=34560000/);
    assert.equal(spmt.auth.isBrowserSession(decodeURIComponent(upgradedHeader.split(';')[0].slice('spmt_token='.length))),true);await upgraded.text();
    const denied=await fetch(origin+'/sandbox/auth/logout',{method:'POST',headers:{cookie,origin:'https://other.example'}});assert.equal(denied.status,403);await denied.text();assert.equal(spmt.auth.isBrowserSession(token),true);
    const logout=await fetch(origin+'/sandbox/auth/logout',{method:'POST',headers:{cookie,origin}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);await logout.text();
    const replay=await fetch(origin+'/v1/session',{headers:{cookie}});assert.equal(replay.status,403);await replay.text();
  }finally{if(web)await web.close();await spmt.close();rmSync(dir,{recursive:true,force:true});}
});
