import type { OutboundChatMessageV1 } from "@spmt/contracts";
import type { ChatProviderSenderV1, ProviderChatEnvelopeV1 } from "./index.js";
import type { ProviderConnectionConfigV1, ProviderConnectionDriverV1, ProviderConnectionHandleV1 } from "./connection-supervisor.js";

export const TWITCH_IRC_WEBSOCKET_URL = "wss://irc-ws.chat.twitch.tv:443";
export const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
export const DISCORD_API_ORIGIN = "https://discord.com/api/v10";
export const KICK_PUSHER_APP_KEY = "32cbd69e4b950bf97679";
export const KICK_PUSHER_CLUSTER = "us2";
export const KICK_PUSHER_WEBSOCKET_URL = `wss://ws-${KICK_PUSHER_CLUSTER}.pusher.com/app/${KICK_PUSHER_APP_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;
export const KICK_CHAT_API_URL = "https://api.kick.com/public/v1/chat";

export interface ChatWebSocketEventLike { data?: unknown; code?: number; reason?: string; }
export interface ChatWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: ChatWebSocketEventLike) => void): void;
}
export type ChatWebSocketFactory = (url: string) => ChatWebSocketLike;

export interface ProviderHttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type ProviderFetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<ProviderHttpResponseLike>;

export interface ProviderDriverDependencies {
  websocketFactory?: ChatWebSocketFactory;
  fetch?: ProviderFetchLike;
  handshakeTimeoutMs?: number;
  now?: () => Date;
}

interface ActiveConnection {
  connection: ProviderConnectionConfigV1;
  socket: ChatWebSocketLike;
  accessToken: string;
  grantMetadata: Record<string, string>;
}

interface DriverOpenInput {
  connection: ProviderConnectionConfigV1;
  accessToken: string;
  grantExpiresAt: string;
  grantMetadata: Record<string, string>;
  resumeCursor?: string;
  onEnvelope(envelope: ProviderChatEnvelopeV1): void | Promise<void>;
  onCursor(cursor: string): void;
  onDisconnect(failure: { kind: "transport" | "authentication"; reason: string }): void;
}

export class TwitchIrcProviderDriver implements ProviderConnectionDriverV1, ChatProviderSenderV1 {
  readonly provider = "twitch" as const;
  private readonly active = new Map<string, ActiveConnection>();
  private readonly websocketFactory: ChatWebSocketFactory;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(dependencies: ProviderDriverDependencies = {}) {
    this.websocketFactory = dependencies.websocketFactory ?? defaultWebSocketFactory;
    this.timeoutMs = normalizeTimeout(dependencies.handshakeTimeoutMs);
    this.now = dependencies.now ?? (() => new Date());
  }

  async open(input: DriverOpenInput): Promise<ProviderConnectionHandleV1> {
    const socket = this.websocketFactory(TWITCH_IRC_WEBSOCKET_URL);
    const key = connectionKey(input.connection);
    const channel = normalizeTwitchChannel(input.connection.channelId);
    const username = requireMetadata(input.grantMetadata.username ?? input.connection.providerAccountId, "Twitch username").toLowerCase();
    let intentionallyClosed = false;
    let settled = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Twitch IRC handshake timed out")), this.timeoutMs);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };

      socket.addEventListener("open", () => {
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership\r\n");
        socket.send(`PASS oauth:${stripOauthPrefix(input.accessToken)}\r\n`);
        socket.send(`NICK ${username}\r\n`);
        socket.send(`JOIN #${channel}\r\n`);
      });
      socket.addEventListener("message", (event) => {
        const text = socketText(event.data);
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          if (line.startsWith("PING")) {
            socket.send(line.replace(/^PING/, "PONG") + "\r\n");
            continue;
          }
          if (/ NOTICE [^ ]+ :.*(?:authentication failed|improperly formatted auth|login unsuccessful)/i.test(line)) {
            finish(new Error("Twitch authorization rejected"));
            return;
          }
          if (/ (?:001|GLOBALUSERSTATE) /.test(` ${line} `) || line.includes(" GLOBALUSERSTATE ")) finish();
          const envelope = parseTwitchPrivmsg(line, input.connection, this.now());
          if (!envelope) continue;
          input.onCursor(envelope.messageId);
          void Promise.resolve(input.onEnvelope(envelope)).catch(() => undefined);
        }
      });
      socket.addEventListener("error", () => finish(new Error("Twitch IRC transport failed during handshake")));
      socket.addEventListener("close", (event) => {
        this.active.delete(key);
        if (!settled) finish(new Error("Twitch IRC closed during handshake"));
        if (!intentionallyClosed && settled) input.onDisconnect({ kind: twitchCloseIsAuthentication(event.code) ? "authentication" : "transport", reason: safeCloseReason("Twitch IRC", event) });
      });
    });

    this.active.set(key, { connection: input.connection, socket, accessToken: input.accessToken, grantMetadata: input.grantMetadata });
    return {
      close: () => {
        intentionallyClosed = true;
        this.active.delete(key);
        safeSocketClose(socket, 1000, "supervisor stop");
      },
    };
  }

  async send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }> {
    const active = this.active.get(connectionKey(message));
    if (!active || active.socket.readyState !== 1) throw new Error("Twitch chat connection is unavailable");
    const channel = normalizeTwitchChannel(message.channelId);
    const text = sanitizeChatText(message.text);
    const replyTag = message.replyToMessageId ? `@reply-parent-msg-id=${message.replyToMessageId} ` : "";
    active.socket.send(`${replyTag}PRIVMSG #${channel} :${text}\r\n`);
    return { providerMessageId: `twitch:${message.idempotencyKey}` };
  }
}

export class DiscordGatewayProviderDriver implements ProviderConnectionDriverV1, ChatProviderSenderV1 {
  readonly provider = "discord" as const;
  private readonly active = new Map<string, ActiveConnection>();
  private readonly websocketFactory: ChatWebSocketFactory;
  private readonly fetchImpl: ProviderFetchLike;
  private readonly timeoutMs: number;

  constructor(dependencies: ProviderDriverDependencies = {}) {
    this.websocketFactory = dependencies.websocketFactory ?? defaultWebSocketFactory;
    this.fetchImpl = dependencies.fetch ?? defaultProviderFetch;
    this.timeoutMs = normalizeTimeout(dependencies.handshakeTimeoutMs);
  }

  async open(input: DriverOpenInput): Promise<ProviderConnectionHandleV1> {
    const resume = decodeDiscordCursor(input.resumeCursor);
    const socket = this.websocketFactory(resume?.resumeGatewayUrl ? `${stripQuery(resume.resumeGatewayUrl)}/?v=10&encoding=json` : DISCORD_GATEWAY_URL);
    const key = connectionKey(input.connection);
    let intentionallyClosed = false;
    let settled = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let sequence: number | null = resume?.seq ?? null;
    let sessionId = resume?.sessionId;
    let resumeGatewayUrl = resume?.resumeGatewayUrl;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Discord Gateway handshake timed out")), this.timeoutMs);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      socket.addEventListener("message", (event) => {
        const packet = parseJsonRecord(socketText(event.data));
        if (!packet) return;
        const op = numberValue(packet.op);
        const packetSequence = numberValue(packet.s);
        if (packetSequence !== undefined) sequence = packetSequence;
        if (op === 10) {
          const hello = recordValue(packet.d);
          const interval = numberValue(hello?.heartbeat_interval) ?? 45_000;
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = setInterval(() => socket.send(JSON.stringify({ op: 1, d: sequence })), Math.max(1_000, interval));
          if (resume?.sessionId && resume.seq !== undefined) {
            socket.send(JSON.stringify({ op: 6, d: { token: input.accessToken, session_id: resume.sessionId, seq: resume.seq } }));
          } else {
            socket.send(JSON.stringify({ op: 2, d: { token: input.accessToken, intents: 33_281, properties: { os: "linux", browser: "spmt-chat-gateway", device: "spmt-chat-gateway" } } }));
          }
          return;
        }
        if (op === 1) { socket.send(JSON.stringify({ op: 1, d: sequence })); return; }
        if (op === 7) { input.onDisconnect({ kind: "transport", reason: "Discord requested reconnect" }); return; }
        if (op === 9) {
          const resumable = packet.d === true;
          input.onDisconnect({ kind: "transport", reason: resumable ? "Discord session requested resume" : "Discord session became invalid" });
          return;
        }
        if (op !== 0) return;
        const eventType = stringValue(packet.t);
        if (eventType === "READY") {
          const ready = recordValue(packet.d);
          sessionId = stringValue(ready?.session_id) ?? sessionId;
          resumeGatewayUrl = stringValue(ready?.resume_gateway_url) ?? resumeGatewayUrl;
          if (sessionId && sequence !== null) input.onCursor(encodeDiscordCursor({ sessionId, seq: sequence, ...(resumeGatewayUrl ? { resumeGatewayUrl } : {}) }));
          finish();
          return;
        }
        if (eventType === "RESUMED") { finish(); return; }
        if (sessionId && sequence !== null) input.onCursor(encodeDiscordCursor({ sessionId, seq: sequence, ...(resumeGatewayUrl ? { resumeGatewayUrl } : {}) }));
        if (eventType !== "MESSAGE_CREATE") return;
        const envelope = parseDiscordMessage(packet.d, input.connection);
        if (envelope) void Promise.resolve(input.onEnvelope(envelope)).catch(() => undefined);
      });
      socket.addEventListener("error", () => finish(new Error("Discord Gateway transport failed during handshake")));
      socket.addEventListener("close", (event) => {
        if (heartbeat) clearInterval(heartbeat);
        this.active.delete(key);
        if (!settled) finish(new Error("Discord Gateway closed during handshake"));
        if (!intentionallyClosed && settled) input.onDisconnect({ kind: discordCloseIsAuthentication(event.code) ? "authentication" : "transport", reason: safeCloseReason("Discord Gateway", event) });
      });
    });

    this.active.set(key, { connection: input.connection, socket, accessToken: input.accessToken, grantMetadata: input.grantMetadata });
    return {
      close: () => {
        intentionallyClosed = true;
        if (heartbeat) clearInterval(heartbeat);
        this.active.delete(key);
        safeSocketClose(socket, 1000, "supervisor stop");
      },
    };
  }

  async send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }> {
    const active = this.active.get(connectionKey(message));
    if (!active) throw new Error("Discord chat connection is unavailable");
    const body: Record<string, unknown> = {
      content: sanitizeChatText(message.text),
      nonce: message.idempotencyKey,
      enforce_nonce: true,
    };
    if (message.replyToMessageId) body.message_reference = { message_id: message.replyToMessageId, channel_id: message.channelId, fail_if_not_exists: false };
    const response = await this.fetchImpl(`${DISCORD_API_ORIGIN}/channels/${encodeURIComponent(message.channelId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${active.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Discord chat send failed with status ${response.status}`);
    const payload = recordValue(await response.json());
    const providerMessageId = stringValue(payload?.id);
    if (!providerMessageId) throw new Error("Discord chat send returned no message id");
    return { providerMessageId };
  }
}

export class KickPusherProviderDriver implements ProviderConnectionDriverV1, ChatProviderSenderV1 {
  readonly provider = "kick" as const;
  private readonly active = new Map<string, ActiveConnection>();
  private readonly websocketFactory: ChatWebSocketFactory;
  private readonly fetchImpl: ProviderFetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(dependencies: ProviderDriverDependencies = {}) {
    this.websocketFactory = dependencies.websocketFactory ?? defaultWebSocketFactory;
    this.fetchImpl = dependencies.fetch ?? defaultProviderFetch;
    this.timeoutMs = normalizeTimeout(dependencies.handshakeTimeoutMs);
    this.now = dependencies.now ?? (() => new Date());
  }

  async open(input: DriverOpenInput): Promise<ProviderConnectionHandleV1> {
    const socket = this.websocketFactory(KICK_PUSHER_WEBSOCKET_URL);
    const key = connectionKey(input.connection);
    const chatroomId = requireMetadata(input.grantMetadata.chatroomId ?? input.grantMetadata.broadcasterUserId ?? input.connection.channelId, "Kick chatroom id");
    const pusherChannel = `chatrooms.${chatroomId}.v2`;
    let intentionallyClosed = false;
    let settled = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Kick Pusher handshake timed out")), this.timeoutMs);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      socket.addEventListener("message", (event) => {
        const packet = parseJsonRecord(socketText(event.data));
        if (!packet) return;
        const eventName = stringValue(packet.event);
        if (eventName === "pusher:connection_established") {
          socket.send(JSON.stringify({ event: "pusher:subscribe", data: { auth: "", channel: pusherChannel } }));
          return;
        }
        if (eventName === "pusher:ping") { socket.send(JSON.stringify({ event: "pusher:pong", data: {} })); return; }
        if (eventName === "pusher:subscription_succeeded") { finish(); return; }
        if (eventName === "pusher:subscription_error") {
          const data = parsePossiblyJson(packet.data);
          const status = numberValue(recordValue(data)?.status);
          finish(new Error(status === 401 || status === 403 ? "Kick authorization rejected" : "Kick chat subscription failed"));
          return;
        }
        if (eventName !== "App\\Events\\ChatMessageEvent") return;
        const data = parsePossiblyJson(packet.data);
        const envelope = parseKickMessage(data, input.connection, this.now());
        if (!envelope) return;
        input.onCursor(envelope.messageId);
        void Promise.resolve(input.onEnvelope(envelope)).catch(() => undefined);
      });
      socket.addEventListener("error", () => finish(new Error("Kick Pusher transport failed during handshake")));
      socket.addEventListener("close", (event) => {
        this.active.delete(key);
        if (!settled) finish(new Error("Kick Pusher closed during handshake"));
        if (!intentionallyClosed && settled) input.onDisconnect({ kind: "transport", reason: safeCloseReason("Kick Pusher", event) });
      });
    });

    this.active.set(key, { connection: input.connection, socket, accessToken: input.accessToken, grantMetadata: input.grantMetadata });
    return {
      close: () => {
        intentionallyClosed = true;
        this.active.delete(key);
        safeSocketClose(socket, 1000, "supervisor stop");
      },
    };
  }

  async send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }> {
    const active = this.active.get(connectionKey(message));
    if (!active) throw new Error("Kick chat connection is unavailable");
    const broadcasterUserId = requireMetadata(active.grantMetadata.broadcasterUserId ?? active.connection.providerAccountId, "Kick broadcaster user id");
    const response = await this.fetchImpl(KICK_CHAT_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${active.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: sanitizeChatText(message.text), type: "user", broadcaster_user_id: numericOrString(broadcasterUserId) }),
    });
    if (!response.ok) throw new Error(`Kick chat send failed with status ${response.status}`);
    let providerMessageId = `kick:${message.idempotencyKey}`;
    try {
      const payload = recordValue(await response.json());
      providerMessageId = stringValue(payload?.id) ?? stringValue(recordValue(payload?.data)?.id) ?? providerMessageId;
    } catch { /* Kick may return an empty success body. */ }
    return { providerMessageId };
  }
}

export function createFirstPartyChatProviderAdapters(dependencies: ProviderDriverDependencies = {}): {
  drivers: ProviderConnectionDriverV1[];
  senders: ChatProviderSenderV1[];
  twitch: TwitchIrcProviderDriver;
  discord: DiscordGatewayProviderDriver;
  kick: KickPusherProviderDriver;
} {
  const twitch = new TwitchIrcProviderDriver(dependencies);
  const discord = new DiscordGatewayProviderDriver(dependencies);
  const kick = new KickPusherProviderDriver(dependencies);
  return { drivers: [twitch, discord, kick], senders: [twitch, discord, kick], twitch, discord, kick };
}

export interface DiscordResumeCursorV1 { sessionId: string; seq: number; resumeGatewayUrl?: string; }
export function encodeDiscordCursor(cursor: DiscordResumeCursorV1): string {
  if (!cursor.sessionId || !Number.isSafeInteger(cursor.seq) || cursor.seq < 0) throw new Error("Discord resume cursor is invalid");
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
export function decodeDiscordCursor(cursor?: string): DiscordResumeCursorV1 | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    const record = recordValue(parsed);
    const sessionId = stringValue(record?.sessionId);
    const seq = numberValue(record?.seq);
    const resumeGatewayUrl = stringValue(record?.resumeGatewayUrl);
    if (!sessionId || seq === undefined || !Number.isSafeInteger(seq) || seq < 0) return undefined;
    return { sessionId, seq, ...(resumeGatewayUrl ? { resumeGatewayUrl } : {}) };
  } catch { return undefined; }
}

function parseTwitchPrivmsg(line: string, connection: ProviderConnectionConfigV1, now: Date): ProviderChatEnvelopeV1 | undefined {
  const match = /^(?:@([^ ]+) )?:([^! ]+)!.* PRIVMSG #([^ ]+) :(.*)$/.exec(line);
  if (!match) return undefined;
  const tags = parseIrcTags(match[1] ?? "");
  const username = match[2] ?? "";
  const channel = match[3] ?? connection.channelId;
  const text = match[4] ?? "";
  const providerUserId = tags["user-id"] ?? username;
  const messageId = tags.id ?? `twitch-${Date.parse(tags["tmi-sent-ts"] ? new Date(Number(tags["tmi-sent-ts"])).toISOString() : now.toISOString()).toString(36)}-${providerUserId}`;
  const badges = new Set((tags.badges ?? "").split(",").map((entry) => entry.split("/")[0]).filter(Boolean));
  const roles: Array<"broadcaster" | "moderator" | "member"> = ["member"];
  if (badges.has("broadcaster")) roles.unshift("broadcaster");
  else if (badges.has("moderator") || tags.mod === "1") roles.unshift("moderator");
  const occurredAt = tags["tmi-sent-ts"] && Number.isFinite(Number(tags["tmi-sent-ts"])) ? new Date(Number(tags["tmi-sent-ts"])).toISOString() : now.toISOString();
  return {
    schemaVersion: 1,
    tenantId: connection.tenantId,
    provider: "twitch",
    connectionId: connection.connectionId,
    channelId: channel,
    ...(tags["source-room-id"] ? { sourceChannelId: tags["source-room-id"] } : {}),
    messageId,
    text,
    occurredAt,
    providerUserId,
    username,
    ...(tags["display-name"] ? { displayName: tags["display-name"] } : {}),
    isBot: badges.has("bot"),
    roles,
    mentions: [],
  };
}

function parseDiscordMessage(value: unknown, connection: ProviderConnectionConfigV1): ProviderChatEnvelopeV1 | undefined {
  const message = recordValue(value);
  if (!message || stringValue(message.channel_id) !== connection.channelId) return undefined;
  const content = stringValue(message.content);
  const id = stringValue(message.id);
  const author = recordValue(message.author);
  const providerUserId = stringValue(author?.id);
  const username = stringValue(author?.username);
  const timestamp = stringValue(message.timestamp);
  if (!content || !id || !providerUserId || !username || !timestamp || !Number.isFinite(Date.parse(timestamp))) return undefined;
  const mentions = Array.isArray(message.mentions) ? message.mentions.flatMap((item) => {
    const mention = recordValue(item);
    const mentionId = stringValue(mention?.id);
    const mentionUsername = stringValue(mention?.username);
    return mentionId && mentionUsername ? [{ token: `<@${mentionId}>`, providerUserId: mentionId, username: mentionUsername }] : [];
  }) : [];
  return {
    schemaVersion: 1,
    tenantId: connection.tenantId,
    provider: "discord",
    connectionId: connection.connectionId,
    channelId: connection.channelId,
    messageId: id,
    text: content,
    occurredAt: new Date(timestamp).toISOString(),
    providerUserId,
    username,
    ...(stringValue(author?.global_name) ? { displayName: stringValue(author?.global_name)! } : {}),
    isBot: author?.bot === true,
    roles: ["member"],
    mentions,
  };
}

function parseKickMessage(value: unknown, connection: ProviderConnectionConfigV1, now: Date): ProviderChatEnvelopeV1 | undefined {
  const message = recordValue(value);
  const sender = recordValue(message?.sender);
  const id = stringValue(message?.id);
  const content = stringValue(message?.content);
  const providerUserId = stringValue(sender?.id) ?? stringValue(sender?.user_id);
  const username = stringValue(sender?.slug) ?? stringValue(sender?.username);
  if (!id || !content || !providerUserId || !username) return undefined;
  const badges = new Set<string>();
  const identity = recordValue(sender?.identity);
  if (Array.isArray(identity?.badges)) for (const item of identity.badges) { const type = stringValue(recordValue(item)?.type); if (type) badges.add(type); }
  const roles: Array<"broadcaster" | "moderator" | "member"> = ["member"];
  if (badges.has("broadcaster")) roles.unshift("broadcaster");
  else if (badges.has("moderator")) roles.unshift("moderator");
  const createdAt = stringValue(message?.created_at);
  const occurredAt = createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt).toISOString() : now.toISOString();
  return {
    schemaVersion: 1,
    tenantId: connection.tenantId,
    provider: "kick",
    connectionId: connection.connectionId,
    channelId: connection.channelId,
    messageId: id,
    text: content,
    occurredAt,
    providerUserId,
    username,
    ...(stringValue(sender?.username) ? { displayName: stringValue(sender?.username)! } : {}),
    isBot: badges.has("bot"),
    roles,
    mentions: [],
  };
}

function parseIrcTags(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of raw.split(";")) {
    if (!field) continue;
    const split = field.indexOf("=");
    const key = split < 0 ? field : field.slice(0, split);
    const value = split < 0 ? "" : field.slice(split + 1);
    result[key] = value.replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  return result;
}

function defaultWebSocketFactory(url: string): ChatWebSocketLike {
  const ctor = (globalThis as unknown as { WebSocket?: new (url: string) => ChatWebSocketLike }).WebSocket;
  if (!ctor) throw new Error("WebSocket is unavailable in this runtime");
  return new ctor(url);
}

async function defaultProviderFetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<ProviderHttpResponseLike> {
  const fetchImpl = (globalThis as unknown as { fetch?: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<ProviderHttpResponseLike> }).fetch;
  if (!fetchImpl) throw new Error("fetch is unavailable in this runtime");
  return fetchImpl(url, init);
}

function normalizeTimeout(value?: number): number {
  const timeout = value ?? 20_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120_000) throw new Error("Provider handshake timeout is invalid");
  return timeout;
}
function connectionKey(value: Pick<ProviderConnectionConfigV1, "tenantId" | "provider" | "connectionId">): string { return `${value.tenantId}:${value.provider}:${value.connectionId}`; }
function normalizeTwitchChannel(channelId: string): string { const value = channelId.replace(/^#/, "").trim().toLowerCase(); if (!/^[a-z0-9_]{1,50}$/.test(value)) throw new Error("Twitch channel is invalid"); return value; }
function stripOauthPrefix(value: string): string { const token = value.replace(/^oauth:/i, ""); if (!token || /[\r\n\s]/.test(token)) throw new Error("Twitch access token is invalid"); return token; }
function requireMetadata(value: string | undefined, name: string): string { if (!value || value.trim() !== value || value.length > 300 || /[\r\n]/.test(value)) throw new Error(`${name} is invalid`); return value; }
function sanitizeChatText(value: string): string { const text = value.replace(/[\r\n]+/g, " ").trim(); if (!text) throw new Error("Chat text is empty"); return text.slice(0, 8_000); }
function socketText(value: unknown): string { if (typeof value === "string") return value; if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8"); if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8"); return String(value ?? ""); }
function parseJsonRecord(value: string): Record<string, unknown> | undefined { try { return recordValue(JSON.parse(value)); } catch { return undefined; } }
function parsePossiblyJson(value: unknown): unknown { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value; } }
function recordValue(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function numericOrString(value: string): number | string { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : value; }
function stripQuery(value: string): string { return value.replace(/[/?]+$/, "").replace(/\?.*$/, ""); }
function safeSocketClose(socket: ChatWebSocketLike, code: number, reason: string): void { try { socket.close(code, reason); } catch { /* already closed */ } }
function safeCloseReason(provider: string, event: ChatWebSocketEventLike): string { const code = event.code ?? 1006; const reason = typeof event.reason === "string" && event.reason ? event.reason.slice(0, 200) : "connection closed"; return `${provider} closed (${code}): ${reason}`; }
function twitchCloseIsAuthentication(code?: number): boolean { return code === 1008 || code === 4001; }
function discordCloseIsAuthentication(code?: number): boolean { return code === 4003 || code === 4004 || code === 4013 || code === 4014; }
