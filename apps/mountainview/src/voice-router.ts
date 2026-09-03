import { SPMT_SUITE_ACTION_CATALOG, assertDeviceRelayCommandV1, type DeviceRelayCommandV1 } from "@spmt/contracts";
import { detectSpmtSuiteActionCommand } from "@spmt/sdk";

export interface MountainViewVoiceContextV1 {
  schemaVersion: 1;
  tenantId: string;
  userId: string;
  username?: string;
  role?: "member" | "moderator" | "admin" | "owner";
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

  const suiteAction = detectSpmtSuiteActionCommand(text);
  if (suiteAction) {
    const descriptor = SPMT_SUITE_ACTION_CATALOG.find((item) => item.id === suiteAction.action)!;
    const targetAppId = suiteAction.action.startsWith("dsh.") ? "discord-stream-hub" : suiteAction.action.startsWith("hmo.") ? "hearmeout" : "streamweaver";
    return { kind: "route", targetAppId, action: suiteAction.action, payload: { ...suiteAction.args, ...(targetAppId === "hearmeout" && context.hearMeOutRoomId && !suiteAction.args.roomId ? { roomId: context.hearMeOutRoomId } : {}) }, risk: descriptor.risk === "read" ? "low" : descriptor.risk === "write" ? "medium" : "high", requiresConfirmation: false, reason: "This command uses the shared SPMT suite-action pipeline" };
  }

  const image = text.match(/\b(?:generate|make|create|draw)\s+(?:me\s+)?(?:an?\s+)?(?:ai\s+)?(?:image|picture|photo|artwork|illustration)\s*(?:of|showing|for)?\s+(.+?)\s*$/i);
  if (image?.[1]?.trim()) return { kind: "route", targetAppId: "streamweaver", action: "sw.image.generate", payload: { prompt: image[1].trim() }, risk: "medium", requiresConfirmation: false, reason: "Image generation belongs to StreamWeaver's provider-backed media worker" };

  const obsScene = text.match(/(?:switch|set|change)(?:\s+the)?\s+obs(?:\s+scene)?\s+(?:to\s+)?(.+)$/i);
  if (obsScene) {
    const sceneName = obsScene[1]!.trim();
    if (!context.targetCompanionDeviceId) return { kind: "clarify", reason: "Pair a Companion device before controlling OBS" };
    return { kind: "route", targetAppId: "companion", action: "obs.scene.set", payload: { sceneName, targetDeviceId: context.targetCompanionDeviceId }, risk: "low", requiresConfirmation: false, reason: "OBS controls run only on the paired local Companion" };
  }

  const volume = text.match(/(?:set|turn)(?:\s+the)?\s+(?:pc\s+)?companion(?:\s+(?:audio|volume))?\s+(?:to\s+)?(\d{1,3})(?:\s*percent|\s*%)?/i);
  if (volume) {
    if (!context.targetCompanionDeviceId) return { kind: "clarify", reason: "Pair a Companion device before controlling local audio" };
    const percent = Number(volume[1]);
    if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) return { kind: "clarify", reason: "Companion volume must be from 0 through 100 percent" };
    return { kind: "route", targetAppId: "companion", action: "media.volume.set", payload: { volume: percent / 100, targetDeviceId: context.targetCompanionDeviceId }, risk: "low", requiresConfirmation: false, reason: "Local Companion audio is controlled on the paired device" };
  }

  if (/\bunmute\b.*\b(?:pc\s+)?companion\b|\b(?:pc\s+)?companion\b.*\bunmute\b/i.test(text)) {
    if (!context.targetCompanionDeviceId) return { kind: "clarify", reason: "Pair a Companion device before controlling local audio" };
    return { kind: "route", targetAppId: "companion", action: "media.mute.set", payload: { muted: false, targetDeviceId: context.targetCompanionDeviceId }, risk: "low", requiresConfirmation: false, reason: "Local Companion audio is controlled on the paired device" };
  }
  if (/\bmute\b.*\b(?:pc\s+)?companion\b|\b(?:pc\s+)?companion\b.*\bmute\b/i.test(text)) {
    if (!context.targetCompanionDeviceId) return { kind: "clarify", reason: "Pair a Companion device before controlling local audio" };
    return { kind: "route", targetAppId: "companion", action: "media.mute.set", payload: { muted: true, targetDeviceId: context.targetCompanionDeviceId }, risk: "low", requiresConfirmation: false, reason: "Local Companion audio is controlled on the paired device" };
  }

  const song = text.match(/^(?:please\s+)?(?:play|request|queue)(?:\s+the)?\s+(?:song\s+)?(.+)$/i);
  if (song && !/\b(movie|show|episode|video|watch)\b/i.test(song[1]!)) {
    return { kind: "route", targetAppId: "hearmeout", action: "media.music.request", payload: { query: song[1]!.trim(), ...(context.hearMeOutRoomId ? { roomId: context.hearMeOutRoomId } : {}) }, risk: "low", requiresConfirmation: false, reason: "Music requests belong to HearMeOut's canonical room queue" };
  }

  const musicControl = lower.match(/^(?:please\s+)?(?:music\s+)?(pause|resume|play|skip|next|stop)(?:\s+(?:the\s+)?music)?$/i);
  if (musicControl) {
    const raw = musicControl[1]!;
    const action = raw === "resume" || raw === "play" ? "play" : raw === "skip" ? "next" : raw;
    return { kind: "route", targetAppId: "hearmeout", action: `media.music.${action}`, payload: { ...(context.hearMeOutRoomId ? { roomId: context.hearMeOutRoomId } : {}) }, risk: "low", requiresConfirmation: false, reason: "Music playback controls belong to HearMeOut" };
  }

  const watchRequest = text.match(/^(?:please\s+)?(?:watch|play)(?:\s+the)?\s+(?:movie|show|episode|video)\s+(.+)$/i);
  if (watchRequest) {
    return { kind: "route", targetAppId: "hearmeout", action: "media.movie.request", payload: { query: watchRequest[1]!.trim(), ...(context.hearMeOutRoomId ? { roomId: context.hearMeOutRoomId } : {}) }, risk: "low", requiresConfirmation: false, reason: "Watch requests belong to HearMeOut's canonical movie lane" };
  }

  if (/\b(?:who(?:'s| is)?|everyone)\s+live\b|\blive\s+members\b|\b(?:who(?:'s| is)?)\s+active\s+in\s+(?:nebula arcade|(?:the\s+)?tag game)\b/.test(lower)) {
    if (/\b(?:nebula arcade|tag game)\b/.test(lower)) return { kind: "route", targetAppId: "nebula-arcade", action: "nebula-arcade.tag.live-members.read", payload: {}, risk: "low", requiresConfirmation: false, reason: "The request explicitly scopes active users to Nebula Arcade's tag game" };
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
