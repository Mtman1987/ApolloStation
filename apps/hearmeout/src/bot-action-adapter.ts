import type { HearMeOutControlActionV1, HearMeOutMediaItemV1, HearMeOutPrincipalV1, SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";
import type { SqliteHearMeOutPersonaRoomController, HearMeOutServicePersonaV1 } from "./persona-room.js";
import type { HearMeOutVoiceBridgeController } from "./voice-bridge.js";

export const HEARMEOUT_BOT_ACTIONS = ["hmo.rooms.read", "hmo.media.state.read", "hmo.media.request", "hmo.media.control", "hmo.bot.control", "hmo.voice.bridge.state", "hmo.voice.bridge.control"] as const;
export type HearMeOutBotActionIdV1 = typeof HEARMEOUT_BOT_ACTIONS[number];
export interface HearMeOutBotMediaResolverV1 { resolve(input: { tenantId: string; roomId: string; query: string }): Promise<HearMeOutMediaItemV1>; }

export class HearMeOutBotActionAdapter {
  constructor(private readonly rooms: SqliteHearMeOutRoomMediaRuntime, private readonly media: HearMeOutBotMediaResolverV1, private readonly personas?: SqliteHearMeOutPersonaRoomController, private readonly voice?: HearMeOutVoiceBridgeController) {}
  async execute(action: HearMeOutBotActionIdV1, principal: HearMeOutPrincipalV1, args: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    if (action === "hmo.rooms.read") return { success: true, rooms: this.rooms.listRooms(principal).map((room) => ({ roomId: room.roomId, name: room.name, privacy: room.privacy, owned: room.ownerUserId === principal.userId })) };
    const roomId = required(args.roomId, "roomId", "A HearMeOut room is required; the action was not sent to a global queue");
    if (action === "hmo.media.state.read") return { success: true, movie: this.rooms.getSession(principal.tenantId, roomId, "movie"), music: this.rooms.getSession(principal.tenantId, roomId, "music") };
    if (action === "hmo.media.request") {
      const query = required(args.query, "query", "A media title is required");
      const item = await this.media.resolve({ tenantId: principal.tenantId, roomId, query });
      const lane = item.type === "movie" || item.type === "live" ? "movie" : "music";
      return { success: true, session: this.rooms.enqueue(principal, { roomId, lane, item, operationId: idempotencyKey }) };
    }
    if (action === "hmo.media.control") {
      const control = String(args.control ?? "") as HearMeOutControlActionV1;
      if (!["play", "pause", "next", "clear", "mute", "unmute", "volume"].includes(control)) throw new Error("Unsupported media control");
      const lane = args.lane === "movie" ? "movie" : "music";
      return { success: true, session: this.rooms.control(principal, { roomId, lane, action: control, operationId: idempotencyKey, ...(control === "volume" ? { position: boundedPercent(args.value) } : {}) }) };
    }
    if (action === "hmo.bot.control") {
      if (!this.personas) throw new Error("HearMeOut persona-room adapter is unavailable");
      const persona = args.persona as HearMeOutServicePersonaV1 | undefined;
      if (!persona) throw new Error("A tenant bot persona is required");
      const control = args.control === "leave" ? "leave" : "join";
      return this.personas.control(principal, { roomId, action: control, persona });
    }
    if (!this.voice) throw new Error("HearMeOut voice-bridge adapter is unavailable");
    if (action === "hmo.voice.bridge.state") return this.voice.status(principal, roomId);
    const control = String(args.control ?? "");
    if (control === "start") return this.voice.start(principal, { roomId, guildId: required(args.guildId, "guildId"), voiceChannelId: required(args.voiceChannelId, "voiceChannelId") });
    if (control === "stop") return this.voice.stop(principal, roomId);
    if (control === "listen-only" || control === "two-way") return this.voice.setRoomOutbound(principal, roomId, control === "two-way");
    if (control === "profile") return this.voice.setAudioProfile(principal, roomId, String(args.audioProfile ?? "") as never);
    throw new Error("Unsupported voice bridge control");
  }
}

function required(value: unknown, name: string, message = `${name} is required`): string { const clean = String(value ?? "").trim(); if (!clean || clean.length > 500 || /[\r\n\0]/.test(clean)) throw new Error(message); return clean; }
function boundedPercent(value: unknown): number { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error("HearMeOut volume must be from 0 to 100"); return number; }
