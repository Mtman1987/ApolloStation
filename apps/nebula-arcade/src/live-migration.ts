import { readFileSync,realpathSync } from 'node:fs';
import { resolve,relative,isAbsolute } from 'node:path';
import { SqliteQuackverseArtStore } from './quackverse-art-store.js';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateDonorNebulaTagState } from './nebula-tag-migration.js';
import { SqliteNebulaTagStore } from './nebula-tag-runtime.js';
import { SqliteNebulaGameRuntimeStore } from './game-runtime-store.js';
import { normalizeNebulaGameRuntimeState } from './game-runtime.js';
import { SqliteNebulaTabletopRuntime,NEBULA_BINGO_STARTER_PHRASES } from './tabletop-runtime.js';
import { normalizeBingoState } from './bingo-game.js';
import { normalizeQuackverseState,normalizeQuackverseCollection } from './quackverse-state.js';
import { SqliteNebulaNetwork } from './arcade-network.js';
import { SqliteNebulaTagExperienceStore } from './nebula-tag-experience.js';
import { SqliteNebulaGameMixStore } from './game-mixes.js';
/** Converts data only. Provider tokens, webhooks, sessions and passwords never enter the import. */
export function prepareNebulaLiveImport(source:Record<string,any>,input:{tenantId:string;identityMap?:Record<string,string>;now?:string}){
 const now=input.now??new Date().toISOString(),map=input.identityMap??{},identity=(id:string)=>map[id]??id;
 const tag=migrateDonorNebulaTagState(source,{tenantId:input.tenantId,migratedAt:now});
 tag.state.players=Object.fromEntries(Object.entries(tag.state.players).map(([id,p])=>[identity(id),{...p,userId:identity(id),noTagbackFromUserId:p.noTagbackFromUserId?identity(p.noTagbackFromUserId):null}]));if(tag.state.currentItUserId)tag.state.currentItUserId=identity(tag.state.currentItUserId);tag.state.history=tag.state.history.map(entry=>({...entry,actorUserId:identity(entry.actorUserId),targetUserId:entry.targetUserId?identity(entry.targetUserId):null}));tag.state.monthlyWinners=tag.state.monthlyWinners.map(entry=>({...entry,userId:identity(entry.userId)}));
 tag.state.crownAwardKeys=tag.state.crownAwardKeys.map(key=>key.replace(/^(crown:[^:]+:[^:]+:)(.+)$/,(_,prefix,id)=>prefix+identity(id)));
 if(source.pinTags?.pinscorpion6521?.counts)tag.state.pinCounts=Object.fromEntries(Object.entries(source.pinTags.pinscorpion6521.counts).filter(([,count])=>Number.isSafeInteger(count)&&Number(count)>=0).map(([id,count])=>[identity(id),Number(count)]));
 // Preserve live manual score corrections instead of rebuilding a different total.
 for(const [id,p] of Object.entries(source.tagPlayers||{}) as [string,any][]){const player=tag.state.players[identity(String(p.id||p.userId||id))];if(player&&Number.isFinite(p.score))player.score=p.score;}
 const root=source.gameSettings?.default?.gameHub??{},games=normalizeNebulaGameRuntimeState(root);
 games.players=Object.fromEntries(Object.entries(games.players).map(([id,p])=>{const mapped=map[id]??map[id.replace(/^twitch:/,'')],key=mapped?`spmt:${mapped}`:id;return[key,{...p,id:key}];}));games.ledger=games.ledger.map(entry=>({...entry,playerId:map[entry.playerId]?`spmt:${map[entry.playerId]}`:entry.playerId}));
 const global=normalizeQuackverseState(source.quackverse||{},new Date(now));global.collections=Object.fromEntries(Object.entries(global.collections).map(([id,collection])=>[identity(id),normalizeQuackverseCollection(collection,new Date(now))]));
 global.claimedPlayers={playerOne:identity(global.claimedPlayers.playerOne),playerTwo:identity(global.claimedPlayers.playerTwo)};
 const rooms=Object.fromEntries(Object.entries(source.quackverseRooms||{}).map(([id,value])=>{const room=normalizeQuackverseState(value as any,new Date(now));room.claimedPlayers={playerOne:identity(room.claimedPlayers.playerOne),playerTwo:identity(room.claimedPlayers.playerTwo)};room.collections=global.collections;return[id,room];}));if(!Object.keys(rooms).length)rooms.default=global;
 const liveBingo=source.bingoCards||{},bingo=normalizeBingoState({templatePhrases:liveBingo.current_user?.phrases??liveBingo.templatePhrases??NEBULA_BINGO_STARTER_PHRASES,personalBoards:Object.fromEntries(Object.entries(liveBingo.personalBoards||{}).map(([id,board])=>[identity(id),board as import('./bingo-game.js').PersonalBingoBoardV1]))});
 const blacklist=[...new Set((source.botSettings?.blacklistedChannels?.channels||[]).map((value:unknown)=>String(value).replace(/^#/,'').toLowerCase()))] as string[];
 const playersExcluded=(Object.values(source.tagPlayers||{}) as any[]).filter(player=>player.optedOut===true||player.isPlayer===false).map(player=>identity(String(player.id||player.userId||player.twitchUsername)));
 const muted=(source.botSettings?.mutedChannels?.channels||[]).map(String) as string[];
 const tickets=Object.entries(source.supportTickets||{}).map(([id,ticket]:[string,any])=>({ticketId:id,tenantId:input.tenantId,channelId:String(ticket.channel||'support'),requesterUserId:identity(String(ticket.requesterId||ticket.requester||'unknown')),requesterUsername:String(ticket.requester||ticket.requesterId||'Player'),note:String(ticket.note||''),createdAt:Number.isFinite(Date.parse(ticket.createdAt))?ticket.createdAt:now,resolved:Boolean(ticket.resolved),resolvedAt:ticket.resolvedAt||now}));
 const profiles=Object.entries(source.gameSettings?.default?.gameHubOverlayProfiles||{}).map(([id,profile]:[string,any])=>{
   const ids=(profile.gameIds||[]).map((gameId:string)=>gameId.replace(/[^a-z0-9]/gi,'').toLowerCase()),columns=Math.ceil(Math.sqrt(ids.length)),rows=Math.ceil(ids.length/columns),owner=String(profile.ownerLogin||'').replace(/^#/,'').toLowerCase();
   if(owner){games.channels[owner]??={extraGameIds:[],stoppedGameIds:[]};games.channels[owner]!.extraGameIds=[...new Set([...games.channels[owner]!.extraGameIds,...ids])] as string[];}
   return{id:id.replace(/[^a-z0-9_-]/gi,'-').toLowerCase().slice(0,80),name:String(profile.name||'Imported game mix').slice(0,100),mode:(profile.layout==='focus'?'manual':profile.layout==='auto-grid'||profile.layout==='stack'?'simultaneous':'rotate') as 'manual'|'simultaneous'|'rotate',rotationSeconds:30,activityBox:true,layers:ids.map((gameId:string,index:number)=>({gameId,zIndex:index,...(profile.layout==='auto-grid'?{x:(index%columns)*100/columns,y:Math.floor(index/columns)*100/rows,width:100/columns,height:100/rows}:{})}))};
 });
 const artAssets=Object.entries(source.gameSettings?.default?.quackverseArt??{}).flatMap(([id,record]:[string,any])=>['static','hover'].flatMap(variant=>{const asset=record?.[variant];return asset?.fileName?[{cardId:Number(id),variant:variant==='static'?'master':'hover',fileName:String(asset.fileName)}]:[];}));
 const counts={artAssets:artAssets.length,tagPlayers:Object.keys(tag.state.players).length,arcadePlayers:Object.keys(games.players).length,collections:Object.keys(global.collections).length,cards:Object.values(global.collections).reduce((sum,c)=>sum+c.cards.length,0),savedDecks:Object.values(global.collections).reduce((sum,c)=>sum+c.savedDecks.length,0),rooms:Object.keys(rooms).length,bingoPlayers:Object.keys(bingo.personalBoards).length,tickets:tickets.length,blacklistedChannels:blacklist.length,mixes:profiles.length};
 return{schemaVersion:1 as const,tenantId:input.tenantId,now,tag:tag.state,games,collections:global.collections,rooms,bingo,blacklist,playersExcluded,muted,tickets,profiles,artAssets,counts,warnings:tag.report.warnings};
}
export function importNebulaLiveData(path:string,prepared:ReturnType<typeof prepareNebulaLiveImport>){
 const tenant=prepared.tenantId,tag=new SqliteNebulaTagStore(path),games=new SqliteNebulaGameRuntimeStore(path),tabletop=new SqliteNebulaTabletopRuntime(path),network=new SqliteNebulaNetwork(path),experience=new SqliteNebulaTagExperienceStore(path),mixes=new SqliteNebulaGameMixStore(path),db=new DatabaseSync(path);
 try{db.exec('CREATE TABLE IF NOT EXISTS nebula_live_imports(tenant_id TEXT PRIMARY KEY,digest TEXT NOT NULL,report TEXT NOT NULL,imported_at TEXT NOT NULL)');const digest=createHash('sha256').update(JSON.stringify(prepared)).digest('hex'),prior=db.prepare('SELECT digest,report FROM nebula_live_imports WHERE tenant_id=?').get(tenant) as {digest:string;report:string}|undefined;if(prior){if(prior.digest!==digest)throw new Error('This network already has a different live import. Use a fresh database.');return JSON.parse(prior.report);}
 if(tag.getState(tenant).revision>0||Object.keys(games.get(tenant).players).length)throw new Error('Live import requires a fresh target network. Keep the current database as the rollback copy.');
 tag.importState(prepared.tag,`live:${digest}`);games.put(tenant,prepared.games);tabletop.importData(tenant,{bingo:prepared.bingo,collections:prepared.collections,rooms:prepared.rooms});
 for(const player of Object.values(prepared.tag.players))if(player.eligible!==false)network.enroll(player.userId.startsWith('provider:')?player.userId:`spmt:${player.userId}`,true,prepared.now);
 for(const player of Object.values(prepared.games.players))if(Object.values(player.joinedGames).some(membership=>membership.active))network.enroll(player.id,true,prepared.now);
 for(const channel of prepared.blacklist)network.blacklist(tenant,'channel',channel,true,'Imported live blacklist',prepared.now);for(const player of prepared.playersExcluded)network.blacklist(tenant,'player',player,true,'Imported live opt-out',prepared.now);for(const channel of prepared.muted)experience.setOverlayMode(tenant,channel,true,prepared.now);
 for(const ticket of prepared.tickets){experience.createSupportTicket(ticket);network.updateJob(tenant,`support:${ticket.ticketId}`,'done',ticket,prepared.now);if(ticket.resolved){experience.resolveSupportTicket(tenant,ticket.ticketId,ticket.resolvedAt);network.updateJob(tenant,`support-resolved:${ticket.ticketId}`,'done',ticket,prepared.now);}}
 for(const profile of prepared.profiles)mixes.save(tenant,profile);
 const report={...prepared.counts,warnings:prepared.warnings,digest};db.prepare('INSERT INTO nebula_live_imports VALUES(?,?,?,?)').run(tenant,digest,JSON.stringify(report),prepared.now);return report;
 }finally{db.close();mixes.close();experience.close();network.close();tabletop.close();games.close();tag.close();}
}

/** Reads only files inside the supplied live art volume, including symlink resolution. */
export function importNebulaLiveArt(path:string,prepared:ReturnType<typeof prepareNebulaLiveImport>,directory:string){
 const root=realpathSync(directory),art=new SqliteQuackverseArtStore(path);let imported=0;
 try{for(const asset of prepared.artAssets){const file=realpathSync(resolve(root,asset.fileName)),rel=relative(root,file);if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw new Error('Live artwork escaped its volume');art.put(prepared.tenantId,asset.cardId,asset.variant,readFileSync(file));imported++;}return{imported};}finally{art.close();}
}
