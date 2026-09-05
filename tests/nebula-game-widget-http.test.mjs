import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createNebulaArcadeSandboxHost} from '../apps/nebula-arcade/dist/nebula-arcade-sandbox-server.js';
import {NEBULA_ARCADE_GAMES,NEBULA_IMPORTED_WIDGET_IDS,NEBULA_WIDGET_STAGE_JS,renderNebulaGameWidget,validateNebulaGameAction} from '../apps/nebula-arcade/dist/index.js';

test('all twenty game outputs resolve to working renderer documents and Chicken Royale includes its local renderer dependency',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nebula-widgets-')),host=createNebulaArcadeSandboxHost({databasePath:join(dir,'games.db'),tenantId:'tenant-a',channelId:'channel-a',port:0,host:'127.0.0.1'});
 try{await host.listen();const origin=`http://127.0.0.1:${host.server.address().port}`;
  for(const game of NEBULA_ARCADE_GAMES){const output=await fetch(`${origin}/overlay/arcade/${game.id}`);assert.equal(output.status,200,game.id);const html=await output.text();assert.match(html,new RegExp(`data-game="${game.id}"`));assert.doesNotMatch(html,/Runtime widget pending/);assert.match(output.headers.get('content-security-policy'),/frame-src 'self'/);
   if(game.id!=='tag'){const widget=await fetch(`${origin}/assets/nebula-arcade/widgets/${game.id}.html`);assert.equal(widget.status,200,game.id);const source=await widget.text();assert.match(source,/spmt.nebula.(input|state)/);assert.match(widget.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(widget.headers.get('content-security-policy'),/script-src 'self' 'unsafe-inline'/);for(const match of source.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:game.id});}
  }
  const three=await fetch(`${origin}/assets/nebula-arcade/widgets/thirdparty/three.min.js`);assert.equal(three.status,200);assert.match(three.headers.get('content-type'),/javascript/);assert.ok((await three.text()).length>100000);
  assert.equal((await fetch(`${origin}/assets/nebula-arcade/widgets/unknown.html`)).status,404);
  assert.deepEqual((await(await fetch(`${origin}/v1/nebula/game-inputs`)).json()).inputs,[]);
  const started=await fetch(`${origin}/v1/nebula/game-actions`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({gameId:'pixelbattle',action:'start',channel:'channel-a',username:'owner',isModerator:true})});assert.equal(started.status,200);
  const action=await fetch(`${origin}/v1/nebula/game-actions`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({gameId:'pixelbattle',action:'paint',args:['red','3','4'],channel:'channel-a',username:'owner'})});
  assert.equal(action.status,200);const feed=await(await fetch(`${origin}/v1/nebula/game-inputs`)).json();assert.equal(feed.inputs.at(-1).message,'!pixelbattle paint red 3 4');assert.deepEqual(feed.inputs.at(-1).gameIds,['pixelbattle']);
 }finally{await host.close();rmSync(dir,{recursive:true,force:true});}
});

test('widget ports use only controlled embedded input and stage script parses',()=>{
 new vm.Script(NEBULA_WIDGET_STAGE_JS);
 for(const id of NEBULA_IMPORTED_WIDGET_IDS){const html=renderNebulaGameWidget(id);assert.match(html,/new URLSearchParams\('embedded=1'\)/);assert.doesNotMatch(html,/iframe\.src\s*=\s*`https:/);assert.match(html,/event.source !== window.parent/);assert.match(html,/event.origin !== location.origin/);}
 assert.throws(()=>validateNebulaGameAction('pixelbattle','paint',['red','99','99']),/Unsupported/);
 assert.deepEqual(validateNebulaGameAction('pixelbattle','paint',['red','19','14']).args,['red','19','14']);
});
