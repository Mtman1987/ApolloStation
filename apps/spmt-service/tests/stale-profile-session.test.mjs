import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpmtService } from '../dist/index.js';

for (const scenario of ['existing-profile', 'no-profile', 'invalid-donor']) {
  test(`stale profile browser recovery: ${scenario}`, async () => {
    const dir=mkdtempSync(join(tmpdir(),'apollo-stale-profile-'));
    let validations=0;
    const service=createSpmtService({databasePath:join(dir,'spmt.sqlite'),webhookKey:Buffer.alloc(32,23),runtimeMode:'production',host:'127.0.0.1',port:0,fetchImpl:async(input,init)=>{
      assert.equal(String(input),'https://spmt.live/api/auth/me');
      assert.equal(new Headers(init.headers).get('authorization'),'Bearer donor-token');
      validations++;
      return Response.json({user:{id:'owner-donor-id',username:'mtman1987'}},{status:scenario==='invalid-donor'?401:200});
    }});
    try {
      service.authority.ensureUser('stale-user');
      service.control.registerTenant({tenantId:'stale-tenant',ownerUserId:'stale-user',displayName:'Stale'});
      if(scenario!=='no-profile'){
        service.authority.ensureUser('canonical-owner');
        service.data.registerUser({userId:'canonical-owner',username:'mtman1987',displayName:'Existing Owner',password:'test-password-long-enough',tenantIds:['existing-tenant']});
        service.control.registerTenant({tenantId:'existing-tenant',ownerUserId:'canonical-owner',displayName:'Existing Workspace'});
        service.authority.getOrCreateWorkspace('existing-tenant');
      }
      const issued=service.auth.issueHumanSession({userId:'stale-user',scopes:['workspace:read'],tenantIds:['stale-tenant']});
      const browser=service.auth.issueBrowserSession(issued.accessToken);
      await service.listen();
      const response=await fetch(`http://127.0.0.1:${service.server.address().port}/v1/session`,{headers:{cookie:`spmt_token=${browser.accessToken}; spmt_donor_session=donor-token`,'x-spmt-app':'spacemountain'}});
      const body=await response.json();
      assert.equal(validations,1);
      if(scenario==='existing-profile'){
        assert.equal(response.status,200,JSON.stringify(body));
        assert.equal(body.actorId,'canonical-owner');
        assert.deepEqual(body.tenantIds,['existing-tenant']);
        assert.match(response.headers.get('set-cookie'),/spmt_token=/);
        assert.equal(service.data.getProfile('canonical-owner').displayName,'Existing Owner');
      }else{
        assert.notEqual(response.status,200);
        assert.equal(service.store.getUser('usr_ownerdonorid'),undefined,'no replacement identity created');
        assert.equal(service.store.getTenant('tenant_usr_ownerdonorid'),undefined,'no empty replacement workspace created');
      }
    }finally{await service.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
  });
}