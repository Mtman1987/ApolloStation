import type { HearMeOutMediaSessionV1 } from './room-media-core.js';

type Lane = 'music' | 'movie';
type RoomView = { room: { roomId: string }; member?: boolean; locked?: boolean; move?: { targetRoomId: string }; viewer: { userId: string; canManage: boolean }; music: HearMeOutMediaSessionV1; movie: HearMeOutMediaSessionV1 };

export function hearMeOutPlaybackPosition(session: HearMeOutMediaSessionV1, now = Date.now()) {
  const elapsed = session.playback.status === 'playing' ? Math.max(0, now - Date.parse(session.playback.updatedAt)) / 1000 : 0;
  return Math.max(0, session.playback.position + (Number.isFinite(elapsed) ? elapsed : 0));
}

/** One player per room lane. Moving a drawer never creates a second playback source. */
export class HearMeOutRoomMediaBrowser {
  private room: RoomView | undefined;
  private players = new Map<Lane, RoomPlayer>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshing = false;
  private generation = 0;
  private output = localStorage.getItem('hmo-output-device') || '';
  private volume = Number(localStorage.getItem('hmo-master-volume') || 100) / 100;
  private parking = document.createElement('div');

  constructor() { this.parking.hidden = true; this.parking.dataset.hmoMediaParking = '1'; document.body.append(this.parking); }
  bindRoom(room: RoomView) {
    if (!room.member || room.locked) { this.close(); return; }
    if (this.room?.room.roomId !== room.room.roomId) this.close();
    if (this.room) for (const lane of ['music', 'movie'] as const) {
      if (this.room[lane].revision > room[lane].revision) room = { ...room, [lane]: this.room[lane] };
    }
    this.room = room;
    for (const lane of ['movie', 'music'] as const) {
      let player = this.players.get(lane);
      if (!player) { player = new RoomPlayer(lane, (action, args) => this.control(lane, action, args)); this.players.set(lane, player); this.parking.append(player.root); }
      player.apply(room[lane], room.viewer); player.volume(this.volume); void player.output(this.output);
    }
    if (!this.timer) this.timer = setInterval(() => void this.refresh(), 1500);
  }
  mount(host: HTMLElement, room: RoomView, lane: Lane) { this.bindRoom(room); const player = this.players.get(lane); if (player) host.append(player.root); }
  park() { for (const player of this.players.values()) this.parking.append(player.root); }
  setVolume(value: number) { this.volume = Math.max(0, Math.min(1, value)); for (const player of this.players.values()) player.volume(this.volume); }
  async setOutput(value: string) { this.output = value; await Promise.all([...this.players.values()].map(player => player.output(value))); }
  async refresh() {
    if (!this.room || this.refreshing) return;
    this.refreshing = true; const generation = this.generation, roomId = this.room.room.roomId;
    try {
      const response = await fetch('/api/hearmeout/rooms/' + encodeURIComponent(roomId), { credentials: 'same-origin', cache: 'no-store' });
      if (generation !== this.generation) return;
      if ([401, 403, 404].includes(response.status)) { this.close(); return; }
      if (!response.ok) throw Error('Playback update failed. Reconnecting…');
      const next = await response.json() as RoomView;
      if (generation !== this.generation) return;
      if (!next.member || next.locked) { this.close(); if (next.move) window.dispatchEvent(new CustomEvent('hmo:room-moved', { detail: { roomId: next.move.targetRoomId } })); return; }
      this.bindRoom(next);
    } catch (error) { if (generation === this.generation) for (const player of this.players.values()) player.error(error); }
    finally { if (generation === this.generation) this.refreshing = false; }
  }
  private async control(lane: Lane, action: string, args: Record<string, unknown> = {}) {
    const room = this.room; if (!room) return;
    const generation = this.generation;
    const response = await fetch('/api/hearmeout/rooms/' + encodeURIComponent(room.room.roomId) + '/media/' + lane + '/control', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ action, ...args }),
    });
    const value = await response.json(); if (!response.ok) throw Error(value.message || value.error || 'Playback control failed');
    if (generation !== this.generation) return;
    room[lane] = value; this.players.get(lane)?.apply(value, room.viewer); await this.refresh();
  }
  close() { this.generation++; this.refreshing = false; if (this.timer) clearInterval(this.timer); this.timer = undefined; for (const player of this.players.values()) player.close(); this.players.clear(); this.room = undefined; }
}

class RoomPlayer {
  readonly root = document.createElement('section');
  private media: HTMLMediaElement;
  private title = document.createElement('strong');
  private status = document.createElement('p');
  private controls = document.createElement('div');
  private seek = document.createElement('input');
  private sharedVolume = document.createElement('input');
  private queue = document.createElement('div');
  private session?: HearMeOutMediaSessionV1;
  private viewer?: RoomView['viewer'];
  private requestId = '';
  private endedId = '';
  private master = 1;
  private source = '';
  private resumeBlocked = false;
  private outputDevice: string | undefined;

  constructor(lane: Lane, private send: (action: string, args?: Record<string, unknown>) => Promise<void>) {
    this.root.className = 'hmo-native-player'; this.root.dataset.hmoPlayer = lane;
    this.media = document.createElement(lane === 'music' ? 'audio' : 'video');
    this.media.preload = 'metadata'; this.media.setAttribute('playsinline', '');
    this.media.style.cssText = 'display:block;width:100%;max-height:48vh;background:#000';
    this.status.setAttribute('role', 'status'); this.controls.className = 'hmo-toolbar';
    const button = (label: string, action: () => void | Promise<void>) => { const node = document.createElement('button'); node.type = 'button'; node.className = 'hmo-button'; node.textContent = label; node.addEventListener('click', () => void Promise.resolve().then(action).catch(error => this.error(error))); return node; };
    this.controls.append(button('Play', () => this.send('play')), button('Pause', () => this.send('pause')),
      button('Next', () => this.advance()), button('Clear', () => this.send('clear', { expectedRequestId: this.requestId })),
      button('Mute session', () => this.send(this.session?.playback.muted ? 'unmute' : 'mute')));
    this.seek.type = 'range'; this.seek.min = '0'; this.seek.step = '.1'; this.seek.setAttribute('aria-label', lane + ' position');
    this.seek.addEventListener('change', () => void this.send('seek', { position: Number(this.seek.value) }).catch(error => this.error(error)));
    this.sharedVolume.type = 'range'; this.sharedVolume.min = '0'; this.sharedVolume.max = '100'; this.sharedVolume.setAttribute('aria-label', lane + ' shared volume');
    this.sharedVolume.addEventListener('change', () => void this.send('volume', { position: Number(this.sharedVolume.value) }).catch(error => this.error(error)));
    this.controls.append(this.seek, this.sharedVolume);
    this.root.append(this.title, this.media, this.status, button('Enable sound / retry', async () => { this.resumeBlocked = false; if (this.media.error) { this.media.load(); return; } await this.sync(); }), this.controls, this.queue);
    this.media.addEventListener('loadedmetadata', () => void this.sync().catch(error => this.error(error)));
    this.media.addEventListener('canplay', () => void this.sync().catch(error => this.error(error)));
    this.media.addEventListener('error', () => this.error(Error('This media could not play. Retry or choose another source; the queue is preserved.')));
    this.media.addEventListener('ended', () => { if (this.session?.playback.status === 'playing' && this.canAdvance() && this.endedId !== this.requestId) { this.endedId = this.requestId; void this.advance().catch(error => { this.endedId = ''; this.error(error); }); } });
    this.media.addEventListener('timeupdate', () => { if (document.activeElement !== this.seek) this.seek.value = String(this.media.currentTime); });
  }
  apply(session: HearMeOutMediaSessionV1, viewer: RoomView['viewer']) {
    this.session = session; this.viewer = viewer;
    this.controls.hidden = !viewer.canManage;
    this.title.textContent = session.current?.item.title || 'Nothing playing';
    this.sharedVolume.value = String(session.playback.volume);
    const id = session.current?.requestId || '', url = session.current?.item.playbackUrl || '';
    if (id !== this.requestId || url !== this.source) {
      this.media.pause(); this.requestId = id; this.source = url; this.endedId = ''; this.resumeBlocked = false;
      if (url) { const parsed = new URL(url, location.href); this.media.src = /^\/v1\/media\/public\/[A-Za-z0-9_-]{43}$/.test(parsed.pathname) ? parsed.pathname : parsed.href; }
      else this.media.removeAttribute('src');
      this.media.load();
    }
    this.queue.replaceChildren(...session.queue.map((request, index) => {
      const row = document.createElement('div'); row.className = 'hmo-queue-row';
      const text = document.createElement('span'); text.textContent = request.item.title; row.append(text);
      if (viewer.canManage) { const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'hmo-button'; jump.textContent = 'Play this'; jump.onclick = () => void this.send('jump', { targetIndex: index }).catch(error => this.error(error)); row.append(jump); }
      return row;
    }));
    void this.sync().catch(error => this.error(error));
  }
  private canAdvance() { return this.viewer?.canManage || this.session?.current?.requestedBy.userId === this.viewer?.userId; }
  private advance() { return this.send('next', { expectedRequestId: this.requestId }); }
  private async sync() {
    const session = this.session; if (!session?.current) { this.media.pause(); this.status.textContent = 'Queue is empty'; return; }
    this.volume(this.master);
    if (this.media.readyState < 1) return;
    const duration = Number.isFinite(this.media.duration) ? this.media.duration : session.current.item.durationSeconds;
    const target = hearMeOutPlaybackPosition(session);
    this.seek.max = String(duration ?? Math.max(target, 1)); this.seek.disabled = !duration;
    if (!this.media.seeking && Math.abs(this.media.currentTime - target) > 1.5) {
      try { this.media.currentTime = Math.min(target, duration ?? target); } catch { /* A live seek range may not be available yet. */ }
    }
    if (session.playback.status === 'playing') {
      if (!this.resumeBlocked && this.media.paused) {
        try { await this.media.play(); } catch (error) { if ((error as Error).name === 'NotAllowedError') { this.resumeBlocked = true; this.status.textContent = 'Tap Enable sound to join playback.'; return; } if ((error as Error).name !== 'AbortError') { this.error(error); return; } }
      }
    } else this.media.pause();
    if (!this.resumeBlocked && !this.media.error) this.status.textContent = session.playback.status + ' · shared volume ' + session.playback.volume + '%';
  }
  volume(value: number) { this.master = value; this.media.volume = Math.max(0, Math.min(1, (this.session?.playback.volume ?? 85) / 100 * value)); this.media.muted = this.session?.playback.muted ?? false; }
  async output(deviceId: string) { if (deviceId === this.outputDevice) return; try { if ('setSinkId' in this.media) await this.media.setSinkId(deviceId); this.outputDevice = deviceId; } catch { this.status.textContent = 'Selected audio output is unavailable. Choose an output in Audio settings.'; } }
  error(error: unknown) { this.status.textContent = error instanceof Error ? error.message : String(error); }
  close() { this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.root.remove(); }
}

if (typeof window !== 'undefined') {
  const media = new HearMeOutRoomMediaBrowser(); Object.assign(window, { HearMeOutMedia: media });
  window.addEventListener('pagehide', () => media.close());
}
