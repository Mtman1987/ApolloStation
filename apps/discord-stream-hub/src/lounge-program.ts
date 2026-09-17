import type { DshLoungeFeatureV1, DshLoungeModeV1, DshLoungeStateV1 } from "./lounge-state.js";

export type DshLoungeProgramKindV1 = "community-board" | "live-creators" | "raid-pile" | "nebula" | "events" | "partners" | "message-board" | "approved-clips" | "stella-chat";
export interface DshLoungeProgramSlotV1 {
  id: string;
  kind: DshLoungeProgramKindV1;
  title: string;
  durationSeconds: number;
  enabled: boolean;
}

/** Normal Lounge loop. Priority events (Raid Pile/Train, scheduled events, maintenance) override this list. */
export const DSH_LOUNGE_DEFAULT_ROTATION: readonly DshLoungeProgramSlotV1[] = Object.freeze([
  { id: "community-board", kind: "community-board", title: "SpaceMountain Community Board", durationSeconds: 60, enabled: true },
  { id: "live-creators", kind: "live-creators", title: "Community Live Now", durationSeconds: 90, enabled: true },
  { id: "raid-pile", kind: "raid-pile", title: "Raid Pile Status", durationSeconds: 60, enabled: true },
  { id: "nebula", kind: "nebula", title: "Nebula Arcade", durationSeconds: 240, enabled: true },
  { id: "events", kind: "events", title: "Upcoming Community Events", durationSeconds: 60, enabled: true },
  { id: "partners", kind: "partners", title: "Community Partners", durationSeconds: 45, enabled: true },
  { id: "message-board", kind: "message-board", title: "Community Message Board", durationSeconds: 60, enabled: true },
  { id: "approved-clips", kind: "approved-clips", title: "Community Highlights", durationSeconds: 180, enabled: true },
  { id: "stella-chat", kind: "stella-chat", title: "Ask Stella", durationSeconds: 90, enabled: true },
]);

export interface DshLoungeBroadcastClockV1 {
  schemaVersion: 1;
  startedAt: string;
  restartAt: string;
  targetHours: number;
  secondsRemaining: number;
  due: boolean;
  warning: boolean;
}

export const DSH_LOUNGE_RECOMMENDED_RESTART_HOURS = 23.75;
export const DSH_LOUNGE_RESTART_WARNING_MINUTES = 15;

/**
 * Restream recommends restarting continuous broadcasts every 24 hours. Keep the target configurable
 * so another encoder can use a different maintenance interval without changing Lounge state.
 */
export function dshLoungeBroadcastClock(startedAt: string, now = new Date().toISOString(), targetHours = DSH_LOUNGE_RECOMMENDED_RESTART_HOURS): DshLoungeBroadcastClockV1 {
  const started = Date.parse(startedAt), current = Date.parse(now);
  if (!Number.isFinite(started) || !Number.isFinite(current)) throw new Error("Lounge broadcast clock timestamp is invalid");
  if (!Number.isFinite(targetHours) || targetHours < 1 || targetHours > 47.5) throw new Error("Lounge broadcast restart target must be from 1 to 47.5 hours");
  const restartMs = started + targetHours * 3_600_000;
  const remaining = Math.max(0, Math.ceil((restartMs - current) / 1_000));
  return { schemaVersion: 1, startedAt: new Date(started).toISOString(), restartAt: new Date(restartMs).toISOString(), targetHours, secondsRemaining: remaining, due: current >= restartMs, warning: current >= restartMs - DSH_LOUNGE_RESTART_WARNING_MINUTES * 60_000 };
}

export interface DshLoungeProgramSelectionV1 {
  schemaVersion: 1;
  mode: DshLoungeModeV1;
  priority: "maintenance" | "raid" | "event" | "normal";
  slot?: DshLoungeProgramSlotV1;
  feature?: DshLoungeFeatureV1;
  headline: string;
  index?: number;
  endsAt?: string;
}

export class DshLoungeProgramScheduler {
  constructor(private readonly rotation: readonly DshLoungeProgramSlotV1[] = DSH_LOUNGE_DEFAULT_ROTATION) {
    if (!rotation.some(slot => slot.enabled)) throw new Error("Lounge rotation requires at least one enabled slot");
  }

  select(state: DshLoungeStateV1, now = new Date().toISOString(), clock?: DshLoungeBroadcastClockV1): DshLoungeProgramSelectionV1 {
    const at = Date.parse(now); if (!Number.isFinite(at)) throw new Error("Lounge program time is invalid");
    if (state.mode === "maintenance" || clock?.warning) return { schemaVersion: 1, mode: "maintenance", priority: "maintenance", headline: clock?.due ? "Lounge restart due" : "Lounge maintenance soon" };
    if (state.mode === "raid-pile" || state.mode === "raid-train") return { schemaVersion: 1, mode: state.mode, priority: "raid", headline: state.headline, feature: firstFeature(state, state.mode === "raid-pile" ? "creator" : undefined) };
    if (state.mode === "event") return { schemaVersion: 1, mode: "event", priority: "event", headline: state.headline, feature: firstFeature(state, "event") };

    const slots = this.rotation.filter(slot => slot.enabled);
    const cycleSeconds = slots.reduce((sum, slot) => sum + slot.durationSeconds, 0);
    const second = Math.floor(at / 1_000) % cycleSeconds;
    let cursor = 0;
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index]!;
      const end = cursor + slot.durationSeconds;
      if (second < end) {
        const remaining = end - second;
        return { schemaVersion: 1, mode: "lounge", priority: "normal", slot: { ...slot }, feature: featureForSlot(state, slot.kind), headline: slot.title, index, endsAt: new Date(at + remaining * 1_000).toISOString() };
      }
      cursor = end;
    }
    const fallback = slots[0]!;
    return { schemaVersion: 1, mode: "lounge", priority: "normal", slot: { ...fallback }, feature: featureForSlot(state, fallback.kind), headline: fallback.title, index: 0 };
  }
}

function featureForSlot(state: DshLoungeStateV1, kind: DshLoungeProgramKindV1) {
  const map: Partial<Record<DshLoungeProgramKindV1, DshLoungeFeatureV1["kind"]>> = {
    "community-board": "community",
    "live-creators": "creator",
    "raid-pile": "creator",
    nebula: "nebula",
    events: "event",
    partners: "partner",
    "message-board": "message",
    "approved-clips": "creator",
    "stella-chat": "message",
  };
  return firstFeature(state, map[kind]);
}
function firstFeature(state: DshLoungeStateV1, kind?: DshLoungeFeatureV1["kind"]) { return (kind ? state.features.find(feature => feature.kind === kind) : state.features[0]) ? { ...(kind ? state.features.find(feature => feature.kind === kind)! : state.features[0]!) } : undefined; }
