import Hls from 'hls.js';

/** One local playback source per element; room state still owns the queue. */
export class HearMeOutPlaybackSource {
  private hls: Hls | undefined;
  private nativeChanged: (() => void) | undefined;
  private source = '';
  private broadcast = false;
  failed = false;
  constructor(private readonly media: HTMLMediaElement, private readonly report: (error: Error) => void, private readonly audio?: HTMLSelectElement) {
    if (audio) { audio.hidden = true; audio.setAttribute('aria-label', 'Audio language'); audio.addEventListener('change', () => this.selectAudio(Number(audio.value))); }
  }
  load(value: string, isHls = false, broadcast = false) {
    this.clear(); this.source = value; this.broadcast = broadcast; this.failed = false;
    if (!value) return;
    const url = new URL(value, location.href);
    const source = /^\/v1\/media\/public\/[A-Za-z0-9_-]{43}$/.test(url.pathname) ? url.pathname : url.href;
    const playlist = isHls || /\.m3u8$/i.test(url.pathname);
    if (playlist && Hls.isSupported()) {
      const hls = this.hls = new Hls({
        enableWorker: true, backBufferLength: 30, maxBufferLength: 30,
        manifestLoadPolicy: { default: { maxTimeToFirstByteMs: 15000, maxLoadTimeMs: 20000,
          timeoutRetry: { maxNumRetry: 2, retryDelayMs: 1000, maxRetryDelayMs: 4000 },
          errorRetry: { maxNumRetry: 8, retryDelayMs: 1000, maxRetryDelayMs: 4000 } } },
        // Join the feed once; never speed up or chase another viewer's clock.
        ...(broadcast ? { startPosition: -1, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: Infinity, maxLiveSyncPlaybackRate: 1 } : {}),
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.tracks(hls.audioTracks.map((track, index) => ({ index, name: track.name || track.lang || `Audio ${index + 1}` })), hls.audioTrack));
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => { if (this.audio) this.audio.value = String(data.id); });
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) { this.failed = true; this.report(Error('This stream could not load. Retry the source; your room queue is preserved.')); } });
      hls.loadSource(source); hls.attachMedia(this.media);
    } else {
      if (playlist && !this.media.canPlayType('application/vnd.apple.mpegurl')) { this.failed = true; this.report(Error('This browser cannot play HLS streams. Open this room in a browser with media streaming support.')); return; }
      this.media.src = source;
      const tracks = (this.media as HTMLMediaElement & { audioTracks?: NativeTracks }).audioTracks;
      if (tracks) { this.nativeChanged = () => this.tracks(Array.from({ length: tracks.length }, (_, index) => ({ index, name: tracks[index]!.label || tracks[index]!.language || `Audio ${index + 1}` })), Array.from({ length: tracks.length }, (_, i) => i).find(i => tracks[i]!.enabled) ?? 0); tracks.addEventListener('addtrack', this.nativeChanged); tracks.addEventListener('change', this.nativeChanged); this.nativeChanged(); }
      this.media.load();
    }
  }
  retry() { this.load(this.source, Boolean(this.hls), this.broadcast); }
  joinLive() { if (!this.broadcast) return; const position=this.hls?.liveSyncPosition ?? (this.media.seekable.length ? Math.max(this.media.seekable.start(0),this.media.seekable.end(this.media.seekable.length-1)-2) : undefined); if (position !== undefined && Number.isFinite(position)) this.media.currentTime=position; }
  clear() {
    this.hls?.destroy(); this.hls = undefined;
    const tracks = (this.media as HTMLMediaElement & { audioTracks?: NativeTracks }).audioTracks;
    if (tracks && this.nativeChanged) { tracks.removeEventListener('addtrack', this.nativeChanged); tracks.removeEventListener('change', this.nativeChanged); }
    this.nativeChanged = undefined; this.media.pause(); this.media.removeAttribute('src'); this.media.load();
    if (this.audio) { this.audio.replaceChildren(); this.audio.hidden = true; }
  }
  private tracks(tracks: Array<{ index: number; name: string }>, selected: number) {
    if (!this.audio) return;
    this.audio.replaceChildren(...tracks.map(track => { const option = document.createElement('option'); option.value = String(track.index); option.textContent = track.name; return option; }));
    this.audio.value = String(selected); this.audio.hidden = tracks.length < 2;
  }
  private selectAudio(index: number) {
    if (!Number.isInteger(index) || index < 0) return;
    if (this.hls) { if (index < this.hls.audioTracks.length) this.hls.audioTrack = index; return; }
    const tracks = (this.media as HTMLMediaElement & { audioTracks?: NativeTracks }).audioTracks;
    if (tracks && index < tracks.length) for (let i = 0; i < tracks.length; i++) tracks[i]!.enabled = i === index;
  }
}
interface NativeTracks extends EventTarget { length: number; [index: number]: { enabled: boolean; label: string; language: string }; }
if (typeof window !== 'undefined') Object.assign(window, { HearMeOutPlaybackSource });
