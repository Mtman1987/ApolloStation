import { NebulaMediaDelivery } from "./media-delivery.js";
import { SqliteNebulaNetwork } from "./arcade-network.js";
import { SqliteNebulaTabletopRuntime } from "./tabletop-runtime.js";
import { SqliteNebulaGameInputStore } from "./game-inputs.js";
import { readFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import { SqliteNebulaGameActionStore, validateNebulaGameAction } from "./game-actions.js";
import { NEBULA_ARCADE_GAMES, parseNebulaMessage, resolveNebulaCommand, type NebulaCommandTargetV1 } from "./game-hub.js";
import { NEBULA_CONTINUATION_GAMES, nebulaGuideReplies } from "./game-guide.js";
import { SqliteNebulaArcadeActivityStore } from "./arcade-activity.js";
import { claimNebulaGameCommand, getNebulaGameStats, getOrCreateNebulaPlayer, joinNebulaGame, leaveNebulaGame, normalizeNebulaPlayerId, recordNebulaGameChatActivity, resolveNebulaChannelGameIds, setNebulaChannelGameRunning } from "./game-runtime.js";
import { SqliteNebulaGameRuntimeStore } from "./game-runtime-store.js";
import { buildNebulaDiscordDashboard, nebulaDiscordDashboardSignature, SqliteNebulaDiscordDashboardStore, type NebulaDiscordDashboardEgressV1 } from "./discord-dashboard.js";
import { isNebulaChannelOptedOut, NebulaTagExperienceService, SqliteNebulaTagExperienceStore } from "./nebula-tag-experience.js";
import { NebulaTagRuntime, SqliteNebulaTagStore } from "./nebula-tag-runtime.js";

export interface NebulaArcadeProviderChannelV1 {
  provider: "twitch" | "discord" | "kick" | "youtube";
  connectionId: string;
  channelId: string;
  stateChannelId: string;
  enabledGameIds: string[];
}
export interface NebulaArcadeProviderTenantV1 { tenantId: string; pinUserId: string; channels: NebulaArcadeProviderChannelV1[]; supportChannelId?:string; packChannelId?:string; autoJoinLivePlayers?:boolean; }
export interface NebulaArcadeProviderConfigV1 { schemaVersion: 1; revision: string; tenants: NebulaArcadeProviderTenantV1[]; }
export interface NebulaArcadeProviderEnvironmentV1 { runtimeMode: "production" | "sandbox"; databasePath: string; configPath: string; credential: string; config: NebulaArcadeProviderConfigV1; }
export interface NebulaArcadeProviderEgressV1 { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>; }

const GAME_IDS = new Set(NEBULA_ARCADE_GAMES.map((game) => game.id));
const JOIN_COMMANDS = new Set(["pack","quackpack","card","chaos","garden","grow","wars","chicken","hatch","symphony","harmony","colors","parade","rain","tower","memory","pet","race","phrase","pixel","rhythm","treasure","chain","storm"]);

export function loadNebulaArcadeProviderConfig(path: string): NebulaArcadeProviderConfigV1 {
  if (!isAbsolute(path)) throw new Error("NEBULA_ARCADE_RUNTIME_CONFIG_PATH must be absolute");
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("Nebula Arcade provider config must be readable JSON"); }
  return validateNebulaArcadeProviderConfig(value);
}

export function validateNebulaArcadeProviderEnvironment(environment: NodeJS.ProcessEnv): NebulaArcadeProviderEnvironmentV1 {
  const runtimeMode = environment.SPMT_RUNTIME_MODE === "sandbox" ? "sandbox" : "production";
  const databasePath = environment.NEBULA_ARCADE_DATABASE_PATH ?? "";
  const configPath = environment.NEBULA_ARCADE_RUNTIME_CONFIG_PATH ?? "";
  const credential = environment.NEBULA_ARCADE_WORKER_CREDENTIAL ?? "";
  if (!databasePath || !isAbsolute(databasePath)) throw new Error("NEBULA_ARCADE_DATABASE_PATH must be absolute");
  if (!configPath || !isAbsolute(configPath)) throw new Error("NEBULA_ARCADE_RUNTIME_CONFIG_PATH must be absolute");
  if (credential.length < 32) throw new Error("A 32+ character NEBULA_ARCADE_WORKER_CREDENTIAL is required");
  const config = loadNebulaArcadeProviderConfig(configPath);
  if (runtimeMode === "sandbox") {
    if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("Sandbox Nebula Arcade requires SPMT_OUTBOUND_MODE=disabled");
    if (!basename(databasePath).toLowerCase().includes("sandbox")) throw new Error("Sandbox Nebula Arcade requires a sandbox-named database");
    if (!basename(configPath).toLowerCase().includes("sandbox")) throw new Error("Sandbox Nebula Arcade requires a sandbox-named runtime config");
    if (config.tenants.length) throw new Error("Sandbox Nebula Arcade rejects live provider tenants");
  }
  return { runtimeMode, databasePath, configPath, credential, config };
}

export class NebulaArcadeProviderRuntime {
  readonly consumers;
  private readonly media:NebulaMediaDelivery;
  private readonly network:SqliteNebulaNetwork;
  private readonly tabletop: SqliteNebulaTabletopRuntime;
  private readonly inputStore: SqliteNebulaGameInputStore;
  private readonly activity: SqliteNebulaArcadeActivityStore;
  private readonly tagStore: SqliteNebulaTagStore;
  private readonly experienceStore: SqliteNebulaTagExperienceStore;
  private readonly gameStore: SqliteNebulaGameRuntimeStore;
  private readonly actionStore: SqliteNebulaGameActionStore;
  private readonly dashboardStore?: SqliteNebulaDiscordDashboardStore;
  private readonly tagRuntime: NebulaTagRuntime;
  private readonly experiences = new Map<string, NebulaTagExperienceService>();
  private readonly channels = new Map<string, NebulaArcadeProviderChannelV1>();
  private readonly dashboardSignatures = new Map<string, string>();
  private closed = false;
  constructor(private readonly options: { databasePath: string; config: NebulaArcadeProviderConfigV1; client: SpmtClient; egress: NebulaArcadeProviderEgressV1; onLiveChannels?: (tenantId:string,channels:string[])=>Promise<Array<{connectionId:string;channelId:string}>>; presence?: (tenantId:string,players:Array<{userId:string;username:string}>)=>Promise<{liveUserIds:string[];channelByUserId:Record<string,string>;observedAt:string}>; simulation?: boolean; publicOrigin?: string; discordDashboard?: { egress: NebulaDiscordDashboardEgressV1; publicOrigin: string; gameplayOrigin?: string; webhookName?: string; avatarUrl?: string }; now?: () => string }) {
    this.media=new NebulaMediaDelivery({databasePath:options.databasePath,client:options.client,...((options.publicOrigin??options.discordDashboard?.publicOrigin)?{publicOrigin:options.publicOrigin??options.discordDashboard!.publicOrigin}:{}),...(options.discordDashboard?{egress:options.discordDashboard.egress}:{}),...(options.now?{now:options.now}:{})});
    this.network = new SqliteNebulaNetwork(options.databasePath);
    this.tabletop = new SqliteNebulaTabletopRuntime(options.databasePath);
    this.inputStore = new SqliteNebulaGameInputStore(options.databasePath);
    this.activity = new SqliteNebulaArcadeActivityStore(options.databasePath);
    this.tagStore = new SqliteNebulaTagStore(options.databasePath);
    this.experienceStore = new SqliteNebulaTagExperienceStore(options.databasePath);
    this.gameStore = new SqliteNebulaGameRuntimeStore(options.databasePath);
    this.actionStore = new SqliteNebulaGameActionStore(options.databasePath);
    if (options.discordDashboard) this.dashboardStore = new SqliteNebulaDiscordDashboardStore(options.databasePath);
    this.tagRuntime = new NebulaTagRuntime(this.tagStore, options.client);
    for (const tenant of options.config.tenants) {
      this.experiences.set(tenant.tenantId, new NebulaTagExperienceService(this.tagRuntime, this.experienceStore, tenant.pinUserId, options.now));
      for (const channel of tenant.channels) {
        this.channels.set(channelKey(tenant.tenantId, channel.provider, channel.connectionId, channel.channelId), channel);
        this.activity.configure(tenant.tenantId,channel.stateChannelId,channel.enabledGameIds);
      }
    }
    this.consumers = [{
      id: "nebula.arcade.provider-ingress" as const,
      accepts: (message: NormalizedChatMessageV1) => !message.actor.isBot && this.channels.has(messageKey(message)),
      deliver: (delivery: NormalizedChatDeliveryV1) => this.deliver(delivery),
    }];
  }
  async reconcile() {
    const delivery = { attempted: 0, delivered: 0, failed: 0 };
    for (const tenant of this.options.config.tenants) {
      await this.flushAnnouncements(tenant.tenantId);
      await this.media.flush(tenant.tenantId,tenant.channels,tenant.supportChannelId,tenant.packChannelId);
      const report = await this.tagRuntime.flushPending(tenant.tenantId);
      delivery.attempted += report.attempted; delivery.delivered += report.delivered; delivery.failed += report.failed;
    }
    const rotations:unknown[]=[];
    for(const tenant of this.options.config.tenants){
      let presence=this.network.presence(tenant.tenantId,Date.parse(this.options.now?.()??new Date().toISOString()));
      if(this.options.presence && (!presence||Date.now()-Date.parse(presence.observedAt)>60000)){
        try{const snapshot=await this.options.presence(tenant.tenantId,Object.values(this.tagRuntime.getState(tenant.tenantId).state.players).filter(player=>player.eligible!==false));this.network.recordPresence(tenant.tenantId,snapshot);presence=snapshot;
        if(tenant.autoJoinLivePlayers&&this.options.onLiveChannels){const wanted=snapshot.liveUserIds.filter(id=>!this.network.blocked(tenant.tenantId,id,this.tagRuntime.getState(tenant.tenantId).state.players[id]?.username??'',snapshot.channelByUserId[id])).map(id=>snapshot.channelByUserId[id]!).filter(Boolean),connected=await this.options.onLiveChannels(tenant.tenantId,wanted),seed=tenant.channels.find(channel=>channel.provider==='twitch'&&!channel.connectionId.startsWith('nebula-live-'));
          if(seed){for(const old of tenant.channels.filter(channel=>channel.connectionId.startsWith('nebula-live-')))this.channels.delete(channelKey(tenant.tenantId,old.provider,old.connectionId,old.channelId));tenant.channels=tenant.channels.filter(channel=>!channel.connectionId.startsWith('nebula-live-'));for(const item of connected){const next={...seed,...item,stateChannelId:item.channelId};tenant.channels.push(next);this.channels.set(channelKey(tenant.tenantId,next.provider,next.connectionId,next.channelId),next);this.activity.configure(tenant.tenantId,next.stateChannelId,next.enabledGameIds);}}
        }
        }catch{/* Keep the last fresh observation; a failed poll never means offline. */}
      }
      const channel=tenant.channels.find(channel=>resolveNebulaChannelGameIds(this.gameStore.get(tenant.tenantId),channel.stateChannelId,channel.enabledGameIds).includes("tag")&&!isNebulaChannelOptedOut(this.experienceStore,tenant.tenantId,channel.channelId,channel.stateChannelId));
      if(presence&&channel){const rotation=await this.tagRuntime.reconcileRotation({tenantId:tenant.tenantId,channelId:channel.channelId,now:this.options.now?.()??new Date().toISOString(),liveUserIds:presence.liveUserIds});rotations.push(rotation);if("result" in rotation&&rotation.result.status==="applied")await this.announce(tenant.tenantId,rotation.result.commandId,rotation.result.message);}
    }
    const dashboard = await this.publishDashboards(false);
    return { schemaVersion: 1 as const, configuredTenants: this.options.config.tenants.length, configuredChannels: this.channels.size, tagDelivery: delivery, dashboard, rotation: rotations.length?{status:"reconciled",results:rotations}:{status:"presence-required",reason:"Automatic Tag rotation is fenced until a fresh canonical presence snapshot is available."} };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.media.close();this.network.close();this.tabletop.close(); this.inputStore.close(); this.activity.close(); this.dashboardStore?.close(); this.actionStore.close(); this.gameStore.close(); this.experienceStore.close(); this.tagStore.close();
  }
  private async deliver(delivery: NormalizedChatDeliveryV1) {
    if (this.closed) throw new Error("Nebula Arcade provider runtime is closed");
    const message=delivery.message, channel=this.channels.get(messageKey(message)), experience=this.experiences.get(message.tenantId);
    if (!channel || !experience || message.actor.isBot) return;
    const channelIds=[...new Set([message.sourceChannelId??message.channelId,message.channelId,channel.stateChannelId])];
    if (isNebulaChannelOptedOut(this.experienceStore,message.tenantId,...channelIds)) return;
    if(this.network.blocked(message.tenantId,actorId(message),message.actor.username,channel.stateChannelId))return;
    if(message.supportEvent){
      const event=message.supportEvent,state=this.tagRuntime.getState(message.tenantId).state,user=actorId(message),presence=this.network.presence(message.tenantId,Date.parse(message.occurredAt));
      if(state.players[user]?.eligible!==false&&state.players[user]&&(event.kind!=="cheer"||event.amount>=100)&&(event.kind!=="raid"||presence?.liveUserIds.includes(user))){
        const result=await this.tagRuntime.execute({schemaVersion:1,tenantId:message.tenantId,channelId:channel.stateChannelId,commandId:`support-event:${message.provider}:${message.messageId}`,actorUserId:"system:nebula-support",isModerator:true,kind:"grant-pass",targetUserId:user,occurredAt:message.occurredAt});if(result.result.status==="applied")await this.reply(message,delivery.deliveryId,"support-pass",result.result.message);
      }
      if(!parseNebulaMessage(message.text))return;
    }
    const parsed=parseNebulaMessage(message.text);
    if (parsed?.command==="optout" && (!parsed.gameId || parsed.gameId==="tag")) {
      const outcome=await experience.ingest(toTagMessage(message,"spmt optout"));
      if(outcome.kind==="reply") {
        // A shared-chat source is a separate room, not a receiving-channel alias.
        if(outcome.code==="channel-opted-out" && (!message.sourceChannelId || message.sourceChannelId===message.channelId)) this.experienceStore.optOutChannel(message.tenantId,channel.stateChannelId,message.occurredAt);
        await this.reply(message,delivery.deliveryId,outcome.code,outcome.message);
      }
      return;
    }
    const now=Date.parse(message.occurredAt),actor=gameActorId(message);
    this.activity.observe(message.tenantId,channel.stateChannelId,actor,message.text,now);
    if(!parsed || !parsed.body){if(!parsed&&this.tagRuntime.getState(message.tenantId).state.players[actorId(message)]?.eligible!==false&&this.tagRuntime.getState(message.tenantId).state.players[actorId(message)])await this.tagRuntime.ingest(toTagMessage(message,message.text));return;}
    const activeIds=resolveNebulaChannelGameIds(this.gameStore.get(message.tenantId),channel.stateChannelId,channel.enabledGameIds);
    if(!parsed.gameId && ["join","leave"].includes(parsed.command)){
      const enrolled=parsed.command==="join";this.network.enroll(actor,enrolled,message.occurredAt);
      this.gameStore.update(message.tenantId,state=>{for(const gameId of NEBULA_ARCADE_GAMES.map(game=>game.id))if(enrolled)joinNebulaGame(state,{userId:actor,username:message.actor.username,displayName:message.actor.displayName,gameId},new Date(message.occurredAt));else leaveNebulaGame(state,actor,gameId,new Date(message.occurredAt));});
      if(activeIds.includes("tag")){const state=this.tagRuntime.getState(message.tenantId).state;if(enrolled&&!state.players[actorId(message)]||!enrolled&&state.players[actorId(message)])await experience.ingest(toTagMessage(message,`spmt ${parsed.command}`));}
      if(message.provider==="discord"&&activeIds.includes("tag"))await this.publishDashboard(message.tenantId,channel,true).catch(()=>undefined);
      for(const gameId of activeIds)this.activity.membership(message.tenantId,channel.stateChannelId,actor,gameId,enrolled,now);
      await this.reply(message,delivery.deliveryId,"arcade-enrollment",enrolled?"You joined the Nebula Arcade player pool across chats. Play any active game with spmt. Use spmt <game> leave to skip a game, or spmt leave to leave the pool.":"You left the Nebula Arcade player pool.");return;
    }
    if(!parsed.gameId && ["score","points","leader","pleader","leaderboard","rankings"].includes(parsed.command)){
      const state=this.gameStore.get(message.tenantId),player=state.players[actor];
      const text=parsed.command==="points"?`${message.actor.username}: ${player?.gamePointsBalance??0} Game Points · earned ${player?.lifetimeEarned??0} · spent ${player?.lifetimeSpent??0}`:["pleader","leaderboard","rankings"].includes(parsed.command)?Object.values(state.players).sort((a,b)=>b.gamePointsBalance-a.gamePointsBalance).slice(0,5).map((player,index)=>`${index+1}. ${player.displayName}: ${player.gamePointsBalance} GP`).join(" | "):Object.entries(player?.joinedGames??{}).filter(([id])=>parsed.command==="leader"||activeIds.includes(id)).map(([id,stats])=>`${gameName(id)}: ${stats.score} points, ${stats.wins} wins`).join(" | ");
      await this.reply(message,delivery.deliveryId,"arcade-stats",`${text||"No game scores yet."} ${this.options.publicOrigin??this.options.discordDashboard?.publicOrigin??""}/apps/nebula-arcade?view=stats`);return;
    }
    const guide=nebulaGuideReplies(message.text,activeIds,this.options.publicOrigin??this.options.discordDashboard?.publicOrigin);
    if(guide){for(const [index,body] of guide.entries())await this.reply(message,delivery.deliveryId,`guide-${index}`,body);return;}
    const choiceKey=`${messageKey(message)}\0${actor}`,choice=this.activity.choice(message.tenantId,choiceKey,actor,now);
    let selected:NebulaCommandTargetV1|undefined;
    if(/^\d+$/.test(parsed.body)&&choice){selected=choice[Number(parsed.body)-1];if(!selected){await this.reply(message,delivery.deliveryId,"choice-invalid",`Choose spmt 1 through spmt ${choice.length}.`);return;}this.activity.clearChoice(message.tenantId,choiceKey,actor);}
    else if(!/^\d+$/.test(parsed.body))this.activity.clearChoice(message.tenantId,choiceKey,actor);
    const available=["start","stop","status"].includes(parsed.command)?[...new Set([...channel.enabledGameIds,...activeIds])]:activeIds;
    const resolution=resolveNebulaCommand(message.text,available);
    if(!selected && resolution.kind==="none"){
      const catalog=resolveNebulaCommand(message.text,NEBULA_ARCADE_GAMES.map(game=>game.id));
      if(parsed.gameId || catalog.targets.length){const names=parsed.gameId?[gameName(parsed.gameId)]:catalog.targets.map(target=>gameName(target.gameId));await this.reply(message,delivery.deliveryId,"game-inactive",`${names.join(" / ")} is not active in this channel.`);return;}
    }
    if(!selected && resolution.kind==="choose-game"){this.activity.saveChoice(message.tenantId,choiceKey,actor,resolution.targets,now);await this.reply(message,delivery.deliveryId,"choose-game",resolution.prompt);return;}
    let targets=selected?[selected]:resolution.targets;
    if(!targets.length && activeIds.includes("tag") && ["whosit","stats","rank","givepass","away","sleep","wake","players","live","more","mute","unmute","support","ticket","pinrank"].includes(parsed.command))targets=[{gameId:"tag",command:parsed.command,args:parsed.args}];
    const enrollment=this.network.enrollment(actor);
    const joined=[...new Set([...this.activity.joinedGames(message.tenantId,channel.stateChannelId,actor),...(enrollment.enrolled?activeIds.filter(id=>!enrollment.excludedGames.includes(id)):[])])].filter(id=>!enrollment.excludedGames.includes(id));
    if(!targets.length && !parsed.gameId)targets=activeIds.filter(id=>joined.includes(id)&&NEBULA_CONTINUATION_GAMES.has(id)).map(gameId=>({gameId,command:"input",args:[parsed.body]}));
    const replies:string[]=[],accepted:string[]=[];
    for(const target of targets){
      if(!activeIds.includes(target.gameId)&&!["start","stop","status"].includes(target.command)){replies.push(`${gameName(target.gameId)} is stopped in this channel.`);continue;}
      if(target.command==="leave")this.network.excludeGame(actor,target.gameId,true,message.occurredAt);
      else if(target.command==="join"||JOIN_COMMANDS.has(target.command)){if(!enrollment.enrolled)this.network.enroll(actor,true,message.occurredAt);this.network.excludeGame(actor,target.gameId,false,message.occurredAt);}
      if(target.gameId==="tag"){
        if(enrollment.enrolled&&!enrollment.excludedGames.includes("tag")&&!this.tagRuntime.getState(message.tenantId).state.players[actorId(message)]&&target.command!=="leave")await experience.ingest(toTagMessage({...message,messageId:`${message.messageId}:enroll`},"spmt join"));
        const tag=await experience.ingest(toTagMessage(message,`spmt ${target.command} ${target.args.join(" ")}`.trim()),this.network.presence(message.tenantId,now));
        if((tag.kind==="reply"||tag.kind==="executed")&&tag.route==="chat")replies.push(tag.message);
        if(tag.kind==="executed"&&tag.execution.result.status!=="rejected"){
          if(tag.code==='tag-completed'&&actorId(message)===this.options.config.tenants.find(tenant=>tenant.tenantId===message.tenantId)?.pinUserId){const targetUserId=String(tag.execution.result.event?.payload.targetUserId||'');if(targetUserId)await this.tagRuntime.execute({schemaVersion:1,tenantId:message.tenantId,channelId:channel.stateChannelId,commandId:`pin:${message.messageId}`,actorUserId:'system:nebula-pin',kind:'pin-tag',isModerator:true,targetUserId,occurredAt:message.occurredAt});}
          this.gameStore.update(message.tenantId,state=>{for(const p of Object.values(this.tagRuntime.getState(message.tenantId).state.players)){const {membership}=joinNebulaGame(state,{userId:p.userId.startsWith("provider:")?p.userId:`spmt:${p.userId}`,username:p.username,gameId:"tag"});membership!.score=p.score;membership!.active=p.eligible!==false;}});
          if(["tag-completed","pass-completed"].includes(tag.code))await this.announce(message.tenantId,delivery.deliveryId,tag.message,message.channelId);
          this.activity.membership(message.tenantId,channel.stateChannelId,actor,"tag",!["leave","sleep"].includes(target.command),now);
          if(message.provider==="discord")await this.publishDashboard(message.tenantId,channel,true).catch(()=>undefined);
        }
        continue;
      }
      const game=NEBULA_ARCADE_GAMES.find(item=>item.id===target.gameId)!;
      const continuation=target.command==="input"||(NEBULA_CONTINUATION_GAMES.has(target.gameId)&&!["join","leave","status","start","stop"].includes(target.command)&&!game.commands.includes(target.command)&&!(target.gameId==="bingo"&&["center","reset","edit","generate","share","phrases","claim","card"].includes(target.command)));
      if(continuation){
        if(!joined.includes(target.gameId)){replies.push(`Join ${game.name} first with spmt ${game.id} join.`);continue;}
        if(target.gameId==="bingo"){const reply=this.tabletop.observeBingo({...message,channelId:channel.stateChannelId});if(!reply)continue;replies.push(reply);}
        this.gameStore.update(message.tenantId,state=>joinNebulaGame(state,{userId:actor,username:message.actor.username,displayName:message.actor.displayName,gameId:target.gameId},new Date(message.occurredAt)));
        this.activity.membership(message.tenantId,channel.stateChannelId,actor,target.gameId,true,now);accepted.push(target.gameId);continue;
      }
      if(["bingo","quackverse"].includes(target.gameId)&&!["start","stop"].includes(target.command)&&!(target.gameId==="bingo"&&target.command==="leave")){
        const command=target.command==="quackpack"?"pack":target.command;
        const normalized={...message,channelId:channel.stateChannelId,text:`spmt ${target.gameId} ${command} ${target.args.join(" ")}`.trim()};
        const result=this.tabletop.execute(normalized);if(result!==undefined)replies.push(result);
        if(this.tabletop.succeeded(normalized)){
          if(!["status","phrases","reset","collection","deck","hand","decks","savedeck","activatedeck","deletedeck","leave"].includes(command))replies.push(this.applyTarget(message,delivery.deliveryId,channel,{gameId:target.gameId,command:"join",args:[]}));
          if(command==="leave"){this.activity.membership(message.tenantId,channel.stateChannelId,actor,target.gameId,false,now);this.gameStore.update(message.tenantId,state=>leaveNebulaGame(state,actor,target.gameId,new Date(message.occurredAt)));}
          else accepted.push(target.gameId);
        }
        continue;
      }
      const reply=this.applyTarget(message,delivery.deliveryId,channel,target);replies.push(reply);if(reply.startsWith(`${gameName(target.gameId)} accepted`))accepted.push(target.gameId);
    }
    if(accepted.length){
      const normalizedText=selected?`spmt ${selected.gameId} ${selected.command} ${selected.args.join(" ")}`.trim():message.text;
      this.inputStore.append({...message,text:normalizedText},accepted,channel.stateChannelId);
      this.gameStore.update(message.tenantId,state=>{if(claimNebulaGameCommand(state,`activity:${delivery.deliveryId}`))recordNebulaGameChatActivity(state,{channel:channel.stateChannelId,userId:actor,username:message.actor.username,displayName:message.actor.displayName,message:normalizedText,profileGameIds:accepted,eligibleGameIds:accepted},now);});
    }
    if(replies.length)await this.reply(message,delivery.deliveryId,"game-action",replies.join(" "));
  }
  async announce(tenantId:string,id:string,text:string,sourceChannel?:string){
    const tenant=this.options.config.tenants.find(tenant=>tenant.tenantId===tenantId);if(!tenant)return;
    for(const channel of tenant.channels){if(channel.channelId===sourceChannel||isNebulaChannelOptedOut(this.experienceStore,tenantId,channel.channelId,channel.stateChannelId)||!resolveNebulaChannelGameIds(this.gameStore.get(tenantId),channel.stateChannelId,channel.enabledGameIds).includes('tag'))continue;
      const key=`nebula-announcement:${id}:${channel.provider}:${channel.connectionId}:${channel.channelId}`;
      this.network.enqueue(tenantId,key,'announcement',{channel,code:id,text:text.slice(0,440)},this.options.now?.());
    }
    await this.flushAnnouncements(tenantId);
  }
  private async flushAnnouncements(tenantId:string){for(const item of this.network.pending(tenantId,'announcement')){const {channel,code,text}=item.body,now=this.options.now?.()??new Date().toISOString();if(item.body.retryAt&&item.body.retryAt>now)continue;
    try{if(!isNebulaChannelOptedOut(this.experienceStore,tenantId,channel.channelId,channel.stateChannelId)&&this.channels.has(channelKey(tenantId,channel.provider,channel.connectionId,channel.channelId))){if(this.experienceStore.getChannelSettings(tenantId,channel.channelId).overlayMode)this.experienceStore.enqueueOverlayMessage({tenantId,channelId:channel.channelId,code,text,createdAt:now});else await this.options.egress.send({schemaVersion:1,tenantId,provider:channel.provider,connectionId:channel.connectionId,channelId:channel.channelId,text,idempotencyKey:item.id});}this.network.updateJob(tenantId,item.id,'done',item.body,now);}catch{this.network.updateJob(tenantId,item.id,'pending',{...item.body,retryAt:new Date(Date.parse(now)+15000).toISOString()},now);}
  }}
  private applyTarget(message: NormalizedChatMessageV1, deliveryId: string, channel: NebulaArcadeProviderChannelV1, target: NebulaCommandTargetV1) {
    if (target.command === "status") { const stats = getNebulaGameStats(this.gameStore.get(message.tenantId), target.gameId); return `${gameName(target.gameId)}: ${stats.players.length} active players. ${stats.leaderboard.slice(0,3).map(player=>`${player.displayName}: ${player.score}`).join(" · ")}`; }
    if (target.gameId === "petrace" && target.args.length && !["dog","cat","rabbit","turtle","hamster"].includes(target.args[0]!.toLowerCase())) return "Choose a Pet Race pet: dog, cat, rabbit, turtle or hamster.";
    const actionValue = JOIN_COMMANDS.has(target.command) ? "join" : target.command;
    let checked: ReturnType<typeof validateNebulaGameAction>;
    try { checked = validateNebulaGameAction(target.gameId, actionValue, actionValue === "join" ? [] : target.args); }
    catch (error) {
      if (error instanceof Error && /^Unsupported /.test(error.message)) return `${gameName(target.gameId)}: invalid spmt ${target.command} arguments. Use spmt ${target.gameId} help.`;
      throw error;
    }
    const commandId = `provider:${deliveryId}:${target.gameId}:${checked.action}`;
    const actor = gameActorId(message), username = message.actor.username, displayName = message.actor.displayName ?? username;
    const moderator = message.actor.roles.some((role) => role === "moderator" || role === "broadcaster");
    if ((checked.action === "start" || checked.action === "stop") && !moderator) return `Only the broadcaster or a moderator can ${checked.action} ${gameName(target.gameId)}.`;
    const changed = this.gameStore.update(message.tenantId, (state) => {
      if (!claimNebulaGameCommand(state, commandId)) return false;
      if (checked.action === "start" || checked.action === "stop") {
        setNebulaChannelGameRunning(state, channel.stateChannelId, target.gameId, checked.action === "start", new Date(message.occurredAt));
      } else {
        const active = resolveNebulaChannelGameIds(state, channel.stateChannelId, channel.enabledGameIds);
        if (!active.includes(target.gameId)) throw new Error(`${target.gameId} is not active in this channel`);
        if (checked.action === "leave") leaveNebulaGame(state, normalizeNebulaPlayerId(actor, username), target.gameId, new Date(message.occurredAt));
        else joinNebulaGame(state, { userId: actor, username, displayName, gameId: target.gameId }, new Date(message.occurredAt));
      }
      return true;
    }).result;
    if (changed && !["start","stop"].includes(checked.action)) this.activity.membership(message.tenantId,channel.stateChannelId,actor,target.gameId,checked.action!=="leave",Date.parse(message.occurredAt));
    this.actionStore.record({ id: commandId, tenantId: message.tenantId, channel: channel.stateChannelId, gameId: target.gameId, actorId: actor, username, displayName, action: checked.action, args: checked.args, message: message.text, occurredAt: message.occurredAt });
    const stats = getNebulaGameStats(this.gameStore.get(message.tenantId), target.gameId);
    return changed ? `${gameName(target.gameId)} accepted ${checked.action} for ${displayName}. ${stats.players.length} active.` : `${gameName(target.gameId)} already accepted that command.`;
  }
  private async reply(message: NormalizedChatMessageV1, deliveryId: string, code: string, text: string) {
    const chunks:string[]=[];let remainder=text;
    while(remainder.length>440){const cut=remainder.lastIndexOf(" ",440),end=cut>100?cut:440;chunks.push(remainder.slice(0,end));remainder=remainder.slice(end).trimStart();}
    if(remainder)chunks.push(remainder);
    for(const [index,chunk] of chunks.entries())await this.options.egress.send({schemaVersion:1,tenantId:message.tenantId,provider:message.provider,connectionId:message.connectionId,channelId:message.channelId,text:chunk,idempotencyKey:`nebula-arcade-reply:${deliveryId}:${code}:${index}`,replyToMessageId:message.messageId});
    if (this.options.simulation) await this.options.client.publishSimulationRoomEvent(message.tenantId, {
      roomId: `${message.provider}:${message.connectionId}:${message.channelId}`,
      lane: "game",
      direction: "preview",
      title: `Nebula Arcade ${code}`,
      body: text,
      provider: message.provider,
      connectionId: message.connectionId,
      channelId: message.channelId,
      replyToMessageId: message.messageId,
      data: { code, deliveryId, actor: message.actor.displayName ?? message.actor.username },
      occurredAt: this.options.now?.() ?? new Date().toISOString(),
    }, `nebula-simulation:${deliveryId}:${code}`).catch(() => undefined);
  }
  private async publishDashboards(force: boolean) {
    const report = { attempted: 0, delivered: 0, failed: 0 };
    if (!this.options.discordDashboard || !this.dashboardStore) return report;
    for (const tenant of this.options.config.tenants) for (const channel of tenant.channels) {
      if (channel.provider !== "discord") continue;
      report.attempted += 1;
      try { const changed = await this.publishDashboard(tenant.tenantId, channel, force); if (changed) report.delivered += 1; }
      catch { report.failed += 1; }
    }
    return report;
  }
  private async publishDashboard(tenantId: string, channel: NebulaArcadeProviderChannelV1, force: boolean) {
    if (!this.options.discordDashboard || !this.dashboardStore || channel.provider !== "discord") return false;
    if (isNebulaChannelOptedOut(this.experienceStore,tenantId,channel.channelId,channel.stateChannelId)) return false;
    const state = this.tagRuntime.getState(tenantId).state;
    const generatedAt = this.options.now?.() ?? new Date().toISOString();
    const signature = nebulaDiscordDashboardSignature(state, Date.parse(generatedAt));
    const key = channelKey(tenantId, channel.provider, channel.connectionId, channel.channelId);
    if (!force && this.dashboardSignatures.get(key) === signature) return false;
    const existing = this.dashboardStore.get(tenantId, channel.connectionId, channel.channelId);
    const built = buildNebulaDiscordDashboard(state, { publicOrigin: this.options.discordDashboard.publicOrigin, generatedAt, ...(this.options.discordDashboard.gameplayOrigin ? { gameplayOrigin: this.options.discordDashboard.gameplayOrigin } : {}), ...(this.options.discordDashboard.webhookName ? { webhookName: this.options.discordDashboard.webhookName } : {}), ...(this.options.discordDashboard.avatarUrl ? { avatarUrl: this.options.discordDashboard.avatarUrl } : {}) });
    const result = await this.options.discordDashboard.egress.upsertDiscordDashboard({ schemaVersion: 1, tenantId, connectionId: channel.connectionId, channelId: channel.channelId, webhookName: built.webhookName, ...(built.avatarUrl ? { avatarUrl: built.avatarUrl } : {}), ...(existing ? { previousMessageId: existing.messageId, previousTransport: existing.transport } : {}), payload: built.payload });
    this.dashboardStore.put({ tenantId, connectionId: channel.connectionId, channelId: channel.channelId, messageId: result.providerMessageId, transport: result.transport, updatedAt: this.options.now?.() ?? new Date().toISOString() });
    this.dashboardSignatures.set(key, signature);
    return true;
  }
}

export function validateNebulaArcadeProviderConfig(value: unknown): NebulaArcadeProviderConfigV1 {
  const root = object(value, "Nebula Arcade provider config"); exact(root, ["schemaVersion","revision","tenants"], "Nebula Arcade provider config");
  if (root.schemaVersion !== 1) throw new Error("Nebula Arcade provider config schemaVersion must be 1");
  const revision = identifier(root.revision, "revision");
  if (!Array.isArray(root.tenants) || root.tenants.length > 100) throw new Error("Nebula Arcade provider tenants must be an array of at most 100 entries");
  const tenantKeys = new Set<string>(); const channelKeys = new Set<string>();
  const tenants = root.tenants.map((raw, tenantIndex) => {
    const tenant = object(raw, `tenants[${tenantIndex}]`); exact(Object.fromEntries(Object.entries(tenant).filter(([key])=>!["supportChannelId","packChannelId","autoJoinLivePlayers"].includes(key))),["tenantId","pinUserId","channels"],`tenants[${tenantIndex}]`);
    const tenantId=identifier(tenant.tenantId,"tenantId"),pinUserId=identifier(tenant.pinUserId,"pinUserId");
    if(tenantKeys.has(tenantId))throw new Error("Nebula Arcade provider config contains a duplicate tenant");tenantKeys.add(tenantId);
    if(!Array.isArray(tenant.channels)||tenant.channels.length>100)throw new Error("Nebula Arcade provider channels must be an array of at most 100 entries");
    const channels=tenant.channels.map((rawChannel,channelIndex)=>{const item=object(rawChannel,`channels[${channelIndex}]`);exact(item,["provider","connectionId","channelId","stateChannelId","enabledGameIds"],`channels[${channelIndex}]`);const provider=String(item.provider) as NebulaArcadeProviderChannelV1["provider"];if(!["twitch","discord","kick"].includes(provider))throw new Error("Nebula Arcade provider is invalid");const connectionId=identifier(item.connectionId,"connectionId"),channelId=identifier(item.channelId,"channelId"),stateChannelId=identifier(item.stateChannelId,"stateChannelId");if(!Array.isArray(item.enabledGameIds)||!item.enabledGameIds.length)throw new Error("Nebula Arcade enabledGameIds must not be empty");const enabledGameIds=[...new Set(item.enabledGameIds.map((gameId)=>String(gameId).trim().toLowerCase()))];if(enabledGameIds.some((gameId)=>!GAME_IDS.has(gameId)))throw new Error("Nebula Arcade enabledGameIds contains an unknown game");const key=channelKey(tenantId,provider,connectionId,channelId);if(channelKeys.has(key))throw new Error("Nebula Arcade provider config contains a duplicate channel");channelKeys.add(key);return{provider,connectionId,channelId,stateChannelId,enabledGameIds};});
    if(tenant.autoJoinLivePlayers!==undefined&&typeof tenant.autoJoinLivePlayers!=="boolean")throw new Error("autoJoinLivePlayers must be boolean");
    return{tenantId,pinUserId,channels,...(tenant.autoJoinLivePlayers===undefined?{}:{autoJoinLivePlayers:tenant.autoJoinLivePlayers}),...(tenant.supportChannelId?{supportChannelId:identifier(tenant.supportChannelId,"supportChannelId")}:{}),...(tenant.packChannelId?{packChannelId:identifier(tenant.packChannelId,"packChannelId")}:{} )};
  });
  return{schemaVersion:1,revision,tenants};
}

function toTagMessage(message:NormalizedChatMessageV1,text:string){return{schemaVersion:1 as const,provider:message.provider,tenantId:message.tenantId,channelId:message.sourceChannelId??message.channelId,messageId:`${message.connectionId}:${message.messageId}`,userId:actorId(message),username:message.actor.displayName??message.actor.username,...(message.actor.avatarUrl?{avatarUrl:message.actor.avatarUrl}:{}),text,occurredAt:message.occurredAt,roles:message.actor.roles,mentions:message.mentions.map((mention)=>({token:mention.token,userId:mention.canonicalUserId??`provider:${message.provider}:${mention.providerUserId}`,username:mention.username}))};}
function actorId(message:NormalizedChatMessageV1){return message.actor.canonicalUserId??`provider:${message.provider}:${message.actor.providerUserId}`;}
function gameActorId(message:NormalizedChatMessageV1){return message.actor.canonicalUserId?`spmt:${message.actor.canonicalUserId}`:`provider:${message.provider}:${message.actor.providerUserId}`;}
function messageKey(message:NormalizedChatMessageV1){return channelKey(message.tenantId,message.provider,message.connectionId,message.channelId);}
function channelKey(tenantId:string,provider:string,connectionId:string,channelId:string){return`${tenantId}\0${provider}\0${connectionId}\0${channelId}`;}
function gameName(gameId:string){return NEBULA_ARCADE_GAMES.find((game)=>game.id===gameId)?.name??gameId;}
function identifier(value:unknown,name:string){const text=String(value??"").trim();if(!text||text.length>200||!/^[A-Za-z0-9._:@/-]+$/.test(text))throw new Error(`${name} is invalid`);return text;}
function object(value:unknown,name:string){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${name} must be an object`);return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:string[],name:string){const allowed=new Set(keys);if(Object.keys(value).some((key)=>!allowed.has(key))||keys.some((key)=>!(key in value)))throw new Error(`${name} has invalid fields`);}
