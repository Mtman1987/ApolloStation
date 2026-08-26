import assert from "node:assert/strict";
import test from "node:test";
import {
  STREAMWEAVER_GYM_TEAM_SIZE,
  STREAMWEAVER_POKEMON_PACK_SIZE,
  STREAMWEAVER_POKEMON_TRADE_TIMEOUT_MS,
  acceptStreamWeaverPokemonTrade,
  attackStreamWeaverGymBattle,
  createStreamWeaverGymBattle,
  defaultStreamWeaverPokemonCollection,
  findStreamWeaverPokemonTradeCard,
  initiateStreamWeaverPokemonTrade,
  joinStreamWeaverGymQueue,
  offerStreamWeaverPokemonTradeCard,
  openStreamWeaverPokemonPack,
  setStreamWeaverGymTeam,
  switchStreamWeaverGymBattle,
  toStreamWeaverGymCard,
} from "../apps/streamweaver/dist/index.js";

function standardSet(){
  const cards=[];
  for(let i=0;i<6;i++)cards.push({name:`Common ${i}`,number:`c${i}`,setCode:"base1",rarity:"Common",supertype:"Pokémon"});
  for(let i=0;i<4;i++)cards.push({name:`Uncommon ${i}`,number:`u${i}`,setCode:"base1",rarity:"Uncommon",supertype:"Pokémon"});
  cards.push({name:"Rare One",number:"r1",setCode:"base1",rarity:"Rare",supertype:"Pokémon"});
  cards.push({name:"Energy",number:"e1",setCode:"base1",rarity:"Common",supertype:"Energy"});
  return cards;
}

test("StreamWeaver Pokemon packs preserve donor nine-card composition and season stamping",()=>{
  const collection=defaultStreamWeaverPokemonCollection();
  const result=openStreamWeaverPokemonPack({username:"Captain",setCode:"base1",setName:"Base Set",cards:standardSet(),collection,seasonId:"season-1",random:()=>0,now:new Date("2026-08-26T12:00:00Z")});
  assert.equal(result.pack.length,STREAMWEAVER_POKEMON_PACK_SIZE);
  assert.equal(result.pack.filter((card)=>card.rarity==="Common").length>=5,true);
  assert.equal(collection.cards.length,9);assert.equal(collection.packsOpened,1);assert.equal(collection.cards[0].seasonId,"season-1");
});

test("StreamWeaver Pokemon trade is tenant scoped, two-party accepted and revalidates offered indices",()=>{
  assert.equal(STREAMWEAVER_POKEMON_TRADE_TIMEOUT_MS,120000);
  const a=defaultStreamWeaverPokemonCollection(),b=defaultStreamWeaverPokemonCollection();
  a.cards.push({name:"Pikachu",number:"58",setCode:"base1",rarity:"Common"});b.cards.push({name:"Eevee",number:"51",setCode:"base1",rarity:"Common"});
  const trade=initiateStreamWeaverPokemonTrade("tenant-a","Alice","Bob",1000);
  assert.equal(findStreamWeaverPokemonTradeCard(a.cards,"base1-58").length,1);
  offerStreamWeaverPokemonTradeCard(trade,"alice",a.cards,"base1-58");offerStreamWeaverPokemonTradeCard(trade,"bob",b.cards,"Eevee 51");
  let result=acceptStreamWeaverPokemonTrade(trade,"alice",{alice:a,bob:b},2000);assert.equal(result.completed,false);
  result=acceptStreamWeaverPokemonTrade(trade,"bob",{alice:a,bob:b},2000);assert.equal(result.completed,true);assert.equal(a.cards[0].name,"Eevee");assert.equal(b.cards[0].name,"Pikachu");
});

test("StreamWeaver gym team and queue preserve three-card donor rule",()=>{
  assert.equal(STREAMWEAVER_GYM_TEAM_SIZE,3);assert.deepEqual(setStreamWeaverGymTeam(["a","b","c"]),["a","b","c"]);assert.throws(()=>setStreamWeaverGymTeam(["a","a","b"]),/three unique/);
  assert.deepEqual(joinStreamWeaverGymQueue([],"viewer","captain",3),["viewer"]);assert.throws(()=>joinStreamWeaverGymQueue([],"captain","captain",10),/does not queue/);assert.throws(()=>joinStreamWeaverGymQueue([],"viewer","captain",2),/three Pokemon/);
});

test("StreamWeaver gym battle alternates turns, adds energy, applies weakness and supports switching",()=>{
  const fire=toStreamWeaverGymCard({name:"Charmander",number:"1",setCode:"base1",rarity:"Common",hp:"40",types:["Fire"],attacks:[{name:"Ember",cost:["Fire"],damage:"20"}]});
  const grass=toStreamWeaverGymCard({name:"Bulbasaur",number:"2",setCode:"base1",rarity:"Common",hp:"50",types:["Grass"],attacks:[{name:"Vine",cost:["Grass"],damage:"10"}],weaknesses:[{type:"Fire",value:"×2"}]});
  const filler=toStreamWeaverGymCard({name:"Eevee",number:"3",setCode:"base1",rarity:"Common",hp:"50",types:["Colorless"],attacks:[{name:"Tackle",cost:["Colorless"],damage:"10"}]});
  const battle=createStreamWeaverGymBattle("viewer",[fire,filler,filler],"captain",[grass,filler,filler],1000);
  let first=attackStreamWeaverGymBattle(battle,"viewer",1000);assert.equal(first.attacked,false);assert.equal(battle.currentTurn,"gymLeader");assert.equal(battle.gymLeader.energy.length,1);
  switchStreamWeaverGymBattle(battle,"captain",2000);assert.equal(battle.currentTurn,"challenger");assert.equal(battle.challenger.energy[0],"Fire");
  const hit=attackStreamWeaverGymBattle(battle,"viewer",3000);assert.equal(hit.attacked,true);assert.equal(hit.damage,20); // switched target is neutral
});
