import { Room, RoomEvent, Track } from 'livekit-client';

type Peer = { id: number; userId: string; name: string; serverMuted?: boolean; screenSharing?: boolean };
type Snapshot = { type: 'room'; id: number; mode: string; epoch: number; peers: Peer[]; iceServers: RTCIceServer[]; livekit?: { url: string; token: string } };
type Link = { pc: RTCPeerConnection; microphone?: RTCRtpTransceiver | undefined; screen?: RTCRtpTransceiver | undefined; screenAudio?: RTCRtpTransceiver | undefined; candidates: RTCIceCandidateInit[]; timer: ReturnType<typeof setTimeout> };

const captureProcessor = `class Capture extends AudioWorkletProcessor {
 constructor(){super();this.frame=new Int16Array(640);this.index=0;this.phase=0;this.sum=0;this.count=0;}
 process(inputs){const data=inputs[0]?.[0];if(!data)return true;for(const sample of data){this.sum+=sample;this.count++;this.phase+=16000;if(this.phase>=sampleRate){this.phase-=sampleRate;this.frame[this.index++]=Math.max(-32768,Math.min(32767,Math.round(this.sum/this.count*32767)));this.sum=0;this.count=0;if(this.index===640){this.port.postMessage(this.frame.buffer,[this.frame.buffer]);this.frame=new Int16Array(640);this.index=0;}}}return true;}
}registerProcessor('spmt-rtc-capture',Capture);`;

/** Shared room state comes from Apollo; capture, decoding and mixing run locally. */
export class HearMeOutRtc {
  private socket: WebSocket | null = null;
  private roomId = '';
  private input: MediaStream | null = null;
  private snapshot: Snapshot | null = null;
  private mode = 'waiting';
  private epoch = 0;
  private generation = 0;
  private links = new Map<number, Link>();
  private media = new Map<string, { id: number; audio: HTMLAudioElement }>();
  private screens = new Map<number, HTMLVideoElement>();
  private screen: MediaStream | null = null;
  private livekit: Room | null = null;
  private context: AudioContext | null = null;
  private capture: AudioWorkletNode | null = null;
  private captureSource: MediaStreamAudioSourceNode | null = null;
  private captureSink: GainNode | null = null;
  private captureGeneration = 0;
  private workletReady: Promise<void> | null = null;
  private scheduled = new Set<AudioBufferSourceNode>();
  private playout = new Map<number, { next: number; sequence: number; gain: GainNode }>();
  private master = 1;
  private personVolumes = new Map<string, number>();
  private outputDevice = '';
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private messages: Promise<void> = Promise.resolve();
  private framesReceived = 0;
  private framesSent = 0;

  constructor(private options: { onStatus(message: string): void }) {}

  async start(roomId: string, stream: MediaStream | null = null) {
    if (this.roomId === roomId && this.socket) { if (stream !== this.input) await this.setInput(stream); this.updateScreens(); return; }
    this.close(); this.roomId = roomId; this.input = stream; this.connect();
  }

  private connect() {
    if (!this.roomId) return;
    const url = new URL('/api/hearmeout/rtc', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('roomId', this.roomId);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer'; this.socket = socket;
    this.options.onStatus('Connecting room audio…');
    socket.onopen = () => { this.reconnectAttempt = 0; if (this.screen) this.send({ type: 'screen', sharing: true }); };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      if (event.data instanceof ArrayBuffer) { this.receiveAudio(event.data); return; }
      this.messages = this.messages.catch(() => {}).then(async () => {
        if (this.socket !== socket) return;
        const message = JSON.parse(String(event.data));
        if (message.type === 'room') await this.applySnapshot(message);
        else if (message.type === 'move' && typeof message.targetRoomId === 'string') window.dispatchEvent(new CustomEvent('hmo:room-moved', { detail: { roomId: message.targetRoomId } }));
        else if (message.type === 'signal') await this.receiveSignal(message);
      }).catch(error => this.failed(error));
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null; this.stopTransport(); this.snapshot = null;
      if ([4401, 4403].includes(event.code)) { this.roomId = ''; this.options.onStatus('Room access ended.'); return; }
      if (!this.roomId) return;
      this.options.onStatus('Connection lost. Reconnecting room audio…');
      this.reconnect = setTimeout(() => this.connect(), Math.min(30_000, 1000 * 2 ** this.reconnectAttempt++) + Math.random() * 500);
    };
    socket.onerror = () => {}; // close owns reconnection and cleanup.
  }

  private send(message: unknown) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  private failed(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.options.onStatus(this.mode === 'wss-relay' ? `Room audio unavailable: ${message}` : 'Changing the room audio connection…');
    this.send({ type: 'failed', epoch: this.epoch, transport: this.mode, reason: message.slice(0, 300) });
  }

  private async applySnapshot(snapshot: Snapshot) {
    const changed = snapshot.epoch !== this.epoch || snapshot.mode !== this.mode || snapshot.id !== this.snapshot?.id;
    this.snapshot = snapshot;
    if (!this.canPublish() && this.screen) await this.setScreen(null);
    if (changed) { this.stopTransport(); this.mode = snapshot.mode; this.epoch = snapshot.epoch; }
    if (snapshot.mode === 'waiting') { this.options.onStatus('Waiting for another person. Room audio is idle.'); return; }
    const generation = this.generation;
    if (snapshot.mode === 'livekit-cloud' && changed) await this.connectLiveKit(snapshot, generation);
    else if (snapshot.mode === 'peer-webrtc') {
      if (changed) this.options.onStatus('Connecting directly…');
      for (const peer of snapshot.peers) {
        if (peer.id === snapshot.id || this.links.has(peer.id)) continue;
        const link = this.makePeer(peer.id);
        if (snapshot.id < peer.id) {
          await link.pc.setLocalDescription(await link.pc.createOffer());
          this.send({ type: 'signal', to: peer.id, epoch: this.epoch, description: link.pc.localDescription });
        }
      }
    } else if (snapshot.mode === 'wss-relay' && changed) {
      await this.audioContext();
      if (generation !== this.generation) return;
      await this.startCapture();
      this.options.onStatus(this.context?.state === 'running' ? 'Connected through the fallback relay.' : 'Tap to enable room audio.');
    }
    if (snapshot.mode === 'wss-relay' && snapshot.peers.some(peer => peer.screenSharing)) {
      for (const peer of snapshot.peers) {
        if (peer.id === snapshot.id || this.links.has(peer.id) || (!peer.screenSharing && !this.screen)) continue;
        const link = this.makePeer(peer.id);
        if (snapshot.id < peer.id) { await link.pc.setLocalDescription(await link.pc.createOffer()); this.send({ type: 'signal', to: peer.id, epoch: this.epoch, description: link.pc.localDescription }); }
      }
    }
    this.updateScreens(); this.updateVolumes();
  }

  private makePeer(id: number): Link {
    const existing = this.links.get(id); if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.snapshot?.iceServers || [], bundlePolicy: 'max-bundle' });
    const track = this.canPublish() && this.mode === 'peer-webrtc' ? this.input?.getAudioTracks()[0] : undefined;
    const initiator = Boolean(this.snapshot && this.snapshot.id < id);
    const microphone = initiator ? pc.addTransceiver(track || 'audio', { direction: 'sendrecv' }) : undefined;
    const screen = initiator ? pc.addTransceiver(this.canPublish() && this.screen?.getVideoTracks()[0] || 'video', { direction: 'sendrecv' }) : undefined;
    const screenAudio = initiator ? pc.addTransceiver(this.canPublish() && this.screen?.getAudioTracks()[0] || 'audio', { direction: 'sendrecv' }) : undefined;
    const generation = this.generation;
    const link: Link = { pc, microphone, screen, screenAudio, candidates: [], timer: setTimeout(() => {
      if (generation === this.generation && pc.connectionState !== 'connected') this.peerFailed(new Error('Direct connection timed out'));
    }, 15_000) };
    this.links.set(id, link);
    pc.onicecandidate = event => { if (event.candidate) this.send({ type: 'signal', to: id, epoch: this.epoch, candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => { if (event.track.kind === 'video') this.attachScreen(id, event.track); else this.attachAudio(id, event.track); };
    pc.onconnectionstatechange = () => {
      if (generation !== this.generation) return;
      if (pc.connectionState === 'connected') {
        clearTimeout(link.timer);
        if (this.mode === 'peer-webrtc' && [...this.links.values()].every(value => value.pc.connectionState === 'connected')) this.options.onStatus('Connected directly.');
      } else if (pc.connectionState === 'failed') this.peerFailed(new Error('ICE failed'));
      else if (pc.connectionState === 'disconnected') {
        clearTimeout(link.timer);
        link.timer = setTimeout(() => { if (generation === this.generation && pc.connectionState !== 'connected') this.peerFailed(new Error('Direct connection disconnected')); }, 5000);
      }
    };
    return link;
  }
  private peerFailed(error: Error) { if (this.mode === 'wss-relay') this.options.onStatus('Voice remains connected. Screen sharing could not connect directly.'); else this.failed(error); }

  private async receiveSignal(message: any) {
    if (!['peer-webrtc', 'wss-relay'].includes(this.mode) || message.epoch !== this.epoch || !this.snapshot?.peers.some(peer => peer.id === message.from)) return;
    const link = this.makePeer(message.from);
    if (message.description) {
      await link.pc.setRemoteDescription(message.description);
      for (const candidate of link.candidates.splice(0)) await link.pc.addIceCandidate(candidate);
      if (message.description.type === 'offer') {
        // Answer using the offered transceivers; creating new ones before an
        // offer leaves the answer receive-only and loses later screen tracks.
        const offered = link.pc.getTransceivers();
        link.microphone = offered[0]; link.screen = offered[1]; link.screenAudio = offered[2];
        for (const transceiver of offered) transceiver.direction = 'sendrecv';
        await link.microphone?.sender.replaceTrack(this.canPublish() && this.mode === 'peer-webrtc' ? this.input?.getAudioTracks()[0] || null : null);
        await link.screen?.sender.replaceTrack(this.canPublish() ? this.screen?.getVideoTracks()[0] || null : null);
        await link.screenAudio?.sender.replaceTrack(this.canPublish() ? this.screen?.getAudioTracks()[0] || null : null);
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        this.send({ type: 'signal', to: message.from, epoch: this.epoch, description: link.pc.localDescription });
      }
    } else if (message.candidate) {
      if (link.pc.remoteDescription) await link.pc.addIceCandidate(message.candidate);
      else if (link.candidates.length < 100) link.candidates.push(message.candidate);
    }
  }

  private async connectLiveKit(snapshot: Snapshot, generation: number) {
    if (!snapshot.livekit) throw new Error('LiveKit is unavailable');
    const room = new Room(); this.livekit = room;
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind === Track.Kind.Audio) this.attachAudio(Number(participant.identity), track.mediaStreamTrack);
      else if (track.kind === Track.Kind.Video) this.attachScreen(Number(participant.identity), track.mediaStreamTrack);
    });
    room.on(RoomEvent.Disconnected, () => { if (generation === this.generation) this.failed(new Error('LiveKit disconnected')); });
    await room.connect(snapshot.livekit.url, snapshot.livekit.token, { peerConnectionTimeout: 15_000, websocketTimeout: 10_000 });
    if (generation !== this.generation) { await room.disconnect(false); return; }
    const track = this.canPublish() ? this.input?.getAudioTracks()[0] : undefined;
    if (track) await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
    if (this.screen && this.canPublish()) await this.publishScreen();
    this.options.onStatus('Room audio connected.');
  }

  private attachAudio(id: number, track: MediaStreamTrack) {
    const key = `${id}:${track.id}`; this.media.get(key)?.audio.parentElement?.remove();
    const audio = document.createElement('audio'); audio.autoplay = true;
    audio.dataset.hmoRtcPeer = String(id); audio.srcObject = new MediaStream([track]);
    const holder = document.createElement('span'); holder.hidden = true;
    holder.dataset.hmoUserId = this.snapshot?.peers.find(peer => peer.id === id)?.userId || '';
    holder.append(audio); document.body.append(holder);
    this.media.set(key, { id, audio }); this.updateVolumes();
    track.addEventListener('ended', () => { audio.pause(); holder.remove(); this.media.delete(key); }, { once: true });
    if (this.outputDevice && 'setSinkId' in audio) void audio.setSinkId(this.outputDevice).catch(() => {});
    void audio.play().catch(() => this.options.onStatus('Tap to enable room audio.'));
  }

  private attachScreen(id: number, track: MediaStreamTrack) {
    this.screens.get(id)?.remove();
    const video = document.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true;
    video.dataset.hmoScreen = String(id); video.srcObject = new MediaStream([track]); video.style.cssText = 'display:block;width:100%;max-height:55vh;background:#000';
    this.screens.set(id, video); this.updateScreens(); void video.play().catch(() => this.options.onStatus('Tap to enable the shared screen.'));
    track.addEventListener('ended', () => { video.remove(); this.screens.delete(id); }, { once: true });
  }
  private updateScreens() {
    let host = document.querySelector<HTMLElement>('[data-hmo-screens]');
    if (!host) { host = document.createElement('section'); host.dataset.hmoScreens = '1'; document.body.append(host); }
    const target = document.querySelector('.hmo-console-grid'); if (target && host.parentElement !== target) target.append(host);
    for (const [id, video] of this.screens) {
      const peer = this.snapshot?.peers.find(value => value.id === id); video.hidden = !peer?.screenSharing || peer.serverMuted === true;
      video.setAttribute('aria-label', `${peer?.name || 'Participant'} shared screen`); if (video.parentElement !== host) host.append(video);
    }
    host.hidden = ![...this.screens.values()].some(video => !video.hidden);
  }
  async shareScreen() {
    if (this.screen) { await this.setScreen(null); return; }
    if (!this.canPublish()) throw new Error('The room host has muted your publishing.');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    try { await this.setScreen(stream); } catch (error) { for (const track of stream.getTracks()) track.stop(); throw error; }
  }
  async setScreen(stream: MediaStream | null) {
    if (stream && !this.canPublish()) throw new Error('The room host has muted your publishing.');
    const prior = this.screen; this.screen = stream;
    if (prior && prior !== stream) for (const track of prior.getTracks()) track.stop();
    if (stream) stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (this.screen === stream) void this.setScreen(null); }, { once: true });
    for (const link of this.links.values()) { await link.screen?.sender.replaceTrack(stream?.getVideoTracks()[0] || null); await link.screenAudio?.sender.replaceTrack(stream?.getAudioTracks()[0] || null); }
    if (this.livekit) {
      for (const publication of this.livekit.localParticipant.trackPublications.values()) if ([Track.Source.ScreenShare, Track.Source.ScreenShareAudio].includes(publication.source) && publication.track) await this.livekit.localParticipant.unpublishTrack(publication.track, false);
      if (stream) await this.publishScreen();
    }
    this.send({ type: 'screen', sharing: Boolean(stream) });
    window.dispatchEvent(new CustomEvent('hmo:screen-sharing', { detail: { sharing: Boolean(stream) } }));
  }
  private async publishScreen() {
    if (!this.livekit || !this.screen || !this.canPublish()) return;
    const video = this.screen.getVideoTracks()[0], audio = this.screen.getAudioTracks()[0];
    if (video) await this.livekit.localParticipant.publishTrack(video, { source: Track.Source.ScreenShare });
    if (audio) await this.livekit.localParticipant.publishTrack(audio, { source: Track.Source.ScreenShareAudio });
  }

  async setInput(stream: MediaStream | null) {
    this.input = stream;
    const track = this.canPublish() ? stream?.getAudioTracks()[0] || null : null;
    for (const link of this.links.values()) await link.microphone?.sender.replaceTrack(this.mode === 'peer-webrtc' ? track : null);
    if (this.livekit) {
      for (const publication of this.livekit.localParticipant.audioTrackPublications.values()) {
        if (publication.track && publication.source === Track.Source.Microphone) await this.livekit.localParticipant.unpublishTrack(publication.track, false);
      }
      if (track) await this.livekit.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
    }
    if (this.mode === 'wss-relay') await this.startCapture();
  }

  private async audioContext() {
    if (!this.context) {
      this.context = new AudioContext();
      const context = this.context as AudioContext & { setSinkId?(id: string): Promise<void> };
      if (this.outputDevice && context.setSinkId) void context.setSinkId(this.outputDevice).catch(() => {});
    }
    void this.context.resume().catch(() => {}); return this.context;
  }
  private canPublish() { return !this.snapshot?.peers.find(peer => peer.id === this.snapshot?.id)?.serverMuted; }
  async resumeAudio() { await this.audioContext(); for (const { audio } of this.media.values()) await audio.play().catch(() => {}); for (const video of this.screens.values()) await video.play().catch(() => {}); }
  private async startCapture() {
    this.stopCapture();
    if (!this.input || this.mode !== 'wss-relay' || !this.canPublish()) return;
    const captureGeneration = this.captureGeneration;
    const context = await this.audioContext();
    if (captureGeneration !== this.captureGeneration) return;
    if (!this.workletReady) {
      const url = URL.createObjectURL(new Blob([captureProcessor], { type: 'application/javascript' }));
      this.workletReady = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    }
    await this.workletReady;
    if (!this.input || this.mode !== 'wss-relay' || captureGeneration !== this.captureGeneration) return;
    this.capture = new AudioWorkletNode(context, 'spmt-rtc-capture');
    this.capture.port.onmessage = event => {
      if (this.mode !== 'wss-relay' || this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 6400) return;
      if (!this.canPublish() || !this.input?.getAudioTracks().some(track => track.enabled && track.readyState === 'live')) return;
      this.socket.send(event.data); this.framesSent++;
    };
    this.captureSource = context.createMediaStreamSource(this.input);
    this.captureSink = context.createGain(); this.captureSink.gain.value = 0;
    this.captureSource.connect(this.capture).connect(this.captureSink).connect(context.destination);
  }
  private stopCapture() {
    this.captureGeneration++;
    this.captureSource?.disconnect(); this.capture?.disconnect(); this.captureSink?.disconnect();
    if (this.capture) { this.capture.port.onmessage = null; this.capture.port.close(); }
    this.captureSource = null; this.capture = null; this.captureSink = null;
  }

  private receiveAudio(frame: ArrayBuffer) {
    if (this.mode !== 'wss-relay' || frame.byteLength !== 1292 || !this.context || this.context.state !== 'running') return;
    const view = new DataView(frame), id = view.getUint32(0), sequence = view.getUint32(4);
    if (view.getUint32(8) !== this.epoch || !this.snapshot?.peers.some(peer => peer.id === id) || id === this.snapshot.id) return;
    const context = this.context;
    let output = this.playout.get(id);
    if (!output) { output = { next: 0, sequence: -1, gain: context.createGain() }; output.gain.connect(context.destination); this.playout.set(id, output); this.updateVolumes(); }
    if (sequence <= output.sequence) return;
    output.sequence = sequence;
    // Bound accumulated delay: TCP can arrive in bursts after a network stall.
    if (output.next > context.currentTime + 0.24) return;
    if (output.next < context.currentTime) output.next = context.currentTime + 0.06;
    const audio = context.createBuffer(1, 640, 16000), samples = audio.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(12 + i * 2, true) / 32768;
    const source = context.createBufferSource(); source.buffer = audio; source.connect(output.gain);
    this.scheduled.add(source); source.onended = () => { source.disconnect(); this.scheduled.delete(source); };
    source.start(output.next); output.next += 0.04; this.framesReceived++;
  }

  setVolume(volume: number) { this.master = Math.max(0, Math.min(1, volume)); this.updateVolumes(); }
  setPersonVolume(userId: string, volume: number) { this.personVolumes.set(userId, Math.max(0, Math.min(1, volume))); this.updateVolumes(); }
  private volume(id: number) { const peer = this.snapshot?.peers.find(peer => peer.id === id); if (peer?.serverMuted) return 0; const userId = peer?.userId || ''; return this.master * (this.personVolumes.get(userId) ?? Number(localStorage.getItem(`hmo-volume:${this.roomId}:${userId}`) ?? 100) / 100); }
  private updateVolumes() { for (const { id, audio } of this.media.values()) audio.volume = this.volume(id); for (const [id, output] of this.playout) output.gain.gain.value = this.volume(id); }
  async setOutput(id: string) {
    this.outputDevice = id;
    for (const { audio } of this.media.values()) if ('setSinkId' in audio) await audio.setSinkId(id).catch(() => {});
    const context = this.context as AudioContext & { setSinkId?(id: string): Promise<void> } | null;
    if (context?.setSinkId) await context.setSinkId(id).catch(() => {});
  }

  private stopTransport() {
    this.generation++;
    this.stopCapture();
    for (const link of this.links.values()) { clearTimeout(link.timer); link.pc.close(); }
    this.links.clear();
    const room = this.livekit; this.livekit = null; if (room) void room.disconnect(false);
    for (const { audio } of this.media.values()) { audio.pause(); audio.srcObject = null; audio.parentElement?.remove(); }
    this.media.clear();
    for (const video of this.screens.values()) { video.pause(); video.srcObject = null; video.remove(); } this.screens.clear();
    for (const source of this.scheduled) { try { source.stop(); } catch {} source.disconnect(); }
    this.scheduled.clear();
    for (const output of this.playout.values()) output.gain.disconnect();
    this.playout.clear();
  }
  diagnostics() { return { mode: this.mode, epoch: this.epoch, framesSent: this.framesSent, framesReceived: this.framesReceived, peers: [...this.links.values()].map(link => link.pc.connectionState), inputLive: this.input?.getAudioTracks().some(track => track.readyState === 'live') || false }; }
  close() {
    if (this.screen) { for (const track of this.screen.getTracks()) track.stop(); this.screen = null; }
    this.roomId = ''; if (this.reconnect) clearTimeout(this.reconnect); this.reconnect = null;
    const socket = this.socket; this.socket = null; socket?.close(); this.stopTransport();
    this.snapshot = null; this.mode = 'waiting'; this.epoch = 0;
    const context = this.context; this.context = null; this.workletReady = null; if (context) void context.close();
    // The UI owns the microphone, so failover never stops its MediaStreamTrack.
  }
}

(window as unknown as { HearMeOutRtc: typeof HearMeOutRtc }).HearMeOutRtc = HearMeOutRtc;
