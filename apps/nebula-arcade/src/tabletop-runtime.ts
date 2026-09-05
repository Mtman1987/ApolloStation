import { parseNebulaMessage } from "./game-hub.js";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { NormalizedChatMessageV1 } from "@spmt/contracts";
import { defaultBingoState, normalizeBingoState, getPersonalBingoBoard, personalBingoView, setPersonalBingoCenter, claimPersonalBingoSquare, resetPersonalBingoProgress, type BingoStateV1 } from "./bingo-game.js";
import { defaultQuackverseState, normalizeQuackverseState, normalizeQuackverseCollection, claimQuackverseSeat, recordQuackversePack, type QuackverseSavedState } from "./quackverse-state.js";
import { openQuackverseBoosterPack, addQuackverseCardToDeck, removeQuackverseCardFromDeck, saveQuackverseDeck, activateQuackverseDeck } from "./quackverse-packs.js";
import { applyQuackverseGameAction, refreshTurnResources, type QuackverseGameAction } from "./quackverse-engine.js";
import { normalizeNebulaGameRuntimeState, joinNebulaGame, awardNebulaGamePoints, recordNebulaGameWin } from "./game-runtime.js";
import { SqliteNebulaGameRuntimeStore } from "./game-runtime-store.js";
import { bingoCardStats } from "./bingo-game.js";
import { quackverseCards } from "./quackverse-data.js";

const cards = quackverseCards.map(card => ({ ...card, type: card.type.toLowerCase(), role: card.role ?? "", atk: card.atk ?? 0, def: card.def ?? 0, hp: card.hp ?? 0, spd: card.spd ?? 0, spc: card.spc ?? 0 }));
const catalog = { get: (id: number) => cards.find(card => card.id === id) };
// Editable starter phrases make a newly created shared board immediately playable.
export const NEBULA_BINGO_STARTER_PHRASES = ["Hello chat", "Welcome back", "Thank you", "Let's go", "One more game", "Good game", "Nice shot", "Well played", "Oh no", "We got this", "Ready", "Let's try again", "", "That was close", "Watch this", "I knew it", "No way", "Amazing", "Good luck", "See you", "All right", "Here we go", "Almost", "You did it", "Next round"];
export class SqliteNebulaTabletopRuntime {
  private readonly db: DatabaseSync;
  constructor(path: string) { const runtime = new SqliteNebulaGameRuntimeStore(path);runtime.close(); this.db = new DatabaseSync(path, { timeout: 5000 }); this.db.exec("CREATE TABLE IF NOT EXISTS nebula_tabletop(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,game_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,channel_id,game_id)); CREATE TABLE IF NOT EXISTS nebula_tabletop_receipts(tenant_id TEXT NOT NULL,input_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(tenant_id,input_id))"); }
  close() { this.db.close(); }
  consolidateLegacyRooms(tenant:string){
    if(this.read(tenant,"@arcade","scope-v2"))return;
    this.db.exec("BEGIN IMMEDIATE");try{
      const rows=this.db.prepare("SELECT channel_id,game_id,body FROM nebula_tabletop WHERE tenant_id=? AND channel_id<>'@arcade' AND game_id IN ('bingo','quackverse') ORDER BY channel_id").all(tenant) as {channel_id:string;game_id:string;body:string}[];
      const collections:QuackverseSavedState["collections"]={},bingo=defaultBingoState(NEBULA_BINGO_STARTER_PHRASES);
      for(const row of rows){const value=JSON.parse(row.body);if(row.game_id==="quackverse"){const state=normalizeQuackverseState(value);for(const [id,collection] of Object.entries(state.collections)){const existing=collections[id];if(!existing){collections[id]=collection;continue;}existing.cards.push(...collection.cards);if(existing.openedAtDay===collection.openedAtDay)existing.openedToday+=collection.openedToday;for(const deck of collection.savedDecks)if(!existing.savedDecks.some(item=>item.id===deck.id))existing.savedDecks.push(deck);}}
      else{const source=normalizeBingoState(value);bingo.templatePhrases=source.templatePhrases;for(const [id,board] of Object.entries(source.personalBoards))if(!bingo.personalBoards[id]||Object.keys(board.covered).length>Object.keys(bingo.personalBoards[id]!.covered).length)bingo.personalBoards[id]=board;}}
      if(!this.read(tenant,"@arcade","collections")&&Object.keys(collections).length)this.put(tenant,"@arcade","collections",collections);
      if(!this.read(tenant,"@arcade","bingo")&&Object.keys(bingo.personalBoards).length)this.put(tenant,"@arcade","bingo",bingo);
      this.put(tenant,"@arcade","scope-v2",{migratedRooms:rows.length,retainedOriginalRows:true});this.db.exec("COMMIT");
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  private read(tenant: string, channel: string, game: string): unknown { if(game==="bingo")channel="@arcade"; const row = this.db.prepare("SELECT body FROM nebula_tabletop WHERE tenant_id=? AND channel_id=? AND game_id=?").get(tenant,channel,game) as {body:string}|undefined; return row ? JSON.parse(row.body) : undefined; }
  private put(tenant: string, channel: string, game: string, value: unknown) { if(game==="bingo")channel="@arcade"; this.db.prepare("INSERT INTO nebula_tabletop VALUES(?,?,?,?) ON CONFLICT(tenant_id,channel_id,game_id) DO UPDATE SET body=excluded.body").run(tenant,channel,game,JSON.stringify(value)); }
  snapshot(tenant: string, channel: string, userId?: string) {
    this.consolidateLegacyRooms(tenant);
    const bingo = normalizeBingoState(this.read(tenant,channel,"bingo") as BingoStateV1 ?? defaultBingoState(NEBULA_BINGO_STARTER_PHRASES));
    const quackverse = this.quackverseState(tenant,channel);
    const boardUser = userId || Object.keys(bingo.personalBoards).at(-1);
    const collection = normalizeQuackverseCollection(quackverse.collections[userId || Object.keys(quackverse.collections).at(-1) || ""]);
    return { catalog:quackverseCards, ...(userId?{collection, savedDecks:collection.savedDecks}:{}), bingoStats:bingoCardStats(bingo), bingo: { ...personalBingoView(bingo,boardUser), owner:boardUser||null }, quackverse: { gridSize:quackverse.gridSize,grid:quackverse.grid,score:quackverse.score,turnNumber:quackverse.turnNumber,activePlayer:quackverse.activePlayer,winner:quackverse.winner,matchLog:quackverse.matchLog,claimedPlayers:quackverse.claimedPlayers,npcPlayers:quackverse.npcPlayers,formationVp:quackverse.formationVp,turnActions:quackverse.turnActions,hand:userId?quackverse.battlePiles[quackverse.claimedPlayers.playerOne===userId?"playerOne":"playerTwo"].hand.filter(()=>Object.values(quackverse.claimedPlayers).includes(userId)):[],lastPack:collection.lastPack.map(id=>catalog.get(id)).filter(Boolean).map(card=>({id:card!.id,name:card!.name,rarity:card!.rarity,atk:card!.atk,def:card!.def,hp:card!.hp})),cards:quackverse.grid.flatMap(piece=>piece ? [{id:piece.cardId,name:catalog.get(piece.cardId)?.name||String(piece.cardId)}] : []) } };
  }
  execute(message: NormalizedChatMessageV1): string | undefined {
    this.consolidateLegacyRooms(message.tenantId);
    const parsed = parseNebulaMessage(message.text);
    if (!parsed || !parsed.body || message.actor.isBot) return;
    const text = `!${parsed.gameId ? `${parsed.gameId} ` : ""}${parsed.command} ${parsed.args.join(" ")}`.trim().replace(/^!(deck|collection)(?=\s|$)/i,"!quackverse $1");
    const match = /^!(bingo|card|claim|phrases|quackverse|quackpack|pack)(?:\s+(.*))?$/i.exec(text);
    if (!match) return;
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
        else if(action === "claim") { const square = Number(args[0]); if(!Number.isInteger(square)||square<1||square>25)throw new Error("Use spmt claim <square 1–25>.");const result=claimPersonalBingoSquare(state,user,square-1,{actorUserId:user,channel:message.channelId},now);this.reward(message,1+(result.newlyWon?5:0),result.newlyWon);response=result.won?`${message.actor.username} has Bingo!`:`Bingo square ${square} marked.`; }
        else if(action === "reset") { this.requireModerator(message);resetPersonalBingoProgress(state,now);response="Bingo progress reset. Phrases are retained."; }
        else if(action === "phrases" && args.length) { this.requireModerator(message);const phrases=args.join(" ").split("|").map(value=>value.trim());if(phrases.length!==24||phrases.some(value=>value.length<2||value.length>120))throw new Error("Set 24 shared phrases separated by |. Each player chooses their center with spmt bingo center <phrase>.");state.templatePhrases=[...phrases.slice(0,12),"SET YOUR PERSONAL PHRASE",...phrases.slice(12)];resetPersonalBingoProgress(state,now);response="The 24 shared Bingo phrases are saved."; }
        else if(action === "edit") {this.requireModerator(message);const square=Number(args.shift()),phrase=args.join(" ").trim();if(!Number.isInteger(square)||square<1||square>25||square===13||phrase.length<2||phrase.length>120)throw new Error("Use spmt bingo edit <1–25 except 13> <phrase>.");state.templatePhrases[square-1]=phrase;resetPersonalBingoProgress(state,now);response="Bingo phrase saved; the round has been reset.";}
        else if(action === "generate") {this.requireModerator(message);const phrases=NEBULA_BINGO_STARTER_PHRASES.filter(Boolean).sort(()=>Math.random()-.5);state.templatePhrases=[...phrases.slice(0,12),"SET YOUR PERSONAL PHRASE",...phrases.slice(12)];resetPersonalBingoProgress(state,now);response="A fresh Bingo board is ready.";}
        else if(action === "share") {const stats=bingoCardStats(state);response=`Bingo: ${stats.players} players, ${stats.claims} claims, ${stats.completedCards} completed cards.`;}
        else if(action === "phrases") response=state.templatePhrases.map((phrase,index)=>`${index+1}. ${phrase}`).join(" | ");
        else if(action === "card" || action === "join" || action === "status") response=`${message.actor.username}'s Bingo board is on the overlay. Use spmt bingo center <phrase> and spmt claim <1–25>. Shared phrases are marked by spmt-prefixed chat from joined players.`;
        else throw new Error("Bingo commands: spmt card, spmt claim 1–25, spmt bingo center <phrase>, spmt phrases, spmt bingo reset.");
        this.put(message.tenantId,message.channelId,game,state);
      } else {
        let state = this.quackverseState(message.tenantId,message.channelId,now);
        const action = command === "quackverse" ? args.shift()?.toLowerCase() || "status" : "pack";
        if(action === "pack") {const seed=createHash("sha256").update(`${message.tenantId}:${id}`).digest();let index=0;const pack=openQuackverseBoosterPack(cards,()=>seed[index++%seed.length]!/256);state.collections[user]=recordQuackversePack(state.collections[user]||{},pack.map(card=>card.id),now);this.queue(message,"pack",{packId:id,username:message.actor.username,pack:pack.map(card=>catalog.get(card.id)),packsRemaining:4-state.collections[user]!.openedToday,collectionIds:state.collections[user]!.cards});response=`${message.actor.username} opened: ${pack.map(card=>`${card.name} (#${card.id})`).join(", ")}. ${4-state.collections[user]!.openedToday} packs remain today.`;}
        else if(action === "join") {const result=claimQuackverseSeat(state,user);state=result.state;if(!result.seat)throw new Error("Both Quackverse seats are occupied.");response=`You are ${result.seat === "playerOne" ? "Player 1" : "Player 2"}. Open spmt pack, build a deck with spmt quackverse deck add <card id>, then spmt quackverse ready.`;}
        else if(action === "savedeck" || action === "save") {const collection=normalizeQuackverseCollection(state.collections[user],now);const saved=saveQuackverseDeck(collection,{name:args.join(" ")},now);state.collections[user]=collection;response=`Saved ${saved.name} (${saved.id}). Use spmt quackverse activateDeck ${saved.id}.`;}
        else if(action === "activatedeck" || action === "activate") {const collection=normalizeQuackverseCollection(state.collections[user],now);activateQuackverseDeck(collection,args[0]||"");state.collections[user]=collection;response=`Deck ${collection.activeDeckId} activated.`;}
        else if(action === "deletedeck") {const collection=normalizeQuackverseCollection(state.collections[user],now);if(!collection.savedDecks.some(d=>d.id===args[0]))throw new Error("Saved deck not found.");collection.savedDecks=collection.savedDecks.filter(d=>d.id!==args[0]);if(collection.activeDeckId===args[0])collection.activeDeckId="default";state.collections[user]=collection;response="Saved deck removed.";}
        else if(action === "decks") {const collection=normalizeQuackverseCollection(state.collections[user],now);response=collection.savedDecks.map(deck=>`${deck.name} (${deck.id}): ${deck.wins}W/${deck.losses}L`).join(" | ")||"No saved decks. Use spmt quackverse saveDeck <name>.";}
        else if(action === "refill-daily") {this.requireModerator(message);for(const collection of Object.values(state.collections)){collection.openedToday=0;collection.openedAtDay=now.toISOString().slice(0,10);}response="Daily packs refilled.";}
        else if(action === "deck") {const collection=normalizeQuackverseCollection(state.collections[user],now),operation=args[0],cardId=Number(args[1]);if(operation==="add"){if(!catalog.get(cardId))throw new Error("Unknown card id");addQuackverseCardToDeck(collection,cardId);}else if(operation==="remove")removeQuackverseCardFromDeck(collection,cardId);state.collections[user]=collection;response=`Deck (${collection.deck.length}/20): ${collection.deck.map(id=>`${catalog.get(id)?.name||id} #${id}`).join(", ")||"empty"}.`;}
        else if(action === "collection" || action === "hand") {const collection=normalizeQuackverseCollection(state.collections[user],now), ids=action==="hand"?state.battlePiles[this.seat(state,user)].hand.map(item=>item.cardId):collection.cards;response=`${action==="hand"?"Hand":"Collection"} (${ids.length} cards): ${ids.slice(0,30).map(id=>`${catalog.get(id)?.name||id} #${id}`).join(", ")||"empty"}${ids.length>30?" (first 30 shown)":""}.`; }
        else if(action === "ready") {const seat=this.seat(state,user);if(state.grid.some(Boolean)||state.turnNumber>1)throw new Error("A battle is already in progress. Finish it before readying again.");const collection=normalizeQuackverseCollection(state.collections[user],now);if(collection.deck.length<5)throw new Error("Add at least five owned cards to your deck before readying.");state.squads[seat]=collection.deck.filter(id=>catalog.get(id)?.type==="duck").slice(0,5);if(!state.squads[seat].length)throw new Error("Your deck needs at least one duck.");const pile=collection.deck.map((cardId,index)=>({cardId,instanceId:`${seat}:${index}:${cardId}`}));state.battlePiles[seat]={hand:pile.slice(0,5),drawPile:pile.slice(5),discardPile:[]};refreshTurnResources(state,seat);response=`${seat} is ready. Hand: ${state.battlePiles[seat].hand.map(card=>card.cardId).join(", ")}. Deploy on your back row with spmt quackverse deploy <card id> <A1–G7>.`;}
        else if(["deploy","place","move","attack","end","pass","useability","ability","attachgear","equip","leave","leaveseat","clearseat","endmatch","reset","npc","togglenpc","loadmockgame","claimseat"].includes(action)) {
          const mapped:Record<string,string>={deploy:"place",end:"pass",useability:"useAbility",ability:"useAbility",attachgear:"attachGear",equip:"attachGear",leave:"leaveSeat",leaveseat:"leaveSeat",clearseat:"clearSeat",endmatch:"endMatch",npc:"toggleNpc",togglenpc:"toggleNpc",loadmockgame:"loadMockGame",claimseat:"claimSeat"};
          const kind=mapped[action]||action,body:QuackverseGameAction={type:kind};
          if(["claimSeat","clearSeat","toggleNpc"].includes(kind))body.playerId=args[0]==="1"||args[0]==="playerOne"?"playerOne":args[0]==="2"||args[0]==="playerTwo"?"playerTwo":(()=>{throw new Error("Choose seat 1 or 2.");})();
          if(kind==="move"){body.from=cell(args[0]);body.to=cell(args[1]);}
          if(kind==="attack"){body.attackerIndex=cell(args[0]);body.targetIndex=cell(args[1]);}
          if(kind==="useAbility"){body.sourceIndex=cell(args[0]);const piece=state.grid[body.sourceIndex],card=quackverseCards.find(card=>card.id===piece?.cardId);const index=Number(args[1]||1)-1;if(!card?.abilities[index])throw new Error("Choose an ability listed on that duck (1, 2, …).");body.ability=card.abilities[index];}
          if(kind==="place"||kind==="attachGear"){const seat=this.seat(state,user),entry=state.battlePiles[seat].hand.find(item=>item.instanceId===args[0]||item.cardId===Number(args[0]));if(!entry)throw new Error("Choose a card from your hand.");body.instanceId=entry.instanceId;body.targetIndex=cell(args[1]);}
          state=applyQuackverseGameAction(state,body,{userId:user,moderator:message.actor.roles.some(role=>["moderator","broadcaster"].includes(role))},now);
          response=state.matchLog[0]||"Match updated.";
        }
        else if(action === "status" || action === "help") response=`Quackverse turn ${state.turnNumber}: ${state.activePlayer}. Commands: spmt pack, spmt collection, spmt deck add <id>, spmt quackverse join, ready, hand, deploy <id> <cell>, move <from> <to>, attack <from> <to>, end.`;
        else throw new Error("Unknown Quackverse action. Use spmt quackverse help.");
        this.put(message.tenantId,"@arcade","collections",state.collections);this.put(message.tenantId,message.channelId,game,state);
      }
      this.db.prepare("INSERT INTO nebula_tabletop_receipts VALUES(?,?,?)").run(message.tenantId,id,response);this.db.exec("COMMIT");return response;
    } catch(error) {this.db.exec("ROLLBACK");return error instanceof Error?error.message:String(error);}
  }
  private seat(state:QuackverseSavedState,user:string){if(state.claimedPlayers.playerOne===user)return "playerOne" as const;if(state.claimedPlayers.playerTwo===user)return "playerTwo" as const;throw new Error("Join a Quackverse seat first with spmt quackverse join.");}
  private requireModerator(message:NormalizedChatMessageV1){if(!message.actor.roles.some(role=>["broadcaster","moderator"].includes(role)))throw new Error("Only the broadcaster or a moderator can change the shared game.");}
  succeeded(message:NormalizedChatMessageV1){return Boolean(this.db.prepare("SELECT 1 FROM nebula_tabletop_receipts WHERE tenant_id=? AND input_id=?").get(message.tenantId,`${message.provider}:${message.connectionId}:${message.messageId}`));}
  observeBingo(message:NormalizedChatMessageV1){
    const parsed=parseNebulaMessage(message.text);if(!parsed?.body||message.actor.isBot)return;
    const user=message.actor.canonicalUserId||`${message.provider}:${message.actor.providerUserId}`,state=normalizeBingoState(this.read(message.tenantId,message.channelId,"bingo") as BingoStateV1),board=state.personalBoards[user];if(!board)return;
    const text=(parsed.gameId?`${parsed.command} ${parsed.args.join(" ")}`:parsed.body).trim().toLowerCase();
    const square=state.templatePhrases.findIndex((phrase,index)=>{const value=index===12?board.centerPhrase:phrase;return value&&text.includes(value.toLowerCase())&&!board.covered[String(index)];});
    if(square<0||Object.values(board.covered).some(claim=>claim.channel===message.channelId))return;
    return this.execute({...message,text:`spmt bingo claim ${square+1}`});
  }
  quackverseState(tenant:string,channel:string,now=new Date()) {
    const state=normalizeQuackverseState(this.read(tenant,channel,"quackverse") as QuackverseSavedState,now);
    const global=this.read(tenant,"@arcade","collections") as QuackverseSavedState["collections"]|undefined;
    state.collections={...state.collections,...global};return state;
  }
  importData(tenant:string,input:{bingo?:BingoStateV1;collections?:QuackverseSavedState["collections"];rooms?:Record<string,QuackverseSavedState>}) {
    if(input.bingo)this.put(tenant,"@arcade","bingo",normalizeBingoState(input.bingo));
    if(input.collections)this.put(tenant,"@arcade","collections",input.collections);
    for(const [room,state] of Object.entries(input.rooms||{}))this.put(tenant,room,"quackverse",normalizeQuackverseState(state));
  }
  private reward(message:NormalizedChatMessageV1,amount:number,won:boolean) {
    const row=this.db.prepare("SELECT body FROM nebula_game_runtime WHERE tenant_id=? AND runtime_key='default'").get(message.tenantId) as {body:string}|undefined,state=normalizeNebulaGameRuntimeState(row?JSON.parse(row.body):undefined),now=new Date(message.occurredAt);
    const {player,membership}=joinNebulaGame(state,{userId:message.actor.canonicalUserId?`spmt:${message.actor.canonicalUserId}`:`provider:${message.provider}:${message.actor.providerUserId}`,username:message.actor.username,displayName:message.actor.displayName,gameId:"bingo"},now);
    membership!.score+=amount;membership!.lastScoreAt=message.occurredAt;player.lastPointsAwardAt=message.occurredAt;awardNebulaGamePoints(state,player,amount,won?"Bingo claim and win":"Bingo claim",{gameId:"bingo",channel:message.channelId},now);if(won)recordNebulaGameWin(state,player.id,"bingo",0,now);
    this.db.prepare("INSERT INTO nebula_game_runtime VALUES(?,'default',?,?) ON CONFLICT(tenant_id,runtime_key) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at").run(message.tenantId,JSON.stringify(state),message.occurredAt);
  }
  private queue(message:NormalizedChatMessageV1,kind:string,payload:unknown) {
    this.db.exec("CREATE TABLE IF NOT EXISTS nebula_media_outbox(tenant_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,id))");
    this.db.prepare("INSERT OR IGNORE INTO nebula_media_outbox VALUES(?,?,?,?, 'pending',?)").run(message.tenantId,`${message.provider}:${message.connectionId}:${message.messageId}`,kind,JSON.stringify({userId:message.actor.canonicalUserId||`${message.provider}:${message.actor.providerUserId}`,channelId:message.channelId,payload}),message.occurredAt);
  }

}
function cell(value:string|undefined){const match=/^([a-g])([1-7])$/i.exec(value||"");if(!match)throw new Error("Use a board cell from A1 through G7.");return(Number(match[2])-1)*7+match[1]!.toLowerCase().charCodeAt(0)-97;}
