import type { QuackverseCollectionState } from "./quackverse-state.js";

export type QuackverseCardTypeV1 = "duck" | "equipment" | string;
export type QuackverseRarityV1 = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary" | string;
export interface QuackversePackCardV1 { id:number; name:string; type:QuackverseCardTypeV1; rarity?:QuackverseRarityV1 }
export interface QuackversePackSlotV1 { type:"duck"|"equipment"|"any"; rarities:readonly QuackverseRarityV1[]; weights:readonly number[] }

export const QUACKVERSE_BOOSTER_SIZE = 9;
export const QUACKVERSE_DECK_LIMIT = 20;
export const QUACKVERSE_RARITY_ORDER:readonly QuackverseRarityV1[] = ["Common","Uncommon","Rare","Epic","Legendary"];
export const QUACKVERSE_PACK_SLOTS:readonly QuackversePackSlotV1[] = Object.freeze([
  {type:"equipment",rarities:["Common","Uncommon"],weights:[70,30]},
  {type:"equipment",rarities:["Common","Uncommon","Rare","Epic"],weights:[40,35,20,5]},
  {type:"equipment",rarities:["Common","Uncommon","Rare"],weights:[55,35,10]},
  {type:"equipment",rarities:["Uncommon","Rare","Epic"],weights:[70,25,5]},
  {type:"duck",rarities:["Common","Uncommon"],weights:[70,30]},
  {type:"duck",rarities:["Uncommon","Rare"],weights:[75,25]},
  {type:"duck",rarities:["Common","Uncommon","Rare","Epic"],weights:[45,35,15,5]},
  {type:"duck",rarities:["Uncommon","Rare","Epic"],weights:[70,25,5]},
  {type:"any",rarities:["Common","Uncommon","Rare","Epic","Legendary"],weights:[35,35,20,8,2]},
]);

export function weightedQuackverseRarity(slot:QuackversePackSlotV1,random=Math.random):QuackverseRarityV1{
  const total=slot.weights.reduce((sum,value)=>sum+Math.max(0,Number(value)||0),0);if(total<=0)return slot.rarities[0]??"Common";let cursor=random()*total;for(let index=0;index<slot.rarities.length;index++){cursor-=Math.max(0,Number(slot.weights[index])||0);if(cursor<0)return slot.rarities[index]!;}return slot.rarities.at(-1)??"Common";
}
function candidates(cards:readonly QuackversePackCardV1[],slot:QuackversePackSlotV1,rarity:QuackverseRarityV1,used:Set<number>){return cards.filter((card)=>(slot.type==="any"||card.type===slot.type)&&String(card.rarity||"Common")===String(rarity)&&!used.has(card.id));}
function fallbackCandidates(cards:readonly QuackversePackCardV1[],slot:QuackversePackSlotV1,used:Set<number>){return cards.filter((card)=>(slot.type==="any"||card.type===slot.type)&&!used.has(card.id));}
export function openQuackverseBoosterPack(cards:readonly QuackversePackCardV1[],random=Math.random):QuackversePackCardV1[]{
  if(!Array.isArray(cards)||cards.length===0)throw new Error("Quackverse card catalog is required");const used=new Set<number>(),pack:QuackversePackCardV1[]=[];
  for(const slot of QUACKVERSE_PACK_SLOTS){const rarity=weightedQuackverseRarity(slot,random);let pool=candidates(cards,slot,rarity,used);if(!pool.length)pool=fallbackCandidates(cards,slot,used);if(!pool.length)pool=cards.filter((card)=>!used.has(card.id));if(!pool.length)pool=cards;const picked=pool[Math.min(pool.length-1,Math.floor(random()*pool.length))]!;pack.push(picked);used.add(picked.id);}
  const order=new Map(QUACKVERSE_RARITY_ORDER.map((rarity,index)=>[rarity,index]));return pack.sort((left,right)=>(order.get(String(left.rarity||"Common"))??999)-(order.get(String(right.rarity||"Common"))??999)||left.id-right.id);
}
export function canAddQuackverseCardToDeck(collection:Pick<QuackverseCollectionState,"cards"|"deck">,cardId:number){if(collection.deck.length>=QUACKVERSE_DECK_LIMIT)return false;const owned=collection.cards.filter((id)=>id===cardId).length,inDeck=collection.deck.filter((id)=>id===cardId).length;return owned>inDeck;}
export function addQuackverseCardToDeck(collection:QuackverseCollectionState,cardId:number){if(!canAddQuackverseCardToDeck(collection,cardId))throw new Error(collection.deck.length>=QUACKVERSE_DECK_LIMIT?"Quackverse deck is full":"No available owned copy for deck.");collection.deck=[...collection.deck,cardId];collection.activeDeckId="default";return collection;}
export function removeQuackverseCardFromDeck(collection:QuackverseCollectionState,cardId:number){const index=collection.deck.indexOf(cardId);if(index>=0)collection.deck=collection.deck.filter((_id,itemIndex)=>itemIndex!==index);collection.activeDeckId="default";return collection;}
export function saveQuackverseDeck(collection:QuackverseCollectionState,input:{deckId?:string;name?:string;cardIds?:readonly number[]},now=new Date()){
  const ids=(input.cardIds??collection.deck).map(Number).filter(Number.isFinite).slice(0,QUACKVERSE_DECK_LIMIT);for(const id of new Set(ids)){if(ids.filter((value)=>value===id).length>collection.cards.filter((value)=>value===id).length)throw new Error("Saved deck contains more copies than the collection owns.");}
  const id=String(input.deckId||`qdeck-${now.getTime()}`).trim(),name=String(input.name||"Saved Deck").trim().slice(0,40)||"Saved Deck",existing=collection.savedDecks.find((deck)=>deck.id===id),timestamp=now.toISOString();const saved={id,name,cardIds:ids,wins:existing?.wins??0,losses:existing?.losses??0,createdAt:existing?.createdAt??timestamp,updatedAt:timestamp};collection.savedDecks=[saved,...collection.savedDecks.filter((deck)=>deck.id!==id)];collection.activeDeckId=id;collection.deck=[...ids];return saved;
}
export function activateQuackverseDeck(collection:QuackverseCollectionState,deckId:string){if(deckId==="default"){collection.activeDeckId="default";return collection.deck;}const saved=collection.savedDecks.find((deck)=>deck.id===deckId);if(!saved)throw new Error("Quackverse saved deck not found");collection.deck=[...saved.cardIds];collection.activeDeckId=saved.id;return collection.deck;}
export function recordQuackverseDeckResult(collection:QuackverseCollectionState,winner:boolean){if(winner)collection.deckWins++;else collection.deckLosses++;const active=collection.savedDecks.find((deck)=>deck.id===collection.activeDeckId);if(active){if(winner)active.wins++;else active.losses++;active.updatedAt=new Date().toISOString();}return collection;}
