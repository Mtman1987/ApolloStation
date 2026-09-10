import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SqliteNebulaGameRuntimeStore,NebulaGameRuntimeCorruptionError} from '../apps/nebula-arcade/dist/game-runtime-store.js';
import {createNebulaArcadeLiveHost} from '../apps/nebula-arcade/dist/nebula-arcade-live-server.js';

function temp(){const dir=mkdtempSync(join(tmpdir(),'nebula-cutover-'));return{dir,path:join(dir,'arcade.sqlite'),close(){rmSync(dir,{recursive:true,force:true})}};}

test('corrupted shared game state fails closed and is never replaced with empty progress',()=>{
  const t=temp();let store=new SqliteNebulaGameRuntimeStore(t.path);
  try{
    store.put('tenant',{schemaVersion:1,channels:{},players:{alice:{id:'alice',username:'alice',displayName:'Alice',joinedGames:{},gamePointsBalance:42,lifetimeEarned:42,lifetimeSpent:0}},processedCommandIds:[],ledger:[]});
    store.close();
    const db=new DatabaseSync(t.path);db.prepare("UPDATE nebula_game_runtime SET body='not-json' WHERE tenant_id='tenant'").run();db.close();
    store=new SqliteNebulaGameRuntimeStore(t.path);
    assert.throws(()=>store.get('tenant'),NebulaGameRuntimeCorruptionError);
    assert.throws(()=>store.update('tenant',state=>{state.players={};}),NebulaGameRuntimeCorruptionError);
    const verify=new DatabaseSync(t.path,{readOnly:true});assert.equal(verify.prepare("SELECT body FROM nebula_game_runtime WHERE tenant_id='tenant'").get().body,'not-json');verify.close();
  }finally{try{store.close();}catch{}t.close();}
});

test('production readiness checks the internal runtime and persisted state',async()=>{
  const t=temp();const host=createNebulaArcadeLiveHost({databasePath:t.path,tenantId:'tenant',channelId:'room',spmtOrigin:'http://spmt.example',publicOrigin:'https://arcade.example',credential:'service-credential-that-is-long-enough',host:'127.0.0.1',port:0,buildSha:'cutover-test'});
  try{
    await host.listen();const origin=`http://127.0.0.1:${host.server.address().port}`;
    let response=await fetch(origin+'/health/ready');assert.equal(response.status,200);assert.equal((await response.json()).buildSha,'cutover-test');
    const db=new DatabaseSync(t.path);db.prepare("INSERT INTO nebula_game_runtime VALUES('broken','default','{','2026-01-01T00:00:00.000Z')").run();db.close();
    response=await fetch(origin+'/health/ready');assert.equal(response.status,503);assert.equal((await response.json()).ready,false);
  }finally{await host.close();t.close();}
});
