import {
  joinNebulaGame,
  awardNebulaGamePoints,
  spendNebulaGamePoints,
  recordNebulaGameWin,
  type NebulaGameRuntimeStateV1,
} from "./game-runtime.js";

export const NEBULA_SHARED_BINGO_CLAIM_WINDOW_MS = 15_000;
export const NEBULA_SHARED_BINGO_CLAIM_POINTS = 5;
export const NEBULA_SHARED_BINGO_RECLAIM_POINTS = 5;
export const NEBULA_SHARED_BINGO_PARTICIPATION_BONUS = 5;
export const NEBULA_SHARED_BINGO_STREAMER_BONUS = 25;
export const NEBULA_SHARED_BINGO_PHRASE_CHANGE_COST = 100;
export const NEBULA_SHARED_BINGO_STELLA_FLIP_COST = 250;
export const NEBULA_SHARED_BINGO_CENTER_FREE_COST = 500;

export type NebulaSharedBingoSquareStatusV1 = "open" | "pending" | "chat" | "stella" | "replacement";
export type NebulaSharedBingoSquareV1 = {
  coordinate: string;
  phrase: string;
  status: NebulaSharedBingoSquareStatusV1;
  triggeredAt?: string;
  claimUntil?: string;
  claimedBy?: string;
  suggestedBy?: string;
  originalPhrase?: string;
};
export type NebulaSharedBingoStateV1 = {
  boardId: string;
  squares: NebulaSharedBingoSquareV1[];
  participants: Record<string, { username: string; displayName: string; actions: number }>;
  recentTranscripts: string[];
  completedAt?: string;
  winningLine?: string[];
  updatedAt: string;
};

const WINNING_LINES = [
  [0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],
  [0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],
  [0,6,12,18,24],[4,8,12,16,20],
];
const DISALLOWED_PHRASE = /\b(?:fuck|shit|bitch|cunt|nigg|fagg|rape|porn|sex)\w*\b/i;

function coordinateAt(index: number) { return `${String.fromCharCode(65 + index % 5)}${Math.floor(index / 5) + 1}`; }
function normalizePhrase(value: unknown) { return String(value ?? "").toLowerCase().replace(/[^a-z0-9']+/g, " ").replace(/\s+/g, " ").trim(); }

export function parseNebulaSharedBingoCoordinate(value: unknown) {
  const match = String(value ?? "").trim().toUpperCase().match(/^([A-E])\s*([1-5])$/);
  if (!match) return null;
  const index = (Number(match[2]) - 1) * 5 + match[1]!.charCodeAt(0) - 65;
  return { coordinate: coordinateAt(index), index };
}

export function defaultNebulaSharedBingoState(channelValue: string, phrases: readonly string[], now = Date.now()): NebulaSharedBingoStateV1 {
  const channel = cleanChannel(channelValue);
  const source = phrases.map(value => String(value ?? "").trim());
  return {
    boardId: `${channel}:${new Date(now).toISOString().slice(0,10)}`,
    squares: Array.from({length:25},(_,index)=>({coordinate:coordinateAt(index),phrase:String(source[index] || (index===12?"Bingo":`Phrase ${index+1}`)).slice(0,80),status:"open" as const})),
    participants: {},
    recentTranscripts: [],
    updatedAt: new Date(now).toISOString(),
  };
}

export function normalizeNebulaSharedBingoState(value: Partial<NebulaSharedBingoStateV1> | null | undefined, channel: string, phrases: readonly string[], now = Date.now()): NebulaSharedBingoStateV1 {
  const expected = `${cleanChannel(channel)}:${new Date(now).toISOString().slice(0,10)}`;
  if (!value || value.boardId !== expected || !Array.isArray(value.squares) || value.squares.length !== 25) return defaultNebulaSharedBingoState(channel,phrases,now);
  return {
    boardId: expected,
    squares: value.squares.map((square,index)=>({
      coordinate:coordinateAt(index),phrase:String(square?.phrase??"").slice(0,80),
      status:(["open","pending","chat","stella","replacement"].includes(String(square?.status))?square!.status:"open") as NebulaSharedBingoSquareStatusV1,
      ...(square?.triggeredAt?{triggeredAt:String(square.triggeredAt)}:{}),
      ...(square?.claimUntil?{claimUntil:String(square.claimUntil)}:{}),
      ...(square?.claimedBy?{claimedBy:String(square.claimedBy)}:{}),
      ...(square?.suggestedBy?{suggestedBy:String(square.suggestedBy)}:{}),
      ...(square?.originalPhrase?{originalPhrase:String(square.originalPhrase)}:{}),
    })),
    participants: value.participants && typeof value.participants==="object" ? structuredClone(value.participants) : {},
    recentTranscripts: Array.isArray(value.recentTranscripts)?value.recentTranscripts.map(String).slice(-50):[],
    ...(value.completedAt?{completedAt:String(value.completedAt)}:{}),
    ...(value.winningLine?{winningLine:value.winningLine.map(String)}:{}),
    updatedAt:String(value.updatedAt||new Date(now).toISOString()),
  };
}

export function settleNebulaSharedBingoClaims(game: NebulaSharedBingoStateV1, now = Date.now()) {
  const blocked:string[]=[];
  for(const square of game.squares){
    if(square.status!=="pending"||!square.claimUntil||Date.parse(square.claimUntil)>now)continue;
    square.status="stella";delete square.claimUntil;blocked.push(square.coordinate);
  }
  if(blocked.length)game.updatedAt=new Date(now).toISOString();
  return {changed:blocked.length>0,blocked};
}

export function ingestNebulaSharedBingoTranscript(game:NebulaSharedBingoStateV1,text:unknown,now=Date.now()) {
  const settled=settleNebulaSharedBingoClaims(game,now),transcript=normalizePhrase(text);
  if(!transcript||game.recentTranscripts.includes(transcript))return{changed:settled.changed,blocked:settled.blocked,triggered:[] as string[]};
  game.recentTranscripts=[...game.recentTranscripts,transcript].slice(-50);
  const triggered:string[]=[];
  if(!game.completedAt)for(const square of game.squares){
    if(square.status!=="open"&&square.status!=="replacement")continue;
    const phrase=normalizePhrase(square.phrase);
    if(phrase.length<2||!transcript.includes(phrase))continue;
    square.status="pending";square.triggeredAt=new Date(now).toISOString();square.claimUntil=new Date(now+NEBULA_SHARED_BINGO_CLAIM_WINDOW_MS).toISOString();triggered.push(square.coordinate);
  }
  if(triggered.length)game.updatedAt=new Date(now).toISOString();
  return{changed:settled.changed||triggered.length>0,blocked:settled.blocked,triggered};
}

function participant(game:NebulaSharedBingoStateV1,player:{id:string;username:string;displayName:string}) {
  return game.participants[player.id] ||= {username:player.username,displayName:player.displayName,actions:0};
}
function winningLine(game:NebulaSharedBingoStateV1) {
  const line=WINNING_LINES.find(indices=>indices.every(index=>game.squares[index]?.status==="chat"));
  return line?.map(index=>game.squares[index]!.coordinate)??null;
}
function completeIfWon(runtime:NebulaGameRuntimeStateV1,game:NebulaSharedBingoStateV1,channel:string,now:number) {
  const line=winningLine(game);
  if(!line||game.completedAt)return{won:false,winningLine:line};
  game.completedAt=new Date(now).toISOString();game.winningLine=line;
  for(const playerId of Object.keys(game.participants)){
    const player=runtime.players[playerId];if(!player)continue;
    const membership=player.joinedGames.bingo;if(membership)membership.score+=NEBULA_SHARED_BINGO_PARTICIPATION_BONUS;
    awardNebulaGamePoints(runtime,player,NEBULA_SHARED_BINGO_PARTICIPATION_BONUS,"Shared Bingo participation bonus",{gameId:"bingo",channel},new Date(now));
  }
  const streamer=joinNebulaGame(runtime,{username:channel,displayName:channel,gameId:"bingo"},new Date(now));
  streamer.membership.score+=NEBULA_SHARED_BINGO_STREAMER_BONUS;
  awardNebulaGamePoints(runtime,streamer.player,NEBULA_SHARED_BINGO_STREAMER_BONUS,"Streamer Bingo bonus",{gameId:"bingo",channel},new Date(now));
  return{won:true,winningLine:line};
}

export function claimNebulaSharedBingoSquare(runtime:NebulaGameRuntimeStateV1,game:NebulaSharedBingoStateV1,input:{channel:string;coordinate:unknown;userId?:unknown;username?:unknown;displayName?:unknown},now=Date.now()) {
  const parsed=parseNebulaSharedBingoCoordinate(input.coordinate);if(!parsed)return{changed:false,outcome:"invalid" as const};
  const settled=settleNebulaSharedBingoClaims(game,now),square=game.squares[parsed.index];
  if(game.completedAt)return{changed:settled.changed,outcome:"complete" as const,blocked:settled.blocked};
  if(square.status!=="pending"||!square.claimUntil||Date.parse(square.claimUntil)<=now)return{changed:settled.changed,outcome:square.status==="stella"?"blocked" as const:"not-triggered" as const,blocked:settled.blocked};
  const joined=joinNebulaGame(runtime,{...input,gameId:"bingo"},new Date(now)),replacement=Boolean(square.suggestedBy);
  square.status="chat";square.claimedBy=joined.player.id;delete square.claimUntil;
  const points=replacement?NEBULA_SHARED_BINGO_RECLAIM_POINTS:NEBULA_SHARED_BINGO_CLAIM_POINTS;
  joined.membership.score+=points;joined.membership.lastActiveAt=new Date(now).toISOString();participant(game,joined.player).actions+=1;
  awardNebulaGamePoints(runtime,joined.player,points,replacement?"Bingo square reclaimed":"Bingo phrase claimed",{gameId:"bingo",channel:input.channel},new Date(now));
  const completion=completeIfWon(runtime,game,cleanChannel(input.channel),now);game.updatedAt=new Date(now).toISOString();
  return{changed:true,outcome:"claimed" as const,coordinate:parsed.coordinate,points,...completion,blocked:settled.blocked};
}

export function suggestNebulaSharedBingoPhrase(runtime:NebulaGameRuntimeStateV1,game:NebulaSharedBingoStateV1,input:{channel:string;coordinate:unknown;phrase:unknown;userId?:unknown;username?:unknown;displayName?:unknown},now=Date.now()) {
  const parsed=parseNebulaSharedBingoCoordinate(input.coordinate);if(!parsed)return{changed:false,outcome:"invalid" as const};
  const phrase=String(input.phrase??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,80);
  if(phrase.length<2||DISALLOWED_PHRASE.test(phrase))return{changed:false,outcome:"inappropriate" as const};
  const settled=settleNebulaSharedBingoClaims(game,now),square=game.squares[parsed.index];
  if(game.completedAt)return{changed:settled.changed,outcome:"complete" as const};
  if(square.status!=="stella"&&square.status!=="open"&&square.status!=="replacement")return{changed:settled.changed,outcome:"unavailable" as const,blocked:settled.blocked};
  const joined=joinNebulaGame(runtime,{...input,gameId:"bingo"},new Date(now));
  if(joined.player.gamePointsBalance<NEBULA_SHARED_BINGO_PHRASE_CHANGE_COST)return{changed:settled.changed,outcome:"insufficient" as const,balance:joined.player.gamePointsBalance,cost:NEBULA_SHARED_BINGO_PHRASE_CHANGE_COST,blocked:settled.blocked};
  spendNebulaGamePoints(runtime,joined.player,NEBULA_SHARED_BINGO_PHRASE_CHANGE_COST,"Bingo phrase change",new Date(now));
  square.originalPhrase ||= square.phrase;square.phrase=phrase;square.status="replacement";square.suggestedBy=joined.player.id;
  delete square.triggeredAt;delete square.claimUntil;joined.membership.lastActiveAt=new Date(now).toISOString();participant(game,joined.player).actions+=1;game.updatedAt=new Date(now).toISOString();
  return{changed:true,outcome:"suggested" as const,coordinate:parsed.coordinate,phrase,cost:NEBULA_SHARED_BINGO_PHRASE_CHANGE_COST,blocked:settled.blocked};
}

export function buyNebulaSharedBingoStellaFlip(runtime:NebulaGameRuntimeStateV1,game:NebulaSharedBingoStateV1,input:{channel:string;coordinate:unknown;userId?:unknown;username?:unknown;displayName?:unknown},now=Date.now()) {
  const parsed=parseNebulaSharedBingoCoordinate(input.coordinate);if(!parsed)return{changed:false,outcome:"invalid" as const};
  const settled=settleNebulaSharedBingoClaims(game,now),square=game.squares[parsed.index];
  if(game.completedAt)return{changed:settled.changed,outcome:"complete" as const};
  if(square.status!=="stella")return{changed:settled.changed,outcome:"unavailable" as const};
  const joined=joinNebulaGame(runtime,{...input,gameId:"bingo"},new Date(now));
  if(joined.player.gamePointsBalance<NEBULA_SHARED_BINGO_STELLA_FLIP_COST)return{changed:settled.changed,outcome:"insufficient" as const,balance:joined.player.gamePointsBalance,cost:NEBULA_SHARED_BINGO_STELLA_FLIP_COST};
  spendNebulaGamePoints(runtime,joined.player,NEBULA_SHARED_BINGO_STELLA_FLIP_COST,"Flip Stella Bingo square",new Date(now));
  square.status="chat";square.claimedBy=joined.player.id;participant(game,joined.player).actions+=1;
  const completion=completeIfWon(runtime,game,cleanChannel(input.channel),now);game.updatedAt=new Date(now).toISOString();
  return{changed:true,outcome:"flipped" as const,coordinate:parsed.coordinate,cost:NEBULA_SHARED_BINGO_STELLA_FLIP_COST,...completion};
}

export function buyNebulaSharedBingoCenterFree(runtime:NebulaGameRuntimeStateV1,game:NebulaSharedBingoStateV1,input:{channel:string;userId?:unknown;username?:unknown;displayName?:unknown},now=Date.now()) {
  const settled=settleNebulaSharedBingoClaims(game,now),square=game.squares[12];
  if(game.completedAt)return{changed:settled.changed,outcome:"complete" as const};
  if(square.status==="chat")return{changed:settled.changed,outcome:"unavailable" as const};
  const joined=joinNebulaGame(runtime,{...input,gameId:"bingo"},new Date(now));
  if(joined.player.gamePointsBalance<NEBULA_SHARED_BINGO_CENTER_FREE_COST)return{changed:settled.changed,outcome:"insufficient" as const,balance:joined.player.gamePointsBalance,cost:NEBULA_SHARED_BINGO_CENTER_FREE_COST};
  spendNebulaGamePoints(runtime,joined.player,NEBULA_SHARED_BINGO_CENTER_FREE_COST,"Buy shared Bingo center free space",new Date(now));
  square.status="chat";square.claimedBy=joined.player.id;delete square.claimUntil;participant(game,joined.player).actions+=1;
  const completion=completeIfWon(runtime,game,cleanChannel(input.channel),now);game.updatedAt=new Date(now).toISOString();
  return{changed:true,outcome:"freed" as const,coordinate:square.coordinate,cost:NEBULA_SHARED_BINGO_CENTER_FREE_COST,...completion};
}

export function nebulaSharedBingoSnapshot(game:NebulaSharedBingoStateV1,options:{includePhrases?:boolean;now?:number}={}) {
  const now=Number(options.now??Date.now());
  return{boardId:game.boardId,cells:game.squares.map(square=>({coordinate:square.coordinate,status:square.status,phrase:options.includePhrases?square.phrase:undefined,claimSeconds:square.status==="pending"&&square.claimUntil?Math.max(0,Math.ceil((Date.parse(square.claimUntil)-now)/1000)):0})),chatSquares:game.squares.filter(square=>square.status==="chat").length,stellaSquares:game.squares.filter(square=>square.status==="stella").length,participantCount:Object.keys(game.participants).length,complete:Boolean(game.completedAt),winningLine:game.winningLine??[],leaderboard:Object.values(game.participants).sort((a,b)=>b.actions-a.actions).slice(0,10),updatedAt:game.updatedAt};
}

function cleanChannel(value:string){const channel=String(value??"").trim().toLowerCase().replace(/^#/,"").slice(0,80);if(!channel)throw new Error("Bingo channel is required");return channel;}
