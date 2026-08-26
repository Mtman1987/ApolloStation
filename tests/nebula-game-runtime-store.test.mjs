import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SqliteNebulaGameRuntimeStore,
  joinNebulaGame,
  recordNebulaGameChatActivity,
  recordNebulaGameWin,
  setNebulaChannelGameRunning,
} from "../apps/nebula-arcade/dist/index.js";

function database(){const dir=mkdtempSync(join(tmpdir(),"nebula-runtime-"));return{dir,path:join(dir,"runtime.sqlite")};}

test("Nebula shared game runtime survives restart without becoming a second SPMT authority",()=>{
  const file=database();
  try{
    const first=new SqliteNebulaGameRuntimeStore(file.path);
    first.update("tenant-a",state=>{
      setNebulaChannelGameRunning(state,"captain","duck-hunt",true,new Date("2026-08-26T12:00:00Z"));
      const joined=joinNebulaGame(state,{userId:"1",username:"alpha",displayName:"Alpha",gameId:"duck-hunt"},new Date("2026-08-26T12:00:01Z"));
      recordNebulaGameChatActivity(state,{channel:"captain",userId:"1",username:"alpha",displayName:"Alpha",message:"hello",profileGameIds:["duck-hunt"]},Date.parse("2026-08-26T12:01:00Z"));
      recordNebulaGameWin(state,joined.player.id,"duck-hunt",2,new Date("2026-08-26T12:01:01Z"));
    });
    first.close();
    const second=new SqliteNebulaGameRuntimeStore(file.path),state=second.get("tenant-a"),player=state.players["twitch:1"];
    assert.equal(state.channels.captain.extraGameIds.includes("duck-hunt"),true);
    assert.equal(player.displayName,"Alpha");
    assert.equal(player.joinedGames["duck-hunt"].active,true);
    assert.equal(player.joinedGames["duck-hunt"].score,1);
    assert.equal(player.joinedGames["duck-hunt"].wins,1);
    assert.equal(player.gamePointsBalance,3);
    assert.equal(state.ledger.length,2);
    second.close();
  }finally{rmSync(file.dir,{recursive:true,force:true});}
});

test("Nebula game runtime storage is tenant isolated",()=>{
  const file=database();
  try{
    const store=new SqliteNebulaGameRuntimeStore(file.path);
    store.update("tenant-a",state=>joinNebulaGame(state,{userId:"1",username:"alpha",gameId:"bingo"}));
    store.update("tenant-b",state=>joinNebulaGame(state,{userId:"2",username:"beta",gameId:"quackverse"}));
    assert.deepEqual(Object.keys(store.get("tenant-a").players),["twitch:1"]);
    assert.deepEqual(Object.keys(store.get("tenant-b").players),["twitch:2"]);
    store.close();
  }finally{rmSync(file.dir,{recursive:true,force:true});}
});