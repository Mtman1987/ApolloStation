import { createHash, randomUUID } from "node:crypto";
import { spmtSuiteActionDescriptor, type SpmtSuiteActionJobInputV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import type { HearMeOutBotActionIdV1 } from "./bot-action-adapter.js";
import type { HearMeOutPublicPersonaV1, HearMeOutPersonaConversationCoordinator } from "./persona-conversation.js";
import type { HearMeOutMediaItemV1, HearMeOutPrincipalV1, SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";
import type { HearMeOutSuiteActionExecutorV1 } from "./suite-action-worker.js";
import type { HearMeOutVoiceBridgeController } from "./voice-bridge.js";

export interface HearMeOutSuitePersonaStoreV1 { listPersonas(tenantId: string, roomId: string): Array<{ personaId: string; targetTenantId: string; displayName: string }>; putPersona(principal: HearMeOutPrincipalV1, roomId: string, persona: HearMeOutPublicPersonaV1 & { transportHealthy?: boolean }): unknown; removePersona(tenantId: string, roomId: string, personaId: string): unknown; }
export interface HearMeOutSuiteMediaResolverV1 { resolve(input: { tenantId: string; query: string; lane: "music" | "movie"; operationId?: string }): Promise<HearMeOutMediaItemV1>; }

/** Uses the existing HearMeOut media worker rather than resolving media in a browser or duplicating provider credentials. */
export class SpmtHearMeOutSuiteMediaResolver implements HearMeOutSuiteMediaResolverV1 {
  constructor(private readonly client: Pick<SpmtClient, "createExecutionJob" | "getExecutionJob" | "listExecutionWorkers">, private readonly options: { maxWaitMs?: number; pollMs?: number } = {}) {}
  async resolve(input: { tenantId: string; query: string; lane: "music" | "movie"; operationId?: string }) {
    const operationId = input.operationId ?? randomUUID();
    const youtubeId = hearMeOutYoutubeId(input.query);
    if (youtubeId) return this.youtube(input, youtubeId, operationId);
    const direct = httpUrl(input.query);
    if (direct) return mediaItem(input.lane, input.query, direct);
    const result = await this.job(input.tenantId, "hearmeout.music.search", { query: input.query, limit: 5 }, operationId);
    const items = Array.isArray(result.items) ? result.items : [], item = items.find((value) => value && typeof value === "object" && typeof (value as Record<string, unknown>).url === "string") as Record<string, unknown> | undefined;
    if (!item) throw new Error("No music matched. Try the title and artist or a YouTube link.");
    const id = hearMeOutYoutubeId(String(item.url));
    if (id) return this.youtube(input, id, operationId, item);
    const playbackUrl = httpUrl(item.url); if (!playbackUrl) throw new Error("This search result has no playable source");
    return { itemId: clean(item.id || randomUUID(), 200), type: input.lane === "movie" ? "movie" as const : "music" as const, title: clean(item.title || input.query, 300), source: "hearmeout-catalog", playbackUrl, ...(httpUrl(item.thumbnail) ? { posterUrl: httpUrl(item.thumbnail)! } : {}), ...(Number.isFinite(Number(item.duration)) ? { durationSeconds: Math.max(0, Math.round(Number(item.duration) / 1_000)) } : {}) };
  }
  private async youtube(input: { tenantId: string; lane: "music" | "movie" }, videoId: string, operationId: string, search?: Record<string, unknown>): Promise<HearMeOutMediaItemV1> {
    const result = await this.job(input.tenantId, "hearmeout.youtube.resolve", { videoId, lane: input.lane }, operationId);
    const resolved = result.media as Record<string, unknown> | undefined;
    const playbackUrl = httpUrl(input.lane === "music" ? resolved?.audioUrl : resolved?.videoUrl);
    if (!playbackUrl) throw new Error("The provider did not return playable media; the room queue is unchanged");
    return { itemId: videoId, type: input.lane === "movie" ? "movie" : "music", title: clean(resolved?.title || search?.title || videoId, 300), source: "youtube", playbackUrl, posterUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, ...(Number.isFinite(Number(resolved?.durationMs)) ? { durationSeconds: Math.max(0, Math.round(Number(resolved!.durationMs) / 1000)) } : {}), metadata: { videoId, resolvedAt: String(resolved?.resolvedAt ?? ""), sourceUrl: `https://www.youtube.com/watch?v=${videoId}` } };
  }
  private async job(tenantId: string, capabilityId: string, input: Record<string, unknown>, operationId: string) {
    const workers = await this.client.listExecutionWorkers({ executionOwner: "hearmeout", capabilityId, tenantId });
    const worker = workers.filter(worker => worker.state === "ready" && worker.providerHealthy && worker.capabilityIds.includes(capabilityId) && (!worker.tenantIds || worker.tenantIds.includes(tenantId)) && Date.parse(worker.leaseExpiresAt) > Date.now()).sort((a, b) => a.workerId.localeCompare(b.workerId))[0];
    if (!worker) throw new Error("No HearMeOut media worker is available for this request. Try again when the worker reconnects.");
    const key = createHash("sha256").update(JSON.stringify([operationId, capabilityId, input])).digest("hex");
    const created = await this.client.createExecutionJob(tenantId, { ownerAppId: "hearmeout", capabilityId, executionOwner: "hearmeout", meteredResource: "hosted-worker-minutes", usageQuantity: 1, executionTarget: worker.executionTarget, meteringTarget: worker.executionTarget === "companion" ? "companion" : "hosted", input }, `hearmeout-media:${key}`);
    let job = created.job; const deadline = Date.now() + (this.options.maxWaitMs ?? 130_000), pollMs = this.options.pollMs ?? 300;
    while (!["succeeded", "failed", "dead-letter", "cancelled"].includes(job.state) && Date.now() < deadline) { await wait(pollMs); job = await this.client.getExecutionJob(tenantId, job.id); }
    if (job.state !== "succeeded") throw new Error(job.error?.message || "HearMeOut media search is still unavailable");
    return job.result ?? {};
  }
}

export function hearMeOutYoutubeId(value: string): string | undefined {
  let url: URL; try { url = new URL(value); } catch { return undefined; }
  const host = url.hostname.toLowerCase().replace(/^www\./, ""), youtube = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host);
  if (!youtube) return undefined;
  if (!httpUrl(value)) throw new Error("YouTube link must be a credential-free HTTP(S) URL");
  const id = host === "youtu.be" ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error("Choose a YouTube video link, rather than a channel or playlist");
  return id;
}

export class HearMeOutWebSuiteActionExecutor implements HearMeOutSuiteActionExecutorV1 {
  constructor(private readonly rooms: SqliteHearMeOutRoomMediaRuntime, private readonly media: HearMeOutSuiteMediaResolverV1, private readonly options: { personaConversation?: HearMeOutPersonaConversationCoordinator; personaDirectory?: (tenantId: string) => Promise<HearMeOutPublicPersonaV1[]>; personaStore?: HearMeOutSuitePersonaStoreV1; voiceBridge?: HearMeOutVoiceBridgeController } = {}) {}
  async execute(input: SpmtSuiteActionJobInputV1 & { action: HearMeOutBotActionIdV1 }, context: { tenantId: string; idempotencyKey: string }) {
    const principal = this.principal(input, context.tenantId);
    if (input.action === "hmo.rooms.read") { const rooms = this.rooms.listRooms(principal).map((room) => ({ roomId: room.roomId, name: room.name, privacy: room.privacy, owned: room.ownerUserId === principal.userId })); return { text: rooms.length ? `HearMeOut rooms: ${rooms.map((room) => room.name).join(", ")}.` : "There are no active HearMeOut rooms.", rooms }; }
    const roomId = this.roomId(principal, input.args.roomId || input.source.roomId);
    if (!this.rooms.listMembers(principal.tenantId, roomId).some(member => member.userId === principal.userId)) throw new Error("Join this HearMeOut room before reading or controlling its media");
    if (input.action === "hmo.media.state.read") { const music = this.rooms.getSession(principal.tenantId, roomId, "music"), movie = this.rooms.getSession(principal.tenantId, roomId, "movie"), playing = [music.current?.item.title, movie.current?.item.title].filter(Boolean); return { text: playing.length ? `Now playing in HearMeOut: ${playing.join(" and ")}.` : "Nothing is playing in that HearMeOut room.", roomId, music, movie }; }
    if (input.source.simulation === true && spmtSuiteActionDescriptor(input.action).risk !== "read") return this.simulationPreview(input, roomId);
    if (input.action === "hmo.media.request") { const query = required(input.args.query, "query"), lane = input.args.lane === "movie" ? "movie" : "music", item = await this.media.resolve({ tenantId: principal.tenantId, query, lane, operationId: context.idempotencyKey }), session = this.rooms.enqueue(principal, { roomId, lane, item, operationId: context.idempotencyKey }); return { text: `${item.title} was ${session.current?.item.itemId === item.itemId ? "started" : "added to the queue"}.`, roomId, lane, session }; }
    if (input.action === "hmo.media.control") { const control = input.args.control === "stop" ? "clear" : input.args.control, allowed = ["play", "pause", "next", "clear", "mute", "unmute", "volume"] as const; if (!allowed.includes(control as typeof allowed[number])) throw new Error("Unsupported HearMeOut media control"); const lane = input.args.lane === "movie" ? "movie" : "music", current = this.rooms.getSession(principal.tenantId, roomId, lane).current, session = this.rooms.control(principal, { roomId, lane, action: control as typeof allowed[number], operationId: context.idempotencyKey, ...(control === "next" && current ? { expectedRequestId: current.requestId } : {}), ...(control === "volume" ? { position: percent(input.args.value) } : {}) }); return { text: `${lane === "movie" ? "Watch" : "Music"} playback is now ${session.playback.status}.`, roomId, lane, session }; }
    if (input.action === "hmo.bot.control") return this.persona(principal, roomId, input.args);
    const voice = this.options.voiceBridge; if (!voice) throw new Error("HearMeOut voice-bridge adapter is unavailable");
    if (input.action === "hmo.voice.bridge.state") { const state = await voice.status(principal, roomId); return { text: `HearMeOut voice bridge is ${state.config && typeof state.config === "object" && (state.config as { enabled?: boolean }).enabled ? "connected" : "stopped"}.`, roomId, ...state }; }
    const control = input.args.control;
    if (control === "start") { const result = await voice.start(principal, { roomId, guildId: required(input.args.guildId, "guildId"), voiceChannelId: required(input.args.voiceChannelId, "voiceChannelId") }); return { text: "Started the HearMeOut Discord voice bridge.", roomId, ...result }; }
    if (control === "stop") { const result = await voice.stop(principal, roomId); return { text: "Stopped the HearMeOut Discord voice bridge.", roomId, ...result }; }
    if (control === "listen-only" || control === "two-way") { const result = await voice.setRoomOutbound(principal, roomId, control === "two-way"); return { text: `Set the bridge to ${control}.`, roomId, ...result }; }
    if (control === "profile") { const result = await voice.setAudioProfile(principal, roomId, input.args.audioProfile as "low-latency" | "balanced" | "resilient" | "clean"); return { text: `Set the bridge audio profile to ${input.args.audioProfile}.`, roomId, ...result }; }
    throw new Error("Unsupported HearMeOut voice-bridge control");
  }
  private principal(input: SpmtSuiteActionJobInputV1, tenantId: string): HearMeOutPrincipalV1 { return { tenantId, userId: input.actor.userId, displayName: input.actor.username, roles: input.actor.role === "member" || input.actor.role === "guest" ? ["member"] : ["admin"] }; }
  private roomId(principal: HearMeOutPrincipalV1, requested: string | undefined) { if (requested) return requested; const joined = this.rooms.listRooms(principal).filter((room) => this.rooms.listMembers(principal.tenantId, room.roomId).some((member) => member.userId === principal.userId)); if (joined.length !== 1) throw new Error("Choose a HearMeOut room for this action"); return joined[0]!.roomId; }
  private simulationPreview(input: SpmtSuiteActionJobInputV1 & { action: HearMeOutBotActionIdV1 }, roomId: string) {
    const detail = input.action === "hmo.media.request" ? `request ${required(input.args.query, "query")}`
      : input.action === "hmo.media.control" ? `media control ${simulationMediaControl(input.args)}`
      : input.action === "hmo.bot.control" ? `persona ${required(input.args.control || "join", "control")} for ${required(input.args.bot || input.args.persona, "bot")}`
      : `Discord voice control ${simulationVoiceControl(input.args)}`;
    return { schemaVersion: 1, simulation: true, action: input.action, roomId, text: `Previewed ${detail} in HearMeOut room ${roomId}. No live room, media provider, persona, or Discord voice state was changed.` };
  }
  private async persona(principal:HearMeOutPrincipalV1,roomId:string,args:Record<string,string>){
    const coordinator=this.options.personaConversation,store=this.options.personaStore,directory=this.options.personaDirectory;
    if(!store||(!coordinator&&!directory))throw Error("HearMeOut persona-room adapter is unavailable");
    const control=args.control==='leave'?'leave':'join',query=required(args.bot||args.persona,'bot').toLowerCase();
    if(control==='join'){
      const gallery=coordinator?await coordinator.gallery():await directory!(principal.tenantId);
      const matches=gallery.filter(persona=>persona.canInvite&&[persona.personaId,persona.targetTenantId,persona.displayName,...persona.wakeNames].some(value=>value.toLowerCase()===query));
      if(matches.length!==1)throw Error(matches.length?'More than one public persona matches that name':'That public persona was not found');
      const persona=matches[0]!,result=coordinator?await coordinator.control({action:'join',roomId,persona}):undefined;
      store.putPersona(principal,roomId,{...persona,transportHealthy:result?.worker.transportHealthy===true});
      return{roomId,persona,text:`${persona.displayName} joined the HearMeOut room.`};
    }
    const matches=store.listPersonas(principal.tenantId,roomId).filter(persona=>[persona.personaId,persona.targetTenantId,persona.displayName].some(value=>value.toLowerCase()===query));
    if(matches.length!==1)throw Error(matches.length?'More than one joined persona matches that name':'That persona is not in the room');
    const present=matches[0]!;
    if(coordinator){const gallery=await coordinator.gallery(),persona=gallery.find(item=>item.personaId===present.personaId);if(persona)await coordinator.control({action:'leave',roomId,persona});}
    store.removePersona(principal.tenantId,roomId,present.personaId);
    return{roomId,text:`${present.displayName} left the HearMeOut room.`};
  }

}

function mediaItem(lane: "music" | "movie", title: string, url: string): HearMeOutMediaItemV1 { return { itemId: createHash("sha256").update(url).digest("hex"), type: lane === "movie" ? "movie" : "music", title: clean(title, 300), source: "voice-url", playbackUrl: url }; }
function httpUrl(value: unknown) { try { const url = new URL(String(value ?? "")); return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.toString() : undefined; } catch { return undefined; } }
function clean(value: unknown, max: number) { const result = String(value ?? "").replace(/[\r\n\0]/g, " ").trim().slice(0, max); if (!result) throw new Error("HearMeOut media value is invalid"); return result; }
function required(value: unknown, name: string) { const result = String(value ?? "").trim(); if (!result || result.length > 500 || /[\r\n\0]/.test(result)) throw new Error(`${name} is required`); return result; }
function percent(value: unknown) { const result = Number(value); if (!Number.isFinite(result) || result < 0 || result > 100) throw new Error("HearMeOut volume must be from 0 to 100"); return result; }
function simulationMediaControl(args: Record<string, string>) {
  const control = args.control === "stop" ? "clear" : required(args.control, "control");
  if (!["play", "pause", "next", "clear", "mute", "unmute", "volume"].includes(control)) throw new Error("Unsupported HearMeOut media control");
  if (control === "volume") percent(args.value);
  return control;
}
function simulationVoiceControl(args: Record<string, string>) {
  const control = required(args.control, "control");
  if (!["start", "stop", "listen-only", "two-way", "profile"].includes(control)) throw new Error("Unsupported HearMeOut voice-bridge control");
  if (control === "start") { required(args.guildId, "guildId"); required(args.voiceChannelId, "voiceChannelId"); }
  if (control === "profile" && !["low-latency", "balanced", "resilient", "clean"].includes(args.audioProfile ?? "")) throw new Error("Unsupported HearMeOut audio profile");
  return control;
}
function wait(ms: number) { return new Promise<void>((done) => setTimeout(done, ms)); }
