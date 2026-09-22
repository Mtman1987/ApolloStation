import { PUBLIC_LOUNGE_ID } from './lounge-room.js';
import type { HearMeOutBroadcastRuntime } from './room-broadcast.js';
import type { HearMeOutMediaItemV1, HearMeOutMediaRequestV1, HearMeOutMediaSessionV1 } from './room-media-core.js';
import { HearMeOutLiveLoungeBridge, type HearMeOutLiveLoungeSession } from './live-lounge-bridge.js';

const LANE = 'movie' as const;
const INSTANCE_ID = 'live-hearmeout-lounge-v1';

export class HearMeOutLiveLoungeRuntime implements HearMeOutBroadcastRuntime {
  private session: HearMeOutMediaSessionV1;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshTask: Promise<void> | undefined;
  private leaseOwner = '';
  private advancingRequestId = '';

  constructor(private readonly bridge: HearMeOutLiveLoungeBridge, readonly tenantId: string) {
    this.session = emptySession(tenantId);
  }

  async listen() {
    await this.refresh().catch(() => {});
    this.timer = setInterval(() => void this.refresh(), 750);
    this.timer.unref();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  broadcastSessions() {
    if (!this.session.current || this.advancingRequestId === this.session.current.requestId) return [];
    return [this.session];
  }

  getSession(tenantId: string, roomId: string, lane: 'music' | 'movie') {
    this.assertScope(tenantId, roomId, lane);
    return this.session;
  }

  getBroadcastIdentity(tenantId: string, roomId: string) {
    if (tenantId !== this.tenantId || roomId !== PUBLIC_LOUNGE_ID) return undefined;
    return { instanceId: INSTANCE_ID, createdAt: '2026-01-01T00:00:00.000Z' };
  }

  claimBroadcast(tenantId: string, roomId: string, lane: 'music' | 'movie', owner: string) {
    this.assertScope(tenantId, roomId, lane);
    if (this.leaseOwner && this.leaseOwner !== owner) return false;
    this.leaseOwner = owner;
    return true;
  }

  releaseBroadcast(tenantId: string, roomId: string, lane: 'music' | 'movie', owner: string) {
    this.assertScope(tenantId, roomId, lane);
    if (this.leaseOwner === owner) this.leaseOwner = '';
  }

  finishBroadcastRequest(tenantId: string, roomId: string, lane: 'music' | 'movie', requestId: string) {
    this.assertScope(tenantId, roomId, lane);
    if (!this.session.current || this.session.current.requestId !== requestId || this.advancingRequestId) return false;
    this.advancingRequestId = requestId;
    void this.bridge.control('skip', requestId)
      .then((remote) => { this.session = mapSession(remote, this.tenantId); })
      .finally(() => { this.advancingRequestId = ''; void this.refresh(); });
    return true;
  }

  private assertScope(tenantId: string, roomId: string, lane: 'music' | 'movie') {
    if (tenantId !== this.tenantId || roomId !== PUBLIC_LOUNGE_ID || lane !== LANE) {
      throw new Error('Live Lounge broadcast scope is invalid');
    }
  }

  private refresh() {
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = this.bridge.read().then((remote) => {
      if (this.advancingRequestId && remote.current?.requestId === this.advancingRequestId) return;
      this.session = mapSession(remote, this.tenantId);
    }).finally(() => { this.refreshTask = undefined; });
    return this.refreshTask;
  }
}

function emptySession(tenantId: string): HearMeOutMediaSessionV1 {
  return {
    schemaVersion: 1,
    tenantId,
    roomId: PUBLIC_LOUNGE_ID,
    sessionId: PUBLIC_LOUNGE_ID,
    lane: LANE,
    current: null,
    queue: [],
    playback: { status: 'idle', position: 0, updatedAt: new Date(0).toISOString(), muted: false, volume: 100 },
    revision: 0,
  };
}

function mapSession(remote: HearMeOutLiveLoungeSession, tenantId: string): HearMeOutMediaSessionV1 {
  const updatedAt = Number(remote.playback?.updatedAt || Date.now());
  return {
    schemaVersion: 1,
    tenantId,
    roomId: PUBLIC_LOUNGE_ID,
    sessionId: PUBLIC_LOUNGE_ID,
    lane: LANE,
    current: remote.current ? mapRequest(remote.current) : null,
    queue: Array.isArray(remote.queue) ? remote.queue.map(mapRequest) : [],
    playback: {
      status: remote.playback?.status === 'paused' ? 'paused' : remote.playback?.status === 'playing' ? 'playing' : 'idle',
      position: Math.max(0, Number(remote.playback?.position || 0)),
      updatedAt: new Date(Number.isFinite(updatedAt) ? updatedAt : Date.now()).toISOString(),
      muted: false,
      volume: 100,
    },
    revision: Number.isFinite(updatedAt) ? Math.max(0, Math.trunc(updatedAt)) : Date.now(),
  };
}

function mapRequest(request: any): HearMeOutMediaRequestV1 {
  const item = request.item || {};
  const type = ['movie', 'live', 'music', 'tts'].includes(item.type) ? item.type : 'movie';
  const mapped: HearMeOutMediaItemV1 = {
    itemId: String(item.id || item.itemId || item.metadata?.videoId || request.requestId),
    type,
    title: String(item.title || 'Untitled media'),
    source: String(item.source || 'HearMeOut'),
    playbackUrl: String(item.playbackUrl || ''),
    ...(item.poster ? { posterUrl: String(item.poster) } : {}),
    ...(runtimeSeconds(item.runtime) ? { durationSeconds: runtimeSeconds(item.runtime)! } : {}),
    ...(item.metadata && typeof item.metadata === 'object' ? { metadata: { ...item.metadata } } : {}),
  };
  return {
    requestId: String(request.requestId),
    requestedBy: {
      userId: String(request.requestedBy?.userId || 'hearmeout'),
      displayName: String(request.requestedBy?.displayName || request.requestedBy?.username || 'HearMeOut'),
    },
    addedAt: String(request.addedAt || new Date().toISOString()),
    item: mapped,
  };
}

function runtimeSeconds(value: unknown) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'live') return undefined;
  if (/^\d+(?::\d+){1,2}$/.test(raw)) {
    const parts = raw.split(':').map(Number);
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  const hours = Number(raw.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] || 0);
  const minutes = Number(raw.match(/(\d+(?:\.\d+)?)\s*m/)?.[1] || 0);
  const seconds = Number(raw.match(/(\d+(?:\.\d+)?)\s*s/)?.[1] || 0);
  const total = Math.round(hours * 3600 + minutes * 60 + seconds);
  return total > 0 ? total : undefined;
}
