import {HEARMEOUT_SINGLE_PROGRAM_ID,type HearMeOutBroadcastProgram} from "./broadcast-program.js";
import { createPublicKey, verify } from "node:crypto";
import type { HearMeOutPrincipalV1, SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";
import {
  HEARMEOUT_ACTIVITY_ROOM_ID,
  HEARMEOUT_ACTIVITY_ROOM_NAME,
  HEARMEOUT_GLOBAL_WATCH_SESSION_ID,
  HEARMEOUT_MUSIC_WATCH_SESSION_ID,
  hearMeOutLaneForWatchSession,
  normalizeHearMeOutWatchSessionAlias,
} from "./activity-contract.js";
import { ensureHearMeOutDiscordActivityRoom, joinHearMeOutDiscordActivityRoom } from "./activity-room.js";

export const HEARMEOUT_DISCORD_INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;
export const HEARMEOUT_DISCORD_INTERACTION_RESPONSE = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const;

export interface HearMeOutDiscordInteractionTenantResolverV1 {
  resolve(input: { guildId?: string; channelId?: string; applicationId?: string }): Promise<string | undefined> | string | undefined;
}
export interface HearMeOutDiscordInteractionPrincipalResolverV1 {
  resolve(input: { tenantId: string; discordUserId: string; displayName: string }): Promise<{ userId: string; displayName?: string; tenantRole?: "owner" | "member" | null } | undefined> | { userId: string; displayName?: string; tenantRole?: "owner" | "member" | null } | undefined;
}
export interface HearMeOutDiscordInteractionRouterOptionsV1 {
  publicKeyHex: string;
  singleProgram?: HearMeOutBroadcastProgram;
  rooms: SqliteHearMeOutRoomMediaRuntime;
  tenants: HearMeOutDiscordInteractionTenantResolverV1;
  principals: HearMeOutDiscordInteractionPrincipalResolverV1;
  requestMedia?: (input: { principal: HearMeOutPrincipalV1; interactionId: string; roomId: string; query: string; lane: "music" | "movie"; guildId: string; channelId: string }) => Promise<{ jobId: string }>;
  readOnly?: boolean;
}
export interface HearMeOutDiscordInteractionResultV1 { status: number; body: Record<string, unknown>; }

export class HearMeOutDiscordInteractionRouter {
  private readonly publicKeyHex: string;
  constructor(private readonly options: HearMeOutDiscordInteractionRouterOptionsV1) {
    this.publicKeyHex = normalizePublicKey(options.publicKeyHex);
  }

  async handle(input: { rawBody: string; signature: string; timestamp: string }): Promise<HearMeOutDiscordInteractionResultV1> {
    if (!verifyHearMeOutDiscordInteraction(input.rawBody, input.signature, input.timestamp, this.publicKeyHex)) {
      return { status: 401, body: { error: "Invalid signature" } };
    }
    let body: Record<string, any>;
    try { body = JSON.parse(input.rawBody) as Record<string, any>; }
    catch { return { status: 400, body: { error: "Invalid JSON" } }; }
    if (body.type === HEARMEOUT_DISCORD_INTERACTION_TYPE.PING) {
      return { status: 200, body: { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.PONG } };
    }

    const guildId = optionalSnowflake(body.guild_id);
    const channelId = optionalSnowflake(body.channel_id);
    const applicationId = optionalSnowflake(body.application_id);
    const tenantId = await this.options.tenants.resolve({ ...(guildId ? { guildId } : {}), ...(channelId ? { channelId } : {}), ...(applicationId ? { applicationId } : {}) });
    if (!tenantId) return ephemeral("HearMeOut is not connected to this Discord space.", 404);
    const discordUser = body.member?.user ?? body.user ?? {};
    const discordUserId = optionalSnowflake(discordUser.id);
    if (!discordUserId) return ephemeral("Unable to identify your Discord user.", 401);
    // Opening a form is local UI and must not wait for a remote identity call.
    // The signed submission still resolves the canonical actor and room access.
    const customId = String(body.data?.custom_id ?? "");
    if (body.type === HEARMEOUT_DISCORD_INTERACTION_TYPE.MESSAGE_COMPONENT) {
      if (customId.startsWith("hmo_watch_volume")) return localVolumeHelp();
      if (customId.startsWith("request_song:") || customId === "request_song_modal_trigger") return { status: 200, body: { type: 9, data: buildRequestModal(customId.startsWith("request_song:") ? customId.slice(13) : HEARMEOUT_ACTIVITY_ROOM_ID) } };
    }
    const displayName = cleanDisplayName(discordUser.global_name ?? discordUser.username ?? "Discord User");
    const program=this.options.singleProgram;
    if(program){
      const interactionId=requiredInteractionId(body.id),name=String(body.data?.name??'').toLowerCase();
      if(this.options.readOnly)return ephemeral('Broadcast requests are unavailable in this preview.',200);
      const query=body.type===5&&customId.startsWith('request_song_modal')?readModalValue(body.data,'song_request_input'):['wr','watchrequest','sr','songrequest'].includes(name)?String((body.data?.options??[]).find((option:any)=>['query','song','movie','request'].includes(option.name))?.value??''):undefined;
      if(query!==undefined){
        // Discord already authenticated this viewer in the signed interaction.
        // Requesting media needs no Apollo account, room, or membership.
        const principal:HearMeOutPrincipalV1={tenantId,userId:'discord:'+discordUserId,displayName,roles:['member']};
        try{if(!this.options.requestMedia)throw Error('Media requests are unavailable');await this.options.requestMedia({principal,interactionId,roomId:HEARMEOUT_SINGLE_PROGRAM_ID,query,lane:'movie',guildId:guildId??'',channelId:channelId??''});return ephemeral('Your video is in the shared broadcast.',200);}catch(error){return ephemeral((error as Error).message,200);}
      }
      if(['np','nowplaying'].includes(name))return ephemeral(program.getSession().current?.item.title??'Nothing is playing.',200);
      if(customId.startsWith('hmo_watch_control:')||customId==='music_play_pause_btn'||customId==='music_skip_btn'){
        const canonical=await this.options.principals.resolve({tenantId,discordUserId,displayName});
        if(!canonical)return ephemeral('Only the broadcast host can change playback. You can still request a video.',200);
        const requested=customId==='music_skip_btn'?'next':customId==='music_play_pause_btn'?'play-pause':customId.split(':')[1]??'';
        if(['mute','unmute','mute-unmute','volume'].includes(requested))return localVolumeHelp();
        try{const session=program.control({tenantId,userId:canonical.userId,displayName:canonical.displayName??displayName,roles:canonical.tenantRole==='owner'?['admin']:['member']},{action:resolveToggleAction(requested,program.getSession().playback.status)});return{status:200,body:{type:7,data:buildWatchUpdate(session,HEARMEOUT_SINGLE_PROGRAM_ID)}};}catch(error){return ephemeral((error as Error).message,200);}
      }
      return ephemeral('Open the Activity to watch the shared broadcast or request a video.',200);
    }
    const canonical = await this.options.principals.resolve({ tenantId, discordUserId, displayName });
    if (!canonical?.userId) return ephemeral("Link your Discord account to SPMT before using HearMeOut controls.", 403);
    const canManage = canonical.tenantRole === "owner" || discordMemberCanManageHearMeOutWatch(body.member?.permissions);
    const principal: HearMeOutPrincipalV1 = {
      tenantId,
      userId: canonical.userId,
      displayName: cleanDisplayName(canonical.displayName ?? displayName),
      roles: canManage ? ["admin"] : ["member"],
    };
    const interactionId = requiredInteractionId(body.id);
    if (this.options.readOnly) return ephemeral("HearMeOut Discord controls are in read-only mode.", 200);
    this.ensureActivityRoom(tenantId);
    this.ensureMember(principal, interactionId);

    if (body.type === HEARMEOUT_DISCORD_INTERACTION_TYPE.APPLICATION_COMMAND) {
      const name = String(body.data?.name ?? "").toLowerCase();
      const value = (body.data?.options ?? []).find((option: any) => ["query", "song", "movie", "request"].includes(option.name))?.value;
      if (["wr", "watchrequest", "sr", "songrequest"].includes(name)) return this.request(body, principal, interactionId, HEARMEOUT_ACTIVITY_ROOM_ID, String(value ?? ""), name === "wr" || name === "watchrequest" ? "movie" : "music");
      if (["np", "nowplaying"].includes(name)) return { status: 200, body: { type: 4, data: { ...buildWatchUpdate(this.options.rooms.getSession(principal.tenantId, HEARMEOUT_ACTIVITY_ROOM_ID, "music"), HEARMEOUT_MUSIC_WATCH_SESSION_ID), flags: 64 } } };
    }
    if (body.type === HEARMEOUT_DISCORD_INTERACTION_TYPE.MESSAGE_COMPONENT) {
      return this.handleComponent(body, principal, interactionId);
    }
    if (body.type === HEARMEOUT_DISCORD_INTERACTION_TYPE.MODAL_SUBMIT) {
      return this.handleModal(body, principal, interactionId);
    }
    return ephemeral("This HearMeOut Discord interaction is not available yet.", 200);
  }

  private requestRoom(principal: HearMeOutPrincipalV1, requested: string): string {
    const roomId = !requested || [HEARMEOUT_GLOBAL_WATCH_SESSION_ID, HEARMEOUT_MUSIC_WATCH_SESSION_ID].includes(requested) ? HEARMEOUT_ACTIVITY_ROOM_ID : requested;
    if (!this.options.rooms.getRoom(principal.tenantId, roomId)) throw new Error("That room no longer exists. Open the current HearMeOut room controls.");
    if (!this.options.rooms.listMembers(principal.tenantId, roomId).some(member => member.userId === principal.userId)) throw new Error("Join this HearMeOut room before requesting its media or voice queue.");
    return roomId;
  }

  private async request(body: Record<string, any>, principal: HearMeOutPrincipalV1, interactionId: string, requestedRoom: string, query: string, lane: "music" | "movie"): Promise<HearMeOutDiscordInteractionResultV1> {
    if (!query.trim() || query.length > 500) return ephemeral("Enter a song or movie title, or a media link, up to 500 characters.", 200);
    if (!this.options.requestMedia) return ephemeral("Media requests are unavailable on this deployment.", 200);
    try {
      const result = await this.options.requestMedia({ principal, interactionId, roomId: this.requestRoom(principal, requestedRoom), query: query.trim(), lane, guildId: String(body.guild_id ?? ""), channelId: String(body.channel_id ?? "") });
      return ephemeral(`Your ${lane === "movie" ? "watch" : "song"} request was queued. Track it in Apollo activity (${result.jobId}).`, 200);
    } catch (error) { return ephemeral(error instanceof Error ? error.message : "Unable to queue this media request.", 200); }
  }

  private ensureActivityRoom(tenantId: string): void {
    ensureHearMeOutDiscordActivityRoom(this.options.rooms, {
      tenantId,
      userId: HEARMEOUT_ACTIVITY_ROOM_ID,
      displayName: HEARMEOUT_ACTIVITY_ROOM_NAME,
      roles: ["admin"],
    });
  }

  private ensureMember(principal: HearMeOutPrincipalV1, interactionId: string): void {
    const members = this.options.rooms.listMembers(principal.tenantId, HEARMEOUT_ACTIVITY_ROOM_ID);
    if (members.some((entry) => entry.userId === principal.userId)) return;
    joinHearMeOutDiscordActivityRoom(this.options.rooms, principal, `discord-activity-join:${interactionId}:${principal.userId}`);
  }

  private handleComponent(body: Record<string, any>, principal: HearMeOutPrincipalV1, interactionId: string): HearMeOutDiscordInteractionResultV1 {
    let customId = String(body.data?.custom_id ?? "");
    if (customId === "music_play_pause_btn") customId = `hmo_watch_control:play-pause:${HEARMEOUT_MUSIC_WATCH_SESSION_ID}`;
    if (customId === "music_skip_btn") customId = `hmo_watch_control:next:${HEARMEOUT_MUSIC_WATCH_SESSION_ID}`;
    if (customId.startsWith("room_close:")) return { status: 200, body: { type: 7, data: { content: "Room controls closed.", components: [], embeds: [] } } };
    if (customId.startsWith("join_queue:")) {
      try { this.options.rooms.requestVoiceTurn(principal, this.requestRoom(principal, customId.slice(11))); return ephemeral("You are in the voice queue. Your invitation will appear in Apollo when the host admits you.", 200); }
      catch (error) { return ephemeral(error instanceof Error ? error.message : "Unable to join the voice queue.", 200); }
    }
    if (customId.startsWith("mute_toggle:")) return ephemeral("Use Enable sound / Mute locally in the Activity player to control sound on your device.", 200);
    if (customId.startsWith("room_settings:")) {
      try {
        const roomId = this.requestRoom(principal, customId.slice(14));
        return { status: 200, body: { type: 4, data: { content: "HearMeOut room controls", flags: 64, components: [{ type: 1, components: [{ type: 2, style: 1, label: "Request Song", custom_id: `request_song:${roomId}` }, { type: 2, style: 2, label: "Join Voice Queue", custom_id: `join_queue:${roomId}` }, { type: 2, style: 2, label: "Music Controls", custom_id: `hmo_watch_controls:${HEARMEOUT_MUSIC_WATCH_SESSION_ID}` }] }] } } };
      } catch (error) { return ephemeral(error instanceof Error ? error.message : "Room unavailable.", 200); }
    }
    if (customId.startsWith("hmo_watch_control:")) {
      const [, requestedAction = "", rawSession = ""] = customId.split(":");
      const sessionId = normalizeHearMeOutWatchSessionAlias(rawSession, HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
      const lane = hearMeOutLaneForWatchSession(sessionId);
      const current = this.options.rooms.getSession(principal.tenantId, HEARMEOUT_ACTIVITY_ROOM_ID, lane);
      if (["mute", "unmute", "mute-unmute", "volume"].includes(requestedAction)) return localVolumeHelp();
      const action = resolveToggleAction(requestedAction, current.playback.status);
      if (!new Set(["play", "pause", "next", "clear"]).has(action)) return ephemeral("Unsupported watch control.", 200);
      try {
        const session = this.options.rooms.control(principal, {
          roomId: HEARMEOUT_ACTIVITY_ROOM_ID,
          lane,
          action: action as "play" | "pause" | "next" | "clear",
          operationId: `discord-interaction:${interactionId}:${action}`,
        });
        return { status: 200, body: { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.UPDATE_MESSAGE, data: buildWatchUpdate(session, sessionId) } };
      } catch (error) {
        return ephemeral(error instanceof Error ? error.message : "Unable to update watch controls.", 200);
      }
    }
    if (customId.startsWith("hmo_watch_controls:")) {
      const sessionId = normalizeHearMeOutWatchSessionAlias(customId.split(":")[1], HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
      return { status: 200, body: { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE, data: buildEphemeralWatchControls(sessionId) } };
    }
    if (customId.startsWith("hmo_watch_lane:")) {
      return { status: 200, body: { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE, data: buildLanePicker() } };
    }
    if (customId.startsWith("hmo_watch_volume:")) return localVolumeHelp();
    return ephemeral("Unsupported HearMeOut control.", 200);
  }

  private async handleModal(body: Record<string, any>, principal: HearMeOutPrincipalV1, interactionId: string): Promise<HearMeOutDiscordInteractionResultV1> {
    const customId = String(body.data?.custom_id ?? "");
    if (customId.startsWith("request_song_modal:") || customId === "request_song_modal_submit") return this.request(body, principal, interactionId, customId.startsWith("request_song_modal:") ? customId.slice(19) : HEARMEOUT_ACTIVITY_ROOM_ID, readModalValue(body.data, "song_request_input"), "music");
    if (!customId.startsWith("hmo_watch_volume_submit:")) return ephemeral("Unsupported HearMeOut modal.", 200);
    return localVolumeHelp();
  }
}

export function verifyHearMeOutDiscordInteraction(rawBody: string, signatureHex: string, timestamp: string, publicKeyHex: string): boolean {
  try {
    const publicKey = Buffer.from(normalizePublicKey(publicKeyHex), "hex");
    const signature = Buffer.from(String(signatureHex || ""), "hex");
    if (signature.byteLength !== 64 || !timestamp || /[\r\n]/.test(timestamp)) return false;
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + rawBody, "utf8"), key, signature);
  } catch { return false; }
}

export function discordMemberCanManageHearMeOutWatch(permissions: unknown): boolean {
  try {
    const value = BigInt(String(permissions || "0") || "0");
    const ADMINISTRATOR = BigInt(0x8);
    const MANAGE_MESSAGES = BigInt(0x2000);
    const MANAGE_GUILD = BigInt(0x20);
    return Boolean(value & ADMINISTRATOR || value & MANAGE_MESSAGES || value & MANAGE_GUILD);
  } catch { return false; }
}

function resolveToggleAction(action: string, status: string): string {
  const value = String(action || "").toLowerCase();
  if (value === "play-pause") return status === "playing" ? "pause" : "play";
  return value;
}
function buildWatchUpdate(session: { current: any; playback: { status: string; volume: number; muted: boolean } }, sessionId: string): Record<string, unknown> {
  const lane = sessionId === HEARMEOUT_MUSIC_WATCH_SESSION_ID ? "Music" : "Watch Party";
  const title = session.current?.item?.title ? String(session.current.item.title).slice(0, 200) : "Queue empty";
  return {
    content: `${lane}: ${title} • ${session.playback.status}`,
    components: watchControlComponents(sessionId),
    allowed_mentions: { parse: [] },
  };
}
function buildEphemeralWatchControls(sessionId: string): Record<string, unknown> {
  return { content: "Room playback controls. Adjust your own volume in the Activity player.", components: watchControlComponents(sessionId), flags: 64 };
}
function buildLanePicker(): Record<string, unknown> {
  return {
    content: "Choose which HearMeOut lane to control.", flags: 64,
    components: [{ type: 1, components: [
      { type: 2, style: 1, label: "Watch", custom_id: `hmo_watch_controls:${HEARMEOUT_GLOBAL_WATCH_SESSION_ID}` },
      { type: 2, style: 2, label: "Music", custom_id: `hmo_watch_controls:${HEARMEOUT_MUSIC_WATCH_SESSION_ID}` },
    ] }],
  };
}
function localVolumeHelp(): HearMeOutDiscordInteractionResultV1 { return ephemeral("Volume affects only you. Use the volume slider in the Activity player; Mute locally sets it to 0 without pausing the video.", 200); }
function watchControlComponents(sessionId: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Play/Pause", custom_id: `hmo_watch_control:play-pause:${sessionId}` },
    { type: 2, style: 2, label: "Next", custom_id: `hmo_watch_control:next:${sessionId}` },
  ] }];
}
function readModalValue(data: any, customId: string): string {
  for (const row of data?.components ?? []) for (const component of row?.components ?? []) if (component?.custom_id === customId) return String(component.value ?? "");
  return "";
}
function ephemeral(message: string, status: number): HearMeOutDiscordInteractionResultV1 {
  return { status, body: { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: String(message).slice(0, 1000), flags: 64, allowed_mentions: { parse: [] } } } };
}
function normalizePublicKey(value: string): string {
  const clean = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("Discord public key must be 32-byte hex");
  return clean;
}
function optionalSnowflake(value: unknown): string | undefined { const clean = String(value ?? "").trim(); return /^\d{5,30}$/.test(clean) ? clean : undefined; }
function requiredInteractionId(value: unknown): string { const clean = optionalSnowflake(value); if (!clean) throw new Error("Discord interaction id is invalid"); return clean; }
function cleanDisplayName(value: unknown): string { const clean = String(value ?? "Discord User").trim().replace(/[\r\n\0]+/g, " ").slice(0, 120); return clean || "Discord User"; }

function buildRequestModal(roomId: string): Record<string, unknown> {
  return { custom_id: `request_song_modal:${roomId}`.slice(0, 100), title: "Request a Song", components: [{ type: 1, components: [{ type: 4, custom_id: "song_request_input", label: "Song name or media link", style: 1, required: true, min_length: 1, max_length: 500 }] }] };
}
