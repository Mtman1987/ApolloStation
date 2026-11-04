export type HearMeOutDiscordGrantKindV1 = "user-oauth" | "bot";
export interface HearMeOutDiscordGrantV1 {
  authorization: string;
  expiresAt?: string;
  scopes?: string[];
}
export interface HearMeOutDiscordGrantSourceV1 {
  getGrant(input: { tenantId: string; kind: HearMeOutDiscordGrantKindV1; capability: string }): Promise<HearMeOutDiscordGrantV1>;
}

export interface HearMeOutDiscordAdapterOptionsV1 {
  grants: HearMeOutDiscordGrantSourceV1;
  fetchImpl?: typeof fetch;
  apiOrigin?: string;
}

/**
 * Provider-facing replacement for the donor's Discord route family. Tokens are
 * requested per operation and only sent in Authorization headers; they are not
 * returned, logged, cached, or stored by HearMeOut.
 */
export class HearMeOutDiscordAdapter {
  private readonly grants: HearMeOutDiscordGrantSourceV1;
  private readonly fetchImpl: typeof fetch;
  private readonly apiOrigin: string;
  constructor(options: HearMeOutDiscordAdapterOptionsV1) {
    this.grants = options.grants;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const origin = new URL(options.apiOrigin ?? "https://discord.com/api/v10");
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash) throw new Error("Discord API origin must be credential-free HTTPS");
    this.apiOrigin = origin.toString().replace(/\/$/, "");
  }

  listGuilds(tenantId: string) { return this.request(tenantId, "user-oauth", "guilds:read", "/users/@me/guilds"); }
  getCurrentUser(tenantId: string) { return this.request(tenantId, "user-oauth", "profile:read", "/users/@me"); }
  listGuildChannels(tenantId: string, guildId: string) { return this.request(tenantId, "bot", "channels:read", `/guilds/${snowflake(guildId, "guildId")}/channels`); }
  listMessages(tenantId: string, channelId: string, limit = 50) {
    const safeLimit = boundedInteger(limit, 1, 100, "limit");
    return this.request(tenantId, "bot", "messages:read", `/channels/${snowflake(channelId, "channelId")}/messages?limit=${safeLimit}`);
  }
  sendMessage(tenantId: string, channelId: string, content: string, replyToMessageId?: string) {
    const text = boundedText(content, 1, 2000, "content");
    return this.request(tenantId, "bot", "messages:write", `/channels/${snowflake(channelId, "channelId")}/messages`, {
      method: "POST",
      body: {
        content: text,
        ...(replyToMessageId ? { message_reference: { message_id: snowflake(replyToMessageId, "replyToMessageId") } } : {}),
        allowed_mentions: { parse: [] },
      },
    });
  }
  postEmbed(tenantId: string, channelId: string, embed: Record<string, unknown>, content?: string) {
    if (!embed || typeof embed !== "object" || Array.isArray(embed)) throw new Error("embed must be an object");
    return this.request(tenantId, "bot", "messages:write", `/channels/${snowflake(channelId, "channelId")}/messages`, {
      method: "POST",
      body: { ...(content ? { content: boundedText(content, 1, 2000, "content") } : {}), embeds: [embed], allowed_mentions: { parse: [] } },
    });
  }
  createInvite(tenantId: string, channelId: string, options: { maxAgeSeconds?: number; maxUses?: number; temporary?: boolean } = {}) {
    const maxAge = options.maxAgeSeconds === undefined ? 3600 : boundedInteger(options.maxAgeSeconds, 0, 604800, "maxAgeSeconds");
    const maxUses = options.maxUses === undefined ? 1 : boundedInteger(options.maxUses, 0, 100, "maxUses");
    return this.request(tenantId, "bot", "invites:write", `/channels/${snowflake(channelId, "channelId")}/invites`, {
      method: "POST",
      body: { max_age: maxAge, max_uses: maxUses, temporary: options.temporary ?? false, unique: true },
    });
  }
  deleteMessage(tenantId: string, channelId: string, messageId: string) {
    return this.request(tenantId, "bot", "messages:write", `/channels/${snowflake(channelId, "channelId")}/messages/${snowflake(messageId, "messageId")}`, { method: "DELETE" });
  }

  private async request(tenantId: string, kind: HearMeOutDiscordGrantKindV1, capability: string, path: string, options: { method?: string; body?: unknown } = {}) {
    if (!tenantId?.trim()) throw new Error("tenantId is required");
    const grant = await this.grants.getGrant({ tenantId, kind, capability });
    if (!grant?.authorization || /[\r\n]/.test(grant.authorization)) throw new Error("Discord grant is unavailable");
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) throw new Error("Discord grant is expired");
    const response = await this.fetchImpl(`${this.apiOrigin}${path}`, {
      method: options.method ?? "GET",
      headers: {
        authorization: grant.authorization,
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (response.status === 204) return undefined;
    const text = await response.text();
    let body: unknown = undefined;
    if (text) { try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 500) }; } }
    if (!response.ok) throw new HearMeOutDiscordError(response.status, body);
    return body;
  }
}

export class HearMeOutDiscordError extends Error {
  constructor(public readonly status: number, public readonly responseBody: unknown) {
    super(`Discord request failed with status ${status}`);
    this.name = "HearMeOutDiscordError";
  }
}

function snowflake(value: string, name: string) { if (!/^\d{5,30}$/.test(value)) throw new Error(`${name} must be a Discord snowflake`); return value; }
function boundedInteger(value: number, min: number, max: number, name: string) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be from ${min} through ${max}`); return value; }
function boundedText(value: string, min: number, max: number, name: string) { if (typeof value !== "string" || value.length < min || value.length > max) throw new Error(`${name} must be ${min}-${max} characters`); return value; }
