import assert from "node:assert/strict";
import test from "node:test";
import { applyQuackverseBattleAction, QUACKVERSE_VICTORY_TARGET } from "../apps/nebula-arcade/dist/quackverse-battle.js";
import { defaultQuackverseState } from "../apps/nebula-arcade/dist/quackverse-state.js";

const cards = new Map([
  [1,{id:1,name:"Captain Ranger Starlash",atk:9,def:8,spd:7,spc:9,hp:16,role:"Commander"}],
  [7,{id:7,name:"Moonbeam McQuackers",atk:4,def:5,spd:6,spc:9,hp:10,role:"Support"}],
  [9,{id:9,name:"Voidwing Von Quack",atk:8,def:6,spd:7,spc:9,hp:12,role:"Anti-Hero"}],
]);
const catalog={get(id){return cards.get(id);}};
function state(){const s=defaultQuackverseState(new Date("2026-08-26T12:00:00Z"));s.squads.playerOne=[1,7];s.squads.playerTwo=[9];return s;}

test("Quackverse deployment stays on the back row and consumes the turn movement action",()=>{
  const result=applyQuackverseBattleAction(state(),{kind:"deploy",playerId:"playerOne",cardId:1,to:42},catalog,new Date("2026-08-26T12:00:01Z"));
  assert.equal(result.state.grid[42].cardId,1);
  assert.equal(result.state.turnActions.playerOne.deployedOrMoved,true);
  assert.throws(()=>applyQuackverseBattleAction(result.state,{kind:"move",playerId:"playerOne",from:42,to:35},catalog),/deploy or move/);
  assert.throws(()=>applyQuackverseBattleAction(state(),{kind:"deploy",playerId:"playerOne",cardId:1,to:35},catalog),/back row/);
});

test("Quackverse attacks are adjacent, once per piece per turn, award KO points and build special meter",()=>{
  const s=state();
  s.grid[35]={owner:"playerOne",cardId:1,currentHp:16,maxHp:16,instanceId:"p1-a"};
  s.grid[28]={owner:"playerTwo",cardId:9,currentHp:2,maxHp:12,instanceId:"p2-a"};
  const result=applyQuackverseBattleAction(s,{kind:"attack",playerId:"playerOne",from:35,to:28},catalog);
  assert.equal(result.state.grid[28],null);
  assert.equal(result.state.koCount.playerOne,1);
  assert.equal(result.state.score.playerOne,1);
  assert.ok(result.state.grid[35].specialCurrent>0);
  assert.equal(result.state.battlePiles.playerTwo.discardPile[0].cardId,9);
});

test("Quackverse end turn draws for the next player and resets the completed player's actions",()=>{
  const s=state();
  s.turnActions.playerOne={deployedOrMoved:true,attacked:["x"],usedAbility:[],equipped:[]};
  s.battlePiles.playerTwo.drawPile=[{instanceId:"draw-9",cardId:9}];
  const result=applyQuackverseBattleAction(s,{kind:"end-turn",playerId:"playerOne"},catalog);
  assert.equal(result.state.activePlayer,"playerTwo");
  assert.equal(result.state.turnNumber,2);
  assert.deepEqual(result.state.turnActions.playerOne,{deployedOrMoved:false,attacked:[],usedAbility:[],equipped:[]});
  assert.equal(result.state.battlePiles.playerTwo.hand.length,1);
});

test("Quackverse scores a non-back-row three-piece Battle Line only once and caps formation VP",()=>{
  const s=state();
  s.grid[28]={owner:"playerOne",cardId:1,currentHp:16,maxHp:16,instanceId:"a"};
  s.grid[29]={owner:"playerOne",cardId:7,currentHp:10,maxHp:10,instanceId:"b"};
  s.grid[30]={owner:"playerOne",cardId:1,currentHp:16,maxHp:16,instanceId:"c"};
  const first=applyQuackverseBattleAction(s,{kind:"end-turn",playerId:"playerOne"},catalog);
  assert.equal(first.state.formationVp.playerOne,1);
  assert.equal(first.state.score.playerOne,1);
  first.state.activePlayer="playerOne";
  const second=applyQuackverseBattleAction(first.state,{kind:"end-turn",playerId:"playerOne"},catalog);
  assert.equal(second.state.formationVp.playerOne,1);
  assert.equal(second.state.score.playerOne,1);
});

test("Quackverse settles the match at the donor six-point victory target",()=>{
  const s=state();
  s.score.playerOne=QUACKVERSE_VICTORY_TARGET-1;
  s.grid[35]={owner:"playerOne",cardId:1,currentHp:16,maxHp:16,instanceId:"p1"};
  s.grid[28]={owner:"playerTwo",cardId:9,currentHp:1,maxHp:12,instanceId:"p2"};
  const result=applyQuackverseBattleAction(s,{kind:"attack",playerId:"playerOne",from:35,to:28},catalog);
  assert.equal(result.state.winner,"playerOne");
  assert.match(result.events.at(-1).message,/wins/);
});