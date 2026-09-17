import type { DshLoungeFeatureV1, DshLoungeModeV1, DshLoungeStateV1 } from "./lounge-state.js";

/** Small informational cards rotate. Games never do: Nebula owns game availability and active state. */
export type DshLoungeProgramKindV1 = "community-board" | "live-creators" | "raid-pile" | "events" | "partners" | "message-board" | "stella-chat";
export interface DshLoungeProgramSlotV1 { id: string; kind: DshLoungeProgramKindV1; title: string; durationSeconds: number; enabled: boolean; }

export const DSH_LOUNGE_DEFAULT_ROTATION: readonly DshLoungeProgramSlotV1[] = Object.freeze([
  { id: "community-board", kind: "community-board", title: "SpaceMountain Community Board", durationSeconds: 60, enabled: true },
  { id: "live-creators", kind: "live-creators", title: "Community Live Now", durationSeconds: 75, enabled: true },
  { id: "raid-pile", kind: "raid-pile", title: "Raid Pile Status", durationSeconds: 45, enabled: true },
  { id: "events", kind: "events", title: "Upcoming Community Events", durationSeconds: 60, enabled: true },
  { id: "partners", kind: "partners", title: "Community Partners", durationSeconds: 45, enabled: true },
  { id: "message-board", kind: "message-board", title: "Community Message Board", durationSeconds: 60, enabled: true },
  { id: "stella-chat", kind: "stella-chat", title: "Ask Stella", durationSeconds: 45, enabled: true },
]);

export type DshLoungeBackgroundKindV1 = "community-vod" | "community-highlights" | "event-replay" | "partner-media";
export interface DshLoungeBackgroundItemV1 {
  id: string;
  kind: DshLoungeBackgroundKindV1;
  title: string;
  mediaUrl: string;
  creator?: string;
  sourceUrl?: string;
  /** Normal playback level before Stella/TTS/game side-chain ducking. */
  volume: number;
}

export const DSH_LOUNGE_BACKGROUND_VOLUME = 0.58;
export const DSH_LOUNGE_DUCKED_VOLUME = 0.24;

export function dshLoungeBackgroundItem(input: Omit<DshLoungeBackgroundItemV1, "volume"> & { volume?: number }): DshLoungeBackgroundItemV1 {
  const mediaUrl = safeHttps(input.mediaUrl, "mediaUrl"), sourceUrl = input.sourceUrl ? safeHttps(input.sourceUrl, "sourceUrl") : undefined;
  const volume = input.volume ?? DSH_LOUNGE_BACKGROUND_VOLUME;
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error("Lounge background volume is invalid");
  return { ...input, id: clean(input.id, "id"), title: label(input.title, "title"), mediaUrl, ...(input.creator ? { creator: label(input.creator, "creator") } : {}), ...(sourceUrl ? { sourceUrl } : {}), volume };
}

export interface DshLoungeBroadcastClockV1 { schemaVersion: 1; startedAt: string; restartAt: string; targetHours: number; secondsRemaining: number; due: boolean; warning: boolean; }
export const DSH_LOUNGE_RECOMMENDED_RESTART_HOURS = 23.75;
export const DSH_LOUNGE_RESTART_WARNING_MINUTES = 15;

export function dshLoungeBroadcastClock(startedAt: string, now = new Date().toISOString(), targetHours = DSH_LOUNGE_RECOMMENDED_RESTART_HOURS): DshLoungeBroadcastClockV1 {
  const started = Date.parse(startedAt), current = Date.parse(now);
  if (!Number.isFinite(started) || !Number.isFinite(current)) throw new Error("Lounge broadcast clock timestamp is invalid");
  if (!Number.isFinite(targetHours) || targetHours < 1 || targetHours > 47.5) throw new Error("Lounge broadcast restart target must be from 1 to 47.5 hours");
  const restartMs = started + targetHours * 3_600_000, remaining = Math.max(0, Math.ceil((restartMs - current) / 1_000));
  return { schemaVersion: 1, startedAt: new Date(started).toISOString(), restartAt: new Date(restartMs).toISOString(), targetHours, secondsRemaining: remaining, due: current >= restartMs, warning: current >= restartMs - DSH_LOUNGE_RESTART_WARNING_MINUTES * 60_000 };
}

export interface DshLoungeProgramSelectionV1 { schemaVersion: 1; mode: DshLoungeModeV1; priority: "maintenance" | "raid" | "event" | "normal"; slot?: DshLoungeProgramSlotV1; feature?: DshLoungeFeatureV1; headline: string; index?: number; endsAt?: string; }

/** Rotates only the compact information surface. Background media and games have independent lifecycles. */
export class DshLoungeProgramScheduler {
  constructor(private readonly rotation: readonly DshLoungeProgramSlotV1[] = DSH_LOUNGE_DEFAULT_ROTATION) { if (!rotation.some(slot => slot.enabled)) throw new Error("Lounge rotation requires at least one enabled slot"); }
  select(state: DshLoungeStateV1, now = new Date().toISOString(), clock?: DshLoungeBroadcastClockV1): DshLoungeProgramSelectionV1 {
    const at = Date.parse(now); if (!Number.isFinite(at)) throw new Error("Lounge program time is invalid");
    if (state.mode === "maintenance" || clock?.warning) return { schemaVersion: 1, mode: "maintenance", priority: "maintenance", headline: clock?.due ? "Lounge restart due" : "Lounge maintenance soon" };
    if (state.mode === "raid-pile" || state.mode === "raid-train") return addFeature({ schemaVersion: 1, mode: state.mode, priority: "raid", headline: state.headline }, firstFeature(state, state.mode === "raid-pile" ? "creator" : undefined));
    if (state.mode === "event") return addFeature({ schemaVersion: 1, mode: "event", priority: "event", headline: state.headline }, firstFeature(state, "event"));
    const slots = this.rotation.filter(slot => slot.enabled), cycleSeconds = slots.reduce((sum, slot) => sum + slot.durationSeconds, 0), second = Math.floor(at / 1_000) % cycleSeconds;
    let cursor = 0;
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index]!, end = cursor + slot.durationSeconds;
      if (second < end) {
        const remaining = end - second;
        return addFeature({ schemaVersion: 1, mode: "lounge", priority: "normal", slot: { ...slot }, headline: slot.title, index, endsAt: new Date(at + remaining * 1_000).toISOString() }, featureForSlot(state, slot.kind));
      }
      cursor = end;
    }
    const fallback = slots[0]!;
    return addFeature({ schemaVersion: 1, mode: "lounge", priority: "normal", slot: { ...fallback }, headline: fallback.title, index: 0 }, featureForSlot(state, fallback.kind));
  }
}

function addFeature(base: DshLoungeProgramSelectionV1, feature: DshLoungeFeatureV1 | undefined): DshLoungeProgramSelectionV1 { return feature ? { ...base, feature } : base; }
function featureForSlot(state: DshLoungeStateV1, kind: DshLoungeProgramKindV1) {
  const map: Partial<Record<DshLoungeProgramKindV1, DshLoungeFeatureV1["kind"]>> = { "community-board": "community", "live-creators": "creator", "raid-pile": "creator", events: "event", partners: "partner", "message-board": "message", "stella-chat": "message" };
  return firstFeature(state, map[kind]);
}
function firstFeature(state: DshLoungeStateV1, kind?: DshLoungeFeatureV1["kind"]) { const feature = kind ? state.features.find(item => item.kind === kind) : state.features[0]; return feature ? { ...feature } : undefined; }
function safeHttps(value: string, name: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`Lounge ${name} is invalid`); return url.toString(); }
function clean(value: string, name: string) { const result = String(value ?? "").trim(); if (!/^[A-Za-z0-9._:@/-]{1,180}$/.test(result)) throw new Error(`Lounge ${name} is invalid`); return result; }
function label(value: string, name: string) { const result = String(value ?? "").trim(); if (!result || result.length > 180 || /[\r\n\0]/.test(result)) throw new Error(`Lounge ${name} is invalid`); return result; }
