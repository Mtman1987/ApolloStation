import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { NormalizedChatMessageV1 } from "@spmt/contracts";
import { defaultBingoState, normalizeBingoState, getPersonalBingoBoard, personalBingoView, setPersonalBingoCenter, claimPersonalBingoSquare, resetPersonalBingoProgress, type BingoStateV1 } from "./bingo-game.js";
import { defaultQuackverseState, normalizeQuackverseState, normalizeQuackverseCollection, claimQuackverseSeat, recordQuackversePack, type QuackverseSavedState } from "./quackverse-state.js";
import { openQuackverseBoosterPack, addQuackverseCardToDeck, removeQuackverseCardFromDeck } from "./quackverse-packs.js";
import { applyQuackverseBattleAction } from "./quackverse-battle.js";
import { quackverseCards } from "./quackverse-data.js";

const cards = quackverseCards.map(card => ({ ...card, type: card.type.toLowerCase(), role: card.role ?? "", atk: card.atk ?? 0, def: card.def ?? 0, hp: card.hp ?? 0, spd: card.spd ?? 0, spc: card.spc ?? 0 }));
const catalog = { get: (id: number) => cards.find(card => card.id === id) };
// Editable starter phrases make a newly created shared board immediately playable.
export const NEBULA_BINGO_STARTER_PHRASES = ["Hello chat", "Welcome back", "Thank you", "Let's go", "One more game", "Good game", "Nice shot", "Well played", "Oh no", "We got this", "Ready", "Let's try again", "", "That was close", "Watch this", "I knew it", "No way", "Amazing", "Good luck", "See you", "All right", "Here we go", "Almost", "You did it", "Next round"];
export class SqliteNebulaTabletopRuntime {
  private readonly db: DatabaseSync;
  constructor(path: string) { this.db = new DatabaseSync(path, { timeout: 5000 }); this.db.exec("CREATE TABLE IF NOT EXISTS nebula_tabletop(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,game_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,channel_id,game_id)); CREATE TABLE IF NOT EXISTS nebula_tabletop_receipts(tenant_id TEXT NOT NULL,input_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(tenant_id,input_id))"); }
  close() { this.db.close(); }
  private read(tenant: string, channel: string, game: string): unknown { const row = this.db.prepare("SELECT body FROM nebula_tabletop WHERE tenant_id=? AND channel_id=? AND game_id=?").get(tenant,channel,game) as {body:string}|undefined; return row ? JSON.parse(row.body) : undefined; }
  private put(tenant: string, channel: string, game: string, value: unknown) { this.db.prepare("INSERT INTO nebula_tabletop VALUES(?,?,?,?) ON CONFLICT(tenant_id,channel_id,game_id) DO UPDATE SET body=excluded.body").run(tenant,channel,game,JSON.stringify(value)); }
  snapshot(tenant: string, channel: string, userId?: string) {
    const bingo = normalizeBingoState(this.read(tenant,channel,"bingo") as BingoStateV1 ?? defaultBingoState(NEBULA_BINGO_STARTER_PHRASES));
    const quackverse = normalizeQuackverseState(this.read(tenant,channel,"quackverse") as QuackverseSavedState);
    const boardUser = userId || Object.keys(bingo.personalBoards).at(-1);
    const collection = normalizeQuackverseCollection(quackverse.collections[userId || Object.keys(quackverse.collections).at(-1) || ""]);
    return { bingo: { ...personalBingoView(bingo,boardUser), owner:boardUser||null }, quackverse: { gridSize:quackverse.gridSize,grid:quackverse.grid,score:quackverse.score,turnNumber:quackverse.turnNumber,activePlayer:quackverse.activePlayer,winner:quackverse.winner,matchLog:quackverse.matchLog,claimedPlayers:quackverse.claimedPlayers,lastPack:collection.lastPack.map(id=>catalog.get(id)).filter(Boolean).map(card=>({id:card!.id,name:card!.name,rarity:card!.rarity,atk:card!.atk,def:card!.def,hp:card!.hp})),cards:quackverse.grid.flatMap(piece=>piece ? [{id:piece.cardId,name:catalog.get(piece.cardId)?.name||String(piece.cardId)}] : []) } };
  }
  execute(message: NormalizedChatMessageV1): string | undefined {
    const text = message.text.trim().replace(/^!?@?spmt\s+(?:arcade\s+)?/i,"!").replace(/^!(deck|collection)(?=\s|$)/i,"!quackverse $1");
    const match = /^!(bingo|card|claim|phrases|quackverse|quackpack|pack)(?:\s+(.*))?$/i.exec(text);
    if (!match) { this.observeBingo(message); return; }
    const command = match[1]!.toLowerCase(), rawArgs = match[2]?.trim() || "", args = rawArgs.split(/\s+/).filter(Boolean), game = ["bingo","card","claim","phrases"].includes(command) ? "bingo" : "quackverse";
    const id = `${message.provider}:${message.connectionId}:${message.messageId}`, user = message.actor.canonicalUserId || `${message.provider}:${message.actor.providerUserId}`, now = new Date(message.occurredAt);
    const prior = this.db.prepare("SELECT result FROM nebula_tabletop_receipts WHERE tenant_id=? AND input_id=?").get(message.tenantId,id) as {result:string}|undefined; if(prior)return prior.result;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let response: string;
      if(game === "bingo") {
        const state = normalizeBingoState(this.read(message.tenantId,message.channelId,game) as BingoStateV1 ?? defaultBingoState(NEBULA_BINGO_STARTER_PHRASES)), action = command === "bingo" ? args.shift()?.toLowerCase() || "card" : command;
        getPersonalBingoBoard(state,user);
        if(action === "center") {setPersonalBingoCenter(state,user,args.join(" "),now);response="Your personal Bingo center phrase is set.";}
        else if(action === "claim") { const square = Number(args[0]); if(!Number.isInteger(square)||square<1||square>25)throw new Error("Use !claim <square 1–25>.");const result=claimPersonalBingoSquare(state,user,square-1,{actorUserId:user},now);response=result.won?`${message.actor.username} has Bingo!`:`Bingo square ${square} marked.`; }
        else if(action === "reset") { this.requireModerator(message);resetPersonalBingoProgress(state,now);response="Bingo progress reset. Phrases are retained."; }
        else if(action === "phrases" && args.length) { this.requireModerator(message);const phrases=args.join(" ").split("|").map(value=>value.trim());if(phrases.length!==24||phrases.some(value=>value.length<2||value.length>120))throw new Error("Set 24 shared phrases separated by |. Each player chooses their center with !bingo center <phrase>.");state.templatePhrases=[...phrases.slice(0,12),"SET YOUR PERSONAL PHRASE",...phrases.slice(12)];resetPersonalBingoProgress(state,now);response="The 24 shared Bingo phrases are saved."; }
        else if(action === "phrases") response=state.templatePhrases.map((phrase,index)=>`${index+1}. ${phrase}`).join(" | ");
        else if(action === "card" || action === "join" || action === "status") response=`${message.actor.username}'s Bingo board is on the overlay. Use !bingo center <phrase> and !claim <1–25>. Shared phrases are marked when they appear in chat.`;
        else throw new Error("Bingo commands: !card, !claim 1–25, !bingo center <phrase>, !phrases, !bingo reset.");
        this.put(message.tenantId,message.channelId,game,state);
      } else {
        let state = normalizeQuackverseState(this.read(message.tenantId,message.channelId,game) as QuackverseSavedState,now);
        const action = command === "quackverse" ? args.shift()?.toLowerCase() || "status" : "pack";
        if(action === "pack") {const seed=createHash("sha256").update(`${message.tenantId}:${id}`).digest();let index=0;const pack=openQuackverseBoosterPack(cards,()=>seed[index++%seed.length]!/256);state.collections[user]=recordQuackversePack(state.collections[user]||{},pack.map(card=>card.id),now);response=`${message.actor.username} opened: ${pack.map(card=>`${card.name} (#${card.id})`).join(", ")}. ${4-state.collections[user]!.openedToday} packs remain today.`;}
        else if(action === "join") {const result=claimQuackverseSeat(state,user);state=result.state;if(!result.seat)throw new Error("Both Quackverse seats are occupied.");response=`You are ${result.seat === "playerOne" ? "Player 1" : "Player 2"}. Open !pack, build a deck with !quackverse deck add <card id>, then !quackverse ready.`;}
        else if(action === "deck") {const collection=normalizeQuackverseCollection(state.collections[user],now),operation=args[0],cardId=Number(args[1]);if(operation==="add"){if(!catalog.get(cardId))throw new Error("Unknown card id");addQuackverseCardToDeck(collection,cardId);}else if(operation==="remove")removeQuackverseCardFromDeck(collection,cardId);state.collections[user]=collection;response=`Deck (${collection.deck.length}/20): ${collection.deck.map(id=>`${catalog.get(id)?.name||id} #${id}`).join(", ")||"empty"}.`;}
        else if(action === "collection" || action === "hand") {const collection=normalizeQuackverseCollection(state.collections[user],now), ids=action==="hand"?state.battlePiles[this.seat(state,user)].hand.map(item=>item.cardId):collection.cards;response=`${action==="hand"?"Hand":"Collection"} (${ids.length} cards): ${ids.slice(0,30).map(id=>`${catalog.get(id)?.name||id} #${id}`).join(", ")||"empty"}${ids.length>30?" (first 30 shown)":""}.`; }
        else if(action === "ready") {const seat=this.seat(state,user);if(state.grid.some(Boolean)||state.turnNumber>1)throw new Error("A battle is already in progress. Finish it before readying again.");const collection=normalizeQuackverseCollection(state.collections[user],now);if(collection.deck.length<5)throw new Error("Add at least five owned cards to your deck before readying.");state.squads[seat]=collection.deck.filter(id=>catalog.get(id)?.type==="duck").slice(0,5);if(!state.squads[seat].length)throw new Error("Your deck needs at least one duck.");const pile=collection.deck.map((cardId,index)=>({cardId,instanceId:`${seat}:${index}:${cardId}`}));state.battlePiles[seat]={hand:pile.slice(0,5),drawPile:pile.slice(5),discardPile:[]};response=`${seat} is ready. Hand: ${state.battlePiles[seat].hand.map(card=>card.cardId).join(", ")}. Deploy on your back row with !quackverse deploy <card id> <A1–G7>.`;}
        else if(["deploy","move","attack","end"].includes(action)) {const playerId=this.seat(state,user);if(!state.claimedPlayers.playerOne||!state.claimedPlayers.playerTwo||!state.squads.playerOne.length||!state.squads.playerTwo.length)throw new Error("Both players must join and ready their decks before battling.");if(action==="deploy"&&(!state.battlePiles[playerId].hand.some(card=>card.cardId===Number(args[0]))||catalog.get(Number(args[0]))?.type!=="duck"))throw new Error("Deploy a duck currently in your hand. Use !quackverse hand to see your cards.");const result=applyQuackverseBattleAction(state,action==="end"?{kind:"end-turn",playerId}:action==="deploy"?{kind:"deploy",playerId,cardId:Number(args[0]),to:cell(args[1])}:{kind:action as "move"|"attack",playerId,from:cell(args[0]),to:cell(args[1])},catalog,now);state=result.state;response=result.events.map(event=>event.message).join(" ")||`Turn ${state.turnNumber}: ${state.activePlayer}.`;}
        else if(action === "reset") {this.requireModerator(message);state={...defaultQuackverseState(now),collections:state.collections};response="Quackverse battle reset. Collections are retained.";}
        else if(action === "status" || action === "help") response=`Quackverse turn ${state.turnNumber}: ${state.activePlayer}. Commands: !pack, !collection, !deck add <id>, !quackverse join, ready, hand, deploy <id> <cell>, move <from> <to>, attack <from> <to>, end.`;
        else throw new Error("Unknown Quackverse action. Use !quackverse help.");
        this.put(message.tenantId,message.channelId,game,state);
      }
      this.db.prepare("INSERT INTO nebula_tabletop_receipts VALUES(?,?,?)").run(message.tenantId,id,response);this.db.exec("COMMIT");return response;
    } catch(error) {this.db.exec("ROLLBACK");return error instanceof Error?error.message:String(error);}
  }
  private seat(state:QuackverseSavedState,user:string){if(state.claimedPlayers.playerOne===user)return "playerOne" as const;if(state.claimedPlayers.playerTwo===user)return "playerTwo" as const;throw new Error("Join a Quackverse seat first with !quackverse join.");}
  private requireModerator(message:NormalizedChatMessageV1){if(!message.actor.roles.some(role=>["broadcaster","moderator"].includes(role)))throw new Error("Only the broadcaster or a moderator can change the shared game.");}
  private observeBingo(message:NormalizedChatMessageV1){if(message.text.startsWith("!"))return;this.db.exec("BEGIN IMMEDIATE");try{const stored=this.read(message.tenantId,message.channelId,"bingo") as BingoStateV1|undefined;if(!stored){this.db.exec("COMMIT");return;}const state=normalizeBingoState(stored),text=message.text.toLowerCase();for(const user of Object.keys(state.personalBoards)){const board=state.personalBoards[user]!;state.templatePhrases.forEach((phrase,index)=>{const value=index===12?board.centerPhrase:phrase;if(value&&text.includes(value.toLowerCase()))claimPersonalBingoSquare(state,user,index,{actorUserId:message.actor.canonicalUserId||message.actor.providerUserId},new Date(message.occurredAt));});}this.put(message.tenantId,message.channelId,"bingo",state);this.db.exec("COMMIT");}catch(error){this.db.exec("ROLLBACK");throw error;}}
}
function cell(value:string|undefined){const match=/^([a-g])([1-7])$/i.exec(value||"");if(!match)throw new Error("Use a board cell from A1 through G7.");return(Number(match[2])-1)*7+match[1]!.toLowerCase().charCodeAt(0)-97;}
