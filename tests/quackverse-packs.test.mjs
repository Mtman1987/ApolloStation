import test from "node:test";
import assert from "node:assert/strict";
import {
  QUACKVERSE_BOOSTER_SIZE,
  QUACKVERSE_DECK_LIMIT,
  QUACKVERSE_PACK_SLOTS,
  activateQuackverseDeck,
  addQuackverseCardToDeck,
  defaultQuackverseCollection,
  openQuackverseBoosterPack,
  recordQuackverseDeckResult,
  removeQuackverseCardFromDeck,
  saveQuackverseDeck,
} from "../apps/nebula-arcade/dist/index.js";

function catalog(){
  const rarities=["Common","Uncommon","Rare","Epic","Legendary"];
  const cards=[];let id=1;
  for(const type of ["equipment","duck"]) for(const rarity of rarities) for(let copy=0;copy<3;copy++) cards.push({id:id++,name:`${type}-${rarity}-${copy}`,type,rarity});
  return cards;
}

test("Quackverse booster keeps donor nine-slot composition and rarity ordering",()=>{
  assert.equal(QUACKVERSE_PACK_SLOTS.length,9);
  const pack=openQuackverseBoosterPack(catalog(),()=>0.01);
  assert.equal(pack.length,QUACKVERSE_BOOSTER_SIZE);
  assert.equal(new Set(pack.map((card)=>card.id)).size,9);
  assert.equal(pack.filter((card)=>card.type==="equipment").length>=4,true);
  assert.equal(pack.filter((card)=>card.type==="duck").length>=4,true);
});

test("Quackverse deck cannot exceed owned copies or twenty cards",()=>{
  const collection=defaultQuackverseCollection();
  collection.cards=[1,1,...Array.from({length:20},(_,index)=>index+2)];
  addQuackverseCardToDeck(collection,1);
  addQuackverseCardToDeck(collection,1);
  assert.throws(()=>addQuackverseCardToDeck(collection,1),/owned copy/);
  for(const id of Array.from({length:18},(_,index)=>index+2)) addQuackverseCardToDeck(collection,id);
  assert.equal(collection.deck.length,QUACKVERSE_DECK_LIMIT);
  assert.throws(()=>addQuackverseCardToDeck(collection,20),/deck is full/);
  removeQuackverseCardFromDeck(collection,1);
  assert.equal(collection.deck.length,19);
});

test("Quackverse saved decks activate and keep independent win-loss records",()=>{
  const collection=defaultQuackverseCollection();collection.cards=[1,2,3,4,5];collection.deck=[1,2,3];
  const saved=saveQuackverseDeck(collection,{name:"First Fleet"},new Date("2026-08-26T12:00:00Z"));
  collection.deck=[4,5];collection.activeDeckId="default";
  activateQuackverseDeck(collection,saved.id);
  assert.deepEqual(collection.deck,[1,2,3]);
  recordQuackverseDeckResult(collection,true);
  assert.equal(collection.deckWins,1);
  assert.equal(collection.savedDecks[0].wins,1);
  assert.equal(collection.savedDecks[0].losses,0);
});

test("Quackverse refuses saved decks containing copies the collection does not own",()=>{
  const collection=defaultQuackverseCollection();collection.cards=[1];
  assert.throws(()=>saveQuackverseDeck(collection,{cardIds:[1,1]}),/more copies/);
});
