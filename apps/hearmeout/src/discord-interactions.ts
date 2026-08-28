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
  resolve(input: { tenantId: string; discordUserId: string; displayName: string }): Promise<{ userId: string; displayName?: string } | undefined> | { userId: string; displayName?: string } | undefined;
}
export interface HearMeOutDiscordInteractionRouterOptionsV1 {
  publicKeyHex: string;
  rooms: SqliteHearMeOutRoomMediaRuntime;
  tenants: HearMeOutDiscordInteractionTenantResolverV1;
  principals: HearMeOutDiscordInteractionPrincipalResolverV1;
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
    const displayName = cleanDisplayName(discordUser.global_name ?? discordUser.username ?? "Discord User");
    const canonical = await this.options.principals.resolve({ tenantId, discordUserId, displayName });
    if (!canonical?.userId) return ephemeral("Link your Discord account to SPMT before using HearMeOut controls.", 403);
    const canManage = discordMemberCanManageHearMeOutWatch(body.member?.permissions);
    const principal: HearMeOutPrincipalV1 = {
      tenantId,
      userId: canonical.userId,
      displayName: cleanDisplayName(canonical.displayName ?? displayName),
      roles: canManage ? ["admin"] : ["member"],
    };
    const interactionId = requiredInteractionId(body.id);
    this.ensureActivityRoom(tenantId);
    this.ensureMember(principal, interactionId);

    if (body.type === HEARMEOUT_DISCORD_INTERACTION_TYPE.MESSAGE_COMPONENT) {
      return this.handleComponent(body, principal, interactionId);
    }
    if (body.type === HEARMEOUT_DISCORD_INTERACTION_TYPE.MODAL_SUBMIT) {
      return this.handleModal(body, principal, interactionId);
    }
    return ephemeral("This HearMeOut Discord interaction is not available yet.", 200);
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
    const customId = String(body.data?.custom_id ?? "");
    if (customId.startsWith("hmo_watch_control:")) {
      const [, requestedAction = "", rawSession = ""] = customId.split(":");
      const sessionId = normalizeHearMeOutWatchSessionAlias(rawSession, HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
      const lane = hearMeOutLaneForWatchSession(sessionId);
      const current = this.options.rooms.getSession(principal.tenantId, HEARMEOUT_ACTIVITY_ROOM_ID, lane);
      const action = resolveToggleAction(requestedAction, current.playback.status, current.playback.muted);
      if (!new Set(["play", "pause", "mute", "unmute", "next", "clear"]).has(action)) return ephemeral("Unsupported watch control.", 200);
      try {
        const session = this.options.rooms.control(principal, {
          roomId: HEARMEOUT_ACTIVITY_ROOM_ID,
          lane,
          action: action as "play" | "pause" | "mute" | "unmute" | "next" | "clear",
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
    if (customId.startsWith("hmo_watch_volume_modal:")) {
      const sessionId = normalizeHearMeOutWatchSessionAlias(customId.split(":")[1], HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
      return { status: 200, body: { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.MODAL, data: buildVolumeModal(sessionId) } };
    }
    if (customId.startsWith("hmo_watch_volume:")) {
      const sessionId = normalizeHearMeOutWatchSessionAlias(customId.split(":")[1], HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
      return { status: 200, body: { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.CHANNEL_MESSAGE_WITH_SOURCE, data: buildVolumeControls(sessionId) } };
    }
    return ephemeral("Unsupported HearMeOut control.", 200);
  }

  private handleModal(body: Record<string, any>, principal: HearMeOutPrincipalV1, interactionId: string): HearMeOutDiscordInteractionResultV1 {
    const customId = String(body.data?.custom_id ?? "");
    if (!customId.startsWith("hmo_watch_volume_submit:")) return ephemeral("Unsupported HearMeOut modal.", 200);
    const sessionId = normalizeHearMeOutWatchSessionAlias(customId.split(":")[1], HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
    const value = readModalValue(body.data, "volume_value");
    const volume = Number(value);
    if (!Number.isSafeInteger(volume) || volume < 0 || volume > 100) return ephemeral("Volume must be from 0 to 100.", 200);
    try {
      const session = this.options.rooms.control(principal, {
        roomId: HEARMEOUT_ACTIVITY_ROOM_ID,
        lane: hearMeOutLaneForWatchSession(sessionId),
        action: "volume",
        position: volume,
        operationId: `discord-interaction:${interactionId}:volume:${volume}`,
      });
      return { status: 200, body: { type: HEARMEOUT_DISCORD_INTERACTION_RESPONSE.UPDATE_MESSAGE, data: buildWatchUpdate(session, sessionId) } };
    } catch (error) {
      return ephemeral(error instanceof Error ? error.message : "Unable to update volume.", 200);
    }
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

function resolveToggleAction(action: string, status: string, muted: boolean): string {
  const value = String(action || "").toLowerCase();
  if (value === "play-pause") return status === "playing" ? "pause" : "play";
  if (value === "mute-unmute") return muted ? "unmute" : "mute";
  return value;
}
function buildWatchUpdate(session: { current: any; playback: { status: string; volume: number; muted: boolean } }, sessionId: string): Record<string, unknown> {
  const lane = sessionId === HEARMEOUT_MUSIC_WATCH_SESSION_ID ? "Music" : "Watch Party";
  const title = session.current?.item?.title ? String(session.current.item.title).slice(0, 200) : "Queue empty";
  return {
    content: `${lane}: ${title} • ${session.playback.status} • volume ${session.playback.volume}${session.playback.muted ? " (muted)" : ""}`,
    components: watchControlComponents(sessionId),
    allowed_mentions: { parse: [] },
  };
}
function buildEphemeralWatchControls(sessionId: string): Record<string, unknown> {
  return { content: "Your watch controls are private to you.", components: watchControlComponents(sessionId), flags: 64 };
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
function buildVolumeControls(sessionId: string): Record<string, unknown> {
  return { content: "Volume controls update the shared HearMeOut session.", flags: 64, components: [{ type: 1, components: [{ type: 2, style: 2, label: "Set volume", custom_id: `hmo_watch_volume_modal:${sessionId}` }] }] };
}
function buildVolumeModal(sessionId: string): Record<string, unknown> {
  return {
    custom_id: `hmo_watch_volume_submit:${sessionId}`,
    title: "Set HearMeOut Volume",
    components: [{ type: 1, components: [{ type: 4, custom_id: "volume_value", label: "Volume 0-100", style: 1, required: true, min_length: 1, max_length: 3, placeholder: "85" }] }],
  };
}
function watchControlComponents(sessionId: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Play/Pause", custom_id: `hmo_watch_control:play-pause:${sessionId}` },
    { type: 2, style: 2, label: "Mute", custom_id: `hmo_watch_control:mute-unmute:${sessionId}` },
    { type: 2, style: 2, label: "Next", custom_id: `hmo_watch_control:next:${sessionId}` },
    { type: 2, style: 2, label: "Volume", custom_id: `hmo_watch_volume:${sessionId}` },
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
