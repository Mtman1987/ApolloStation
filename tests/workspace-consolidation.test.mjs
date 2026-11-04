import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpaceMountainWebHost } from '../apps/spacemountain-web/dist/server.js';
import { createIntegratedSpaceMountainWebHost } from '../apps/spacemountain-web/dist/integrated-server.js';
import { isListedApplication } from '../apps/spacemountain/dist/shell-ui-base.js';
import { AuthorityService, MemoryAuthorityStore } from '../packages/authority-core/dist/index.js';

const base = host => `http://127.0.0.1:${host.server.address().port}`;

test('Shipyard counts products while internal registrations and developer apps retain their identity', () => {
 const products=['streamweaver','hearmeout','nebula-arcade','discord-stream-hub','stellar-core'];
 const services=['commlink','chat-gateway','overlay-bay','mission-control','companion','mountainview','spacemountain','spmt-service'];
 assert.deepEqual([...products,...services].map(appId=>({appId})).filter(isListedApplication).map(a=>a.appId),products);
 assert.equal(isListedApplication({appId:'developer-app'}),true);
});

test('personal selection and display persist together without changing public output or another tenant', () => {
 const authority=new AuthorityService({store:new MemoryAuthorityStore()});
 authority.getOrCreateWorkspace('a');authority.getOrCreateWorkspace('b');
 const scenes=['one','two'].map(id=>({schemaVersion:1,id}));
 authority.updateWorkspace('a',1,{overlayScenes:scenes,activePublicOverlaySceneId:'one',activePersonalOverlaySceneId:'one'});
 const changed=authority.updateWorkspace('a',2,{activePersonalOverlaySceneId:'two',personalOverlayEnabled:false});
 assert.equal(changed.activePublicOverlaySceneId,'one');assert.equal(changed.activePersonalOverlaySceneId,'two');assert.equal(changed.personalOverlayEnabled,false);
 assert.equal(authority.getWorkspace('b').personalOverlayEnabled,undefined);
 assert.throws(()=>authority.updateWorkspace('a',3,{personalOverlayEnabled:'off'}),/boolean/);
 assert.throws(()=>authority.updateWorkspace('a',3,{activePersonalOverlaySceneId:'missing'}),/does not exist/);
 assert.throws(()=>authority.updateWorkspace('a',2,{personalOverlayEnabled:true}),/revision conflict/);
});

test('workspace embeds are frameable only by this ecosystem and devices use authenticated overlay hosting', async () => {
 const host=createSpaceMountainWebHost({spmtOrigin:'http://127.0.0.1:1',port:0,host:'127.0.0.1',fetchImpl:async()=>new Response('{}',{status:401})});
 await host.listen();
 try {
  for(const path of ['/?surface=workspace-service&view=workspace','/workspace/overlay']) {
   const r=await fetch(base(host)+path);assert.equal(r.status,200);assert.equal(r.headers.get('x-frame-options'),null);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  }
  const commlink=await fetch(base(host)+'/apps/commlink?surface=workspace-service');
  assert.equal(commlink.status,401,'Commlink workspace service must not render when tenant verification fails');
  const shell=await fetch(base(host)+'/');assert.match(shell.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(base(host)+'/api/personal-overlay-launch')).status,401);
  const services=await (await fetch(base(host)+'/api/platform/surfaces')).json();assert.equal(services.surfaces.find(s=>s.id==='worktray').path,'/?surface=workspace-popout');
  const viewer=await fetch(base(host)+'/assets/web/personal-overlay-client.js');assert.equal(viewer.status,200);
 } finally {await host.close()}
});

test('native app and old Mission Control routes lead to their designated surface', async () => {
 const host=createIntegratedSpaceMountainWebHost({spmtOrigin:'http://127.0.0.1:1',port:0,host:'127.0.0.1'});await host.listen();
 try {
  for(const id of ['companion','mountainview']){const r=await fetch(base(host)+'/apps/'+id,{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/downloads/'+id)}
  const windows=await fetch(base(host)+'/downloads/companion',{redirect:'manual'});assert.match(windows.headers.get('location'),/SpaceMountain-Companion-Setup\.exe$/);
  const android=await fetch(base(host)+'/downloads/mountainview',{redirect:'manual'});assert.match(android.headers.get('location'),/MountainView-Android\.apk$/);
  const mission=await fetch(base(host)+'/apps/mission-control',{redirect:'manual'});assert.equal(mission.headers.get('location'),'/?app=stellar-core&panel=mission-control');
 } finally {await host.close()}
});
