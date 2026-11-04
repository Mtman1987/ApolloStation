import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDshApplicationStore } from '../apps/discord-stream-hub/dist/applications.js';
import { DshApplicationDecisionService } from '../apps/discord-stream-hub/dist/application-decision.js';
import { DshSuiteActionOperations } from '../apps/discord-stream-hub/dist/suite-action-operations.js';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'dsh-decision-parity-')),path=join(dir,'dsh.sqlite'),store=new SqliteDshApplicationStore(path);const application=store.submit({tenantId:'tenant',guildId:'123456789012345678',interactionId:'223456789012345678',type:'mod',applicantDiscordId:'323456789012345678',applicantUsername:'Candidate',answers:{}}).application;return{dir,path,store,application,close(){store.close();rmSync(dir,{recursive:true,force:true})}};}

test('suite approval uses the web template, agreement and durable notification receipt',async()=>{
  const f=fixture(),payloads=[],discord={async sendDirectMessage(tenant,user,payload){payloads.push(payload);return '423456789012345678';}};
  const operations=new DshSuiteActionOperations({applications:f.store,discord,publicOrigin:'https://apollo.example'});
  const input={action:'dsh.applications.decide',tenantId:'tenant',actorUserId:'owner',actorRole:'owner',idempotencyKey:'voice-request',args:{application:'Candidate',decision:'approved',note:'Welcome'}};
  try{
    f.store.saveTemplate('tenant','modApproved','A custom welcome');
    const result=await operations.decideApplication(input);assert.equal(result.notification,'sent');assert.equal(result.application.notification.messageId,'423456789012345678');
    assert.equal(payloads[0].embeds[0].description,'A custom welcome');const url=new URL(payloads[0].components[0].components[0].url);assert.equal(url.origin,'https://apollo.example');assert.equal(url.searchParams.get('agreement'),f.application.id);assert.ok(url.searchParams.get('token'));
    const retry=await operations.decideApplication(input);assert.equal(retry.notification,'sent');assert.equal(payloads.length,1);
    const web=new DshApplicationDecisionService(f.store,{discord,publicOrigin:'https://apollo.example'});await web.decide({tenantId:'tenant',applicationId:f.application.id,decision:'approved',actorUserId:'owner',note:'Welcome'});assert.equal(payloads.length,1);
    await assert.rejects(()=>operations.decideApplication({...input,args:{...input.args,decision:'rejected'}}),/different values/);
    const accepted=f.store.acceptAgreement({tenantId:'tenant',applicationId:f.application.id,token:url.searchParams.get('token'),spmtUserId:'candidate-user',discordUserId:f.application.applicantDiscordId,username:'Candidate',reviewedTerms:true,electronicConsent:true});assert.equal(accepted.acceptance.applicationId,f.application.id);
  }finally{f.close();}
});

test('notification retries survive restart and keep the same acceptance link and Discord nonce',async()=>{
  const f=fixture(),payloads=[];let now='2026-09-13T12:00:00.000Z';
  try{
    const failed=new DshApplicationDecisionService(f.store,{publicOrigin:'https://apollo.example',now:()=>now,discord:{async sendDirectMessage(t,u,p){payloads.push(p);throw Error('DM temporarily unavailable');}}});
    const result=await failed.decide({tenantId:'tenant',applicationId:f.application.id,decision:'approved',actorUserId:'owner'});assert.equal(result.notification,'unavailable');assert.equal(result.application.notification.attempts,1);
    const reopened=new SqliteDshApplicationStore(f.path);try{now='2026-09-13T12:01:00.000Z';const resumed=new DshApplicationDecisionService(reopened,{publicOrigin:'https://apollo.example',now:()=>now,discord:{async sendDirectMessage(t,u,p){payloads.push(p);return '523456789012345678';}}});await resumed.flush('tenant');assert.deepEqual(payloads[1],payloads[0]);assert.equal(payloads[1].enforce_nonce,true);assert.equal(reopened.get('tenant',f.application.id).notification.status,'delivered');await resumed.flush('tenant');assert.equal(payloads.length,2);}finally{reopened.close();}
  }finally{f.close();}
});

test('concurrent web and worker delivery claims send one DM; simulation leaves the application pending',async()=>{
  const f=fixture(),second=new SqliteDshApplicationStore(f.path);let release,started;const entered=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);let sent=0;
  try{
    const preview=new DshApplicationDecisionService(f.store,{preview:true,publicOrigin:'https://apollo.example',discord:{async sendDirectMessage(){return 'preview';}}});await preview.decide({tenantId:'tenant',applicationId:f.application.id,decision:'approved',actorUserId:'owner'});assert.equal(f.store.get('tenant',f.application.id).status,'pending');
    const discord={async sendDirectMessage(){sent++;started();await gate;return '623456789012345678';}},input={tenantId:'tenant',applicationId:f.application.id,decision:'rejected',actorUserId:'owner'};
    const first=new DshApplicationDecisionService(f.store,{discord}),other=new DshApplicationDecisionService(second,{discord});const pending=first.decide(input);await entered;const overlapping=await other.decide(input);assert.equal(overlapping.notification,'pending');release();await pending;await other.decide(input);assert.equal(sent,1);
  }finally{release?.();second.close();f.close();}
});
