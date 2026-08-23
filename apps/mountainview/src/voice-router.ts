import { assertDeviceRelayCommandV1, type DeviceRelayCommandV1 } from "@spmt/contracts";

export interface MountainViewVoiceContextV1 {
  schemaVersion: 1;
  tenantId: string;
  userId: string;
  targetCompanionDeviceId?: string;
  hearMeOutRoomId?: string;
}

export type MountainViewVoicePlanV1 =
  | { kind: "clarify"; reason: string }
  | { kind: "route"; targetAppId: "companion" | "hearmeout" | "discord-stream-hub" | "nebula-arcade" | "streamweaver"; action: string; payload: Record<string, unknown>; risk: "low" | "medium" | "high"; requiresConfirmation: boolean; reason: string };

export function planMountainViewVoiceCommand(transcript: string, context: MountainViewVoiceContextV1): MountainViewVoicePlanV1 {
  assertContext(context);
  const text = transcript.trim();
  if (!text || text.length > 2_000) return { kind: "clarify", reason: "A voice command is required" };
  const lower = text.toLowerCase();

  const obsScene = text.match(/(?:switch|set|change)(?:\s+the)?\s+obs(?:\s+scene)?\s+(?:to\s+)?(.+)$/i);
  if (obsScene) {
    const sceneName = obsScene[1]!.trim();
    if (!context.targetCompanionDeviceId) return { kind: "clarify", reason: "Pair a Companion device before controlling OBS" };
    return { kind: "route", targetAppId: "companion", action: "obs.scene.set", payload: { sceneName, targetDeviceId: context.targetCompanionDeviceId }, risk: "low", requiresConfirmation: false, reason: "OBS controls run only on the paired local Companion" };
  }

  const song = text.match(/^(?:please\s+)?(?:play|request|queue)(?:\s+the)?\s+(?:song\s+)?(.+)$/i);
  if (song && !/\b(movie|show|episode|video|watch)\b/i.test(song[1]!)) {
    return { kind: "route", targetAppId: "hearmeout", action: "media.music.request", payload: { query: song[1]!.trim(), ...(context.hearMeOutRoomId ? { roomId: context.hearMeOutRoomId } : {}) }, risk: "low", requiresConfirmation: false, reason: "Music requests belong to HearMeOut's canonical room queue" };
  }

  if (/\b(?:who(?:'s| is)?|everyone)\s+live\b|\blive\s+members\b|\b(?:who(?:'s| is)?)\s+active\s+in\s+chat[ -]?tag\b/.test(lower)) {
    if (/\b(chat[ -]?tag|spmt)\b/.test(lower)) return { kind: "route", targetAppId: "nebula-arcade", action: "chat-tag.live-members.read", payload: {}, risk: "low", requiresConfirmation: false, reason: "The request explicitly scopes active users to Chat Tag" };
    return { kind: "route", targetAppId: "discord-stream-hub", action: "community.live-members.read", payload: {}, risk: "low", requiresConfirmation: false, reason: "Unscoped live status belongs to the community-wide DSH projection" };
  }

  if (/\b(?:shout[ -]?out|brb|be right back|stream marker|clip that)\b/.test(lower)) {
    return { kind: "route", targetAppId: "streamweaver", action: "voice-commander.route", payload: { transcript: text }, risk: "medium", requiresConfirmation: false, reason: "StreamWeaver owns built-in stream actions" };
  }

  return { kind: "clarify", reason: "No safe registered app action matched this command" };
}

export function createCompanionDeviceCommand(input: { plan: MountainViewVoicePlanV1; context: MountainViewVoiceContextV1; commandId: string; idempotencyKey: string; requestedAt: string; confirmed?: boolean }): DeviceRelayCommandV1 {
  const { plan, context } = input;
  if (plan.kind !== "route" || plan.targetAppId !== "companion") throw new Error("MountainView plan does not target Companion");
  const targetDeviceId = String(plan.payload.targetDeviceId || "");
  const { targetDeviceId: _targetDeviceId, ...payload } = plan.payload;
  const capability = plan.action.startsWith("obs.scene.") ? "obs.scene" : plan.action.startsWith("obs.stream.") ? "obs.stream" : plan.action.startsWith("overlay.window.") ? "overlay.window" : plan.action.startsWith("media.") ? "media.playback" : "local.transcode";
  return assertDeviceRelayCommandV1({ schemaVersion: 1, tenantId: context.tenantId, commandId: input.commandId, idempotencyKey: input.idempotencyKey, sourceAppId: "mountainview", targetDeviceId, capability, action: plan.action, payload, requestedByUserId: context.userId, requestedAt: input.requestedAt, requiresConfirmation: plan.requiresConfirmation, confirmed: plan.requiresConfirmation ? Boolean(input.confirmed) : true });
}

function assertContext(context: MountainViewVoiceContextV1): void {
  if (context.schemaVersion !== 1 || !context.tenantId || !context.userId || context.tenantId.trim() !== context.tenantId || context.userId.trim() !== context.userId) throw new Error("MountainView voice context is invalid");
}
