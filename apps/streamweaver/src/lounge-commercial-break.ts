import { loungeDataPath, readLoungeJson, writeLoungeJson } from './lounge-store.js';

export const COMMERCIAL_MIN_ACTIVE_MS = 180_000;
export const COMMERCIAL_COOLDOWN_MS = 300_000;

export type CommercialBreakPhase = 'IDLE' | 'ACTIVE' | 'COOLDOWN';

export type CommercialBreakState = {
  schemaVersion: 1;
  phase: CommercialBreakPhase;
  breakStartedAt: number;
  activeUntil: number;
  cooldownUntil: number;
  lastEventMessageId: string;
  lastEventStartedAt: number;
  durationSeconds: number;
  isAutomatic: boolean;
  updatedAt: number;
};

const empty = (): CommercialBreakState => ({
  schemaVersion: 1,
  phase: 'IDLE',
  breakStartedAt: 0,
  activeUntil: 0,
  cooldownUntil: 0,
  lastEventMessageId: '',
  lastEventStartedAt: 0,
  durationSeconds: 0,
  isAutomatic: false,
  updatedAt: 0,
});

// The selected Spotlight broadcaster's stitched ads do not send EventSub
// events to the SpaceMountain tenant. Cover them using the relay's confirmed
// marker, while preserving any longer SpaceMountain commercial already active.
export function withSpotlightCommercialBreak(
  state: CommercialBreakState, program: unknown, now = Date.now(), playbackDelayMs = 60000,
): CommercialBreakState {
  type Marker = { active?: boolean; id?: string; breakStartedAt?: number; activeUntil?: number; sourceEndsAt?: number };
  const relay = program as { commercialBreak?: Marker; recentCommercialBreak?: Marker } | null;
  const confirmed = relay?.recentCommercialBreak || relay?.commercialBreak;
  const delay = Number.isFinite(playbackDelayMs) ? Math.min(300000, Math.max(12000, playbackDelayMs)) : 60000;
  const marker = confirmed && Number.isFinite(confirmed.sourceEndsAt)
    ? { ...confirmed, activeUntil: confirmed.sourceEndsAt! + delay } : confirmed;
  if (!marker?.active || typeof marker.id !== 'string' || !marker.id
    || !Number.isFinite(marker.breakStartedAt) || !Number.isFinite(marker.activeUntil)
    || marker.breakStartedAt! <= 0 || marker.breakStartedAt! > now
    || marker.activeUntil! <= now || marker.activeUntil! <= marker.breakStartedAt!) return state;
  if (state.phase === 'ACTIVE' && state.activeUntil >= marker.activeUntil!) return state;
  return {
    ...state, phase: 'ACTIVE', breakStartedAt: marker.breakStartedAt!,
    activeUntil: marker.activeUntil!, cooldownUntil: marker.activeUntil!,
    lastEventMessageId: `spotlight:${marker.id}`, lastEventStartedAt: marker.breakStartedAt!,
    durationSeconds: Math.ceil((marker.activeUntil! - marker.breakStartedAt!) / 1000),
    isAutomatic: true, updatedAt: now,
  };
}

function filePath(tenantId: string) {
  return loungeDataPath(tenantId, 'commercial-break-state.json');
}
type CommercialBreakListener = (tenantId: string, state: CommercialBreakState) => void;
const listeners = new Set<CommercialBreakListener>();
/** Subscribe to commercial-break starts (replaces the donor's global websocket broadcast). */
export function onCommercialBreakState(listener: CommercialBreakListener) { listeners.add(listener); return () => listeners.delete(listener); }

function normalized(value: Partial<CommercialBreakState> | null): CommercialBreakState {
  const state = { ...empty(), ...(value || {}), schemaVersion: 1 as const };
  const now = Date.now();
  const hardActiveCap = state.breakStartedAt > 0
    ? state.breakStartedAt + Math.max(1000, Math.max(0, Number(state.durationSeconds) || 0) * 1000)
    : 0;
  if (state.activeUntil > hardActiveCap && hardActiveCap > 0) state.activeUntil = hardActiveCap;
  if (state.cooldownUntil > state.activeUntil + COMMERCIAL_COOLDOWN_MS) state.cooldownUntil = state.activeUntil + COMMERCIAL_COOLDOWN_MS;
  if (state.activeUntil > now) state.phase = 'ACTIVE';
  else if (state.cooldownUntil > now) state.phase = 'COOLDOWN';
  else state.phase = 'IDLE';
  return state;
}

async function readStored(tenantId: string): Promise<CommercialBreakState> {
  return normalized(readLoungeJson<Partial<CommercialBreakState> | null>(filePath(tenantId), null));
}

async function writeStored(tenantId: string, state: CommercialBreakState) {
  writeLoungeJson(filePath(tenantId), state);
}

function broadcast(tenantId: string, state: CommercialBreakState) {
  for (const listener of listeners) { try { listener(tenantId, state); } catch {} }
}

export async function getCommercialBreakState(tenantId: string): Promise<CommercialBreakState> {
  const stored = await readStored(tenantId);
  const current = normalized(stored);
  if (current.phase !== stored.phase) {
    current.updatedAt = Date.now();
    await writeStored(tenantId, current);
  }
  return current;
}

export async function beginCommercialBreak(input: {
  tenantId: string;
  messageId: string;
  startedAt: string;
  durationSeconds: number;
  isAutomatic: boolean;
}): Promise<{ state: CommercialBreakState; accepted: boolean; reason: string }> {
  const tenantId = String(input.tenantId || '').trim();
  const messageId = String(input.messageId || '').trim();
  if (!tenantId || !messageId) throw new Error('Commercial break requires tenant and EventSub message ID');

  const now = Date.now();
  const start = Number.isFinite(Date.parse(input.startedAt)) ? Date.parse(input.startedAt) : now;
  const durationSeconds = Math.max(0, Math.round(Number(input.durationSeconds) || 0));
  const candidateUntil = start + Math.max(1000, durationSeconds * 1000);
  const current = await getCommercialBreakState(tenantId);

  if (current.lastEventMessageId === messageId) {
    return { state: current, accepted: false, reason: 'duplicate-message-id' };
  }

  if (current.phase === 'ACTIVE') {
    const next = {
      ...current,
      lastEventMessageId: messageId,
      lastEventStartedAt: start,
      updatedAt: now,
    };
    await writeStored(tenantId, next);
    return { state: next, accepted: false, reason: 'active-duplicate' };
  }

  if (current.phase === 'COOLDOWN' && now < current.cooldownUntil) {
    const next = { ...current, lastEventMessageId: messageId, lastEventStartedAt: start, updatedAt: now };
    await writeStored(tenantId, next);
    return { state: next, accepted: false, reason: 'cooldown' };
  }

  const activeUntil = candidateUntil;
  const next: CommercialBreakState = {
    schemaVersion: 1,
    phase: 'ACTIVE',
    breakStartedAt: start,
    activeUntil,
    cooldownUntil: activeUntil + COMMERCIAL_COOLDOWN_MS,
    lastEventMessageId: messageId,
    lastEventStartedAt: start,
    durationSeconds,
    isAutomatic: Boolean(input.isAutomatic),
    updatedAt: now,
  };
  await writeStored(tenantId, next);
  broadcast(tenantId, next);
  return { state: next, accepted: true, reason: 'started' };
}
