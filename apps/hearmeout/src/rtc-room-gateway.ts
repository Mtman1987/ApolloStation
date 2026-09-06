import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { SpmtRtcRelayHubV1 } from './spmt-rtc-relay.js';
import { classifySpmtRtcFailure } from './spmt-rtc.js';
import { HearMeOutLiveKitSigner } from './livekit-signer.js';
import type { HearMeOutPrincipalV1 } from './room-media-core.js';

export type RoomRtcMode = 'waiting' | 'livekit-cloud' | 'peer-webrtc' | 'wss-relay';
export interface RoomRtcOptions {
  resolvePrincipal(request: IncomingMessage): Promise<HearMeOutPrincipalV1>;
  requireMembership(principal: HearMeOutPrincipalV1, roomId: string): void;
  livekit?: { url: string; apiKey: string; apiSecret: string };
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  membershipCheckMs?: number;
}
type Member = { id: number; principal: HearMeOutPrincipalV1; socket: WebSocket; sequence: number; alive: boolean; request: IncomingMessage; authorizedAt: number };
type Room = { key: string; roomId: string; mode: Exclude<RoomRtcMode, 'waiting'>; epoch: number; members: Map<number, Member> };

/** One authority chooses the transport for every member. Audio is never decoded here. */
export class HearMeOutRoomRtcGateway {
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 32_768, perMessageDeflate: false });
  private readonly relay = new SpmtRtcRelayHubV1({ maxParticipants: 8, maxFrameBytes: 1292, maxFramesPerSecond: 30 });
  private readonly rooms = new Map<string, Room>();
  private readonly timer: ReturnType<typeof setInterval>;
  private cloudUnavailableUntil = 0;
  private reconciling = false;
  private readonly signer: HearMeOutLiveKitSigner | undefined;

  constructor(private options: RoomRtcOptions) {
    if (options.livekit) {
      if (!/^wss:\/\//.test(options.livekit.url)) throw new Error('LiveKit URL must use wss');
      this.signer = new HearMeOutLiveKitSigner(options.livekit.apiKey, options.livekit.apiSecret);
    }
    this.timer = setInterval(() => { void this.reconcile(); }, options.membershipCheckMs ?? 15_000);
    this.timer.unref();
  }

  attach(server: Server) {
    server.on('upgrade', (request, socket, head) => {
      void this.upgrade(request, socket, head).catch(() => socket.destroy());
    });
  }

  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(request.url || '/', 'http://rtc.local');
    if (url.pathname !== '/api/hearmeout/rtc') return this.reject(socket, 404);
    // WebSocket cookies need the same origin protection as state-changing HTTP.
    if (!request.headers.origin || new URL(request.headers.origin).host !== request.headers.host) return this.reject(socket, 403);
    const roomId = url.searchParams.get('roomId') || '';
    if (!/^[A-Za-z0-9._:@/-]{1,160}$/.test(roomId)) return this.reject(socket, 400);
    let principal: HearMeOutPrincipalV1;
    try {
      principal = await this.options.resolvePrincipal(request);
      this.options.requireMembership(principal, roomId);
    } catch { return this.reject(socket, 403); }
    const key = createHash('sha256').update(JSON.stringify([principal.tenantId, roomId])).digest('hex');
    let room = this.rooms.get(key);
    if (!room) {
      if (this.rooms.size >= 128) return this.reject(socket, 503);
      room = { key, roomId, mode: this.signer && Date.now() >= this.cloudUnavailableUntil ? 'livekit-cloud' : 'peer-webrtc', epoch: 1, members: new Map() };
      this.rooms.set(key, room);
    }
    if (room.members.size >= 8) return this.reject(socket, 429);
    const target = room;
    this.sockets.handleUpgrade(request, socket, head, ws => this.join(target, principal, request, ws));
  }

  private join(room: Room, principal: HearMeOutPrincipalV1, request: IncomingMessage, socket: WebSocket) {
    let id: number;
    do { id = randomBytes(4).readUInt32BE(); } while (!id || room.members.has(id));
    const member: Member = { id, principal, socket, request, sequence: 0, alive: true, authorizedAt: Date.now() };
    room.members.set(id, member);
    const relayRoom = this.relay.room(room.key);
    relayRoom.join({ participantId: String(id), role: 'browser', send: frame => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 32_000) return false;
      socket.send(frame); return true;
    } });
    let windowAt = Date.now(), messages = 0;
    socket.on('pong', () => { member.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (raw, binary) => {
      if (Date.now() - windowAt >= 1000) { windowAt = Date.now(); messages = 0; }
      if (++messages > 80) return socket.close(4408, 'RTC message rate exceeded');
      if (!room.members.has(id)) return;
      try {
        this.options.requireMembership(principal, room.roomId);
        const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (binary) {
          if (room.mode !== 'wss-relay' || this.mode(room) === 'waiting') return;
          // Fixed wire format: 40ms, mono signed PCM16 LE, 16kHz. The server
          // stamps the actual sender and epoch; clients cannot impersonate peers.
          if (bytes.byteLength !== 1280) return socket.close(4400, 'Invalid RTC audio frame');
          const frame = Buffer.allocUnsafe(1292);
          frame.writeUInt32BE(id, 0); frame.writeUInt32BE(member.sequence++ >>> 0, 4); frame.writeUInt32BE(room.epoch, 8);
          bytes.copy(frame, 12);
          relayRoom.publish(String(id), frame);
          return;
        }
        const message = JSON.parse(bytes.toString('utf8'));
        if (message.type === 'signal' && room.mode === 'peer-webrtc' && message.epoch === room.epoch) {
          const target = room.members.get(Number(message.to));
          if (target && target !== member && (message.description || message.candidate)) {
            this.send(target, { type: 'signal', from: id, epoch: room.epoch, description: message.description, candidate: message.candidate });
          }
        } else if (message.type === 'failed' && message.epoch === room.epoch && message.transport === this.mode(room)) {
          this.failover(room, String(message.reason || '').slice(0, 500));
        } else if (message.type === 'sync') this.snapshot(room, member);
      } catch { socket.close(4403, 'RTC membership or frame rejected'); }
    });
    socket.once('close', () => {
      room.members.delete(id); relayRoom.leave(String(id));
      if (!room.members.size) this.rooms.delete(room.key);
      else { room.epoch++; this.broadcast(room); }
    });
    // Joining does not change an existing epoch: established P2P links survive.
    this.broadcast(room);
  }

  private mode(room: Room): RoomRtcMode {
    return new Set([...room.members.values()].map(member => member.principal.userId)).size < 2 ? 'waiting' : room.mode;
  }
  private failover(room: Room, reason: string) {
    if (room.mode === 'livekit-cloud') {
      const failure = classifySpmtRtcFailure(reason);
      this.cloudUnavailableUntil = Date.now() + (failure === 'quota-exhausted' || failure === 'rate-limited' ? 30 * 60_000 : 60_000);
      room.mode = 'peer-webrtc';
    } else if (room.mode === 'peer-webrtc') room.mode = 'wss-relay';
    else return;
    room.epoch++;
    this.broadcast(room);
  }
  private snapshot(room: Room, member: Member) {
    const mode = this.mode(room);
    const livekit = mode === 'livekit-cloud' && this.signer && this.options.livekit ? {
      url: this.options.livekit.url,
      ...this.signer.sign({ tenantId: member.principal.tenantId, roomId: room.roomId, roomName: `hmo_${room.key}`,
        participantIdentity: String(member.id), participantName: member.principal.displayName,
        ttlSeconds: 600, canPublish: true, canSubscribe: true, canPublishData: false }),
    } : undefined;
    this.send(member, { type: 'room', id: member.id, mode, epoch: room.epoch,
      peers: [...room.members.values()].map(value => ({ id: value.id, userId: value.principal.userId, name: value.principal.displayName })),
      iceServers: this.options.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }], livekit });
  }
  private broadcast(room: Room) { for (const member of room.members.values()) this.snapshot(room, member); }
  private send(member: Member, message: unknown) { if (member.socket.readyState === WebSocket.OPEN) member.socket.send(JSON.stringify(message)); }
  private reject(socket: Duplex, status: number) { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }

  private async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
    for (const room of this.rooms.values()) for (const member of room.members.values()) {
      try {
        this.options.requireMembership(member.principal, room.roomId);
        if (!member.alive) { member.socket.terminate(); continue; }
        member.alive = false; member.socket.ping();
        try {
          const identity = await this.options.resolvePrincipal(member.request);
          if (identity.userId !== member.principal.userId || identity.tenantId !== member.principal.tenantId) member.socket.close(4403, 'Session changed');
          else member.authorizedAt = Date.now();
        } catch (error) {
          const status = Number((error as { status?: number }).status);
          if (status === 401 || status === 403) member.socket.close(4403, 'Session ended');
          else if (Date.now() - member.authorizedAt > 120_000) member.socket.close(1013, 'Session service temporarily unavailable');
        }
      } catch { member.socket.close(4403, 'Room access ended'); }
    }
    this.relay.pruneIdle();
    } finally { this.reconciling = false; }
  }
  diagnostics() { return { rooms: this.rooms.size, relay: this.relay.snapshot() }; }
  close() {
    clearInterval(this.timer);
    for (const client of this.sockets.clients) client.terminate();
    this.sockets.close();
    this.rooms.clear();
  }
}
