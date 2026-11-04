import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService } from "@spmt/auth-core";
import type { ControlService } from "@spmt/control-core";
import type { SqliteProviderCredentialAuthority } from "@spmt/provider-grants-core";
import { normalizeHumanReferenceInputs, type HumanReferenceInputV1, type HumanReferenceV1 } from "@spmt/contracts/human-reference";

type FetchLike = typeof fetch;
type CredentialAuthority = Pick<SqliteProviderCredentialAuthority, "list" | "resolve">;

type CacheEntry = { expiresAt: number; value: HumanReferenceV1 };

/**
 * Tenant-bound presentation resolver. Provider ids remain canonical data; this service only
 * returns readable companions for UI/log presentation. It never resolves a Discord user
 * globally: user lookup requires tenant-observed label data or guild membership context.
 */
export class HumanReferenceService {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly options: { credentials?: CredentialAuthority; fetchImpl?: FetchLike; now?: () => number }) {}

  async resolveMany(tenantId: string, inputs: readonly HumanReferenceInputV1[]): Promise<HumanReferenceV1[]> {
    const normalized = normalizeHumanReferenceInputs(inputs);
    return Promise.all(normalized.map((input) => this.resolveOne(tenantId, input)));
  }

  private async resolveOne(tenantId: string, input: HumanReferenceInputV1): Promise<HumanReferenceV1> {
    if (input.labelHint) return this.fallback(input, input.labelHint, true);
    const key = [tenantId, input.provider ?? "", input.kind, input.id, input.guildId ?? "", input.channelId ?? ""].join(":");
    const now = this.options.now?.() ?? Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return structuredClone(cached.value);
    let value: HumanReferenceV1 | undefined;
    if ((input.provider ?? "").toLowerCase() === "discord") value = await this.resolveDiscord(tenantId, input);
    value ??= this.fallback(input, fallbackLabel(input), Boolean(input.textHint));
    if (value.resolved) this.cache.set(key, { expiresAt: now + 5 * 60_000, value: structuredClone(value) });
    if (this.cache.size > 2_000) for (const [cacheKey, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(cacheKey);
    return value;
  }

  private async resolveDiscord(tenantId: string, input: HumanReferenceInputV1): Promise<HumanReferenceV1 | undefined> {
    if (!this.options.credentials) return undefined;
    const projections = this.options.credentials.list(tenantId)
      .filter((item) => item.provider === "discord" && item.state === "ready")
      .sort((a, b) => Number(b.metadata.authorizationScheme === "Bot") - Number(a.metadata.authorizationScheme === "Bot"));
    for (const projection of projections) {
      const credential = await this.options.credentials.resolve({ tenantId, provider: "discord", providerUserId: projection.providerUserId }).catch(() => undefined);
      if (!credential) continue;
      const scheme = credential.metadata.authorizationScheme === "Bearer" ? "Bearer" : "Bot";
      const authorization = `${scheme} ${credential.accessToken}`;
      const resolved = await this.resolveDiscordWithAuthorization(input, authorization).catch(() => undefined);
      if (resolved) return resolved;
    }
    return undefined;
  }

  private async resolveDiscordWithAuthorization(input: HumanReferenceInputV1, authorization: string): Promise<HumanReferenceV1 | undefined> {
    if (input.kind === "guild") return this.discordGuild(input, authorization);
    if (input.kind === "channel") return this.discordChannel(input, authorization);
    if (input.kind === "message") return this.discordMessage(input, authorization);
    if (input.kind === "user") return input.guildId || input.channelId ? this.discordMember(input, authorization) : undefined;
    return (await this.discordChannel({ ...input, kind: "channel" }, authorization))
      ?? (await this.discordGuild({ ...input, kind: "guild" }, authorization));
  }

  private async discordGuild(input: HumanReferenceInputV1, authorization: string): Promise<HumanReferenceV1 | undefined> {
    const guild = await this.discordGet(`/guilds/${encodeURIComponent(input.id)}`, authorization);
    if (!guild) return undefined;
    const name = text(guild.name);
    if (!name) return undefined;
    return { schemaVersion: 1, ...input, kind: "guild", label: name, resolved: true, url: `https://discord.com/channels/${input.id}` };
  }

  private async discordChannel(input: HumanReferenceInputV1, authorization: string): Promise<HumanReferenceV1 | undefined> {
    const channel = await this.discordGet(`/channels/${encodeURIComponent(input.id)}`, authorization);
    if (!channel) return undefined;
    const guildId = text(channel.guild_id) ?? input.guildId;
    const name = text(channel.name);
    const recipients = Array.isArray(channel.recipients) ? channel.recipients.filter(record) : [];
    const dmName = recipients.map((item) => text(item.global_name) ?? text(item.username)).filter(Boolean).join(", ");
    const label = name ? `#${name}` : dmName ? `DM with ${dmName}` : "Discord channel";
    const guild = guildId ? await this.discordGet(`/guilds/${encodeURIComponent(guildId)}`, authorization) : undefined;
    const guildName = guild ? text(guild.name) : undefined;
    return {
      schemaVersion: 1, ...input, kind: "channel", label, resolved: true,
      ...(guildId ? { guildId } : {}),
      ...(guildName ? { secondary: guildName } : {}),
      ...(guildId ? { url: `https://discord.com/channels/${guildId}/${input.id}` } : {}),
    };
  }

  private async discordMember(input: HumanReferenceInputV1, authorization: string): Promise<HumanReferenceV1 | undefined> {
    let guildId = input.guildId;
    if (!guildId && input.channelId) {
      const channel = await this.discordChannel({ provider: "discord", kind: "channel", id: input.channelId }, authorization);
      guildId = channel?.guildId;
    }
    if (!guildId) return undefined;
    const member = await this.discordGet(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(input.id)}`, authorization);
    if (!member) return undefined;
    const user = record(member.user);
    const label = text(member.nick) ?? (user ? text(user.global_name) ?? text(user.username) : undefined);
    if (!label) return undefined;
    const guild = await this.discordGet(`/guilds/${encodeURIComponent(guildId)}`, authorization);
    return { schemaVersion: 1, ...input, kind: "user", guildId, label, resolved: true, ...(guild && text(guild.name) ? { secondary: text(guild.name)! } : {}) };
  }

  private async discordMessage(input: HumanReferenceInputV1, authorization: string): Promise<HumanReferenceV1 | undefined> {
    if (!input.channelId) return input.textHint ? this.fallback(input, messageLabel(input.textHint), true) : undefined;
    const message = await this.discordGet(`/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.id)}`, authorization);
    if (!message) return input.textHint ? this.fallback(input, messageLabel(input.textHint), true) : undefined;
    const content = text(message.content) ?? input.textHint ?? "";
    const channelRef = await this.discordChannel({ provider: "discord", kind: "channel", id: input.channelId, ...(input.guildId ? { guildId: input.guildId } : {}) }, authorization);
    const author = record(message.author);
    const authorName = author ? text(author.global_name) ?? text(author.username) : undefined;
    const guildId = channelRef?.guildId ?? input.guildId;
    const secondary = [authorName ? `by ${authorName}` : undefined, channelRef ? `in ${channelRef.label}` : undefined, channelRef?.secondary].filter(Boolean).join(" · ");
    return {
      schemaVersion: 1, ...input, kind: "message", label: messageLabel(content), resolved: true,
      ...(guildId ? { guildId } : {}),
      ...(secondary ? { secondary } : {}),
      ...(guildId ? { url: `https://discord.com/channels/${guildId}/${input.channelId}/${input.id}` } : {}),
    };
  }

  private async discordGet(path: string, authorization: string): Promise<Record<string, unknown> | undefined> {
    const response = await (this.options.fetchImpl ?? fetch)(`https://discord.com/api/v10${path}`, { headers: { authorization, accept: "application/json" } });
    if (!response.ok) return undefined;
    const value = await response.json().catch(() => undefined);
    return record(value);
  }

  private fallback(input: HumanReferenceInputV1, label: string, resolved: boolean): HumanReferenceV1 {
    return { schemaVersion: 1, ...input, label, resolved };
  }
}

export class HumanReferenceApi {
  constructor(private readonly options: { resolver: HumanReferenceService; auth: AuthService; control: ControlService; accessToken(request: IncomingMessage): string | undefined }) {}
  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== "/v1/presentation/references") return false;
    if (request.method !== "POST") return json(response, 405, { message: "Use POST" });
    const token = this.options.accessToken(request), tenantId = String(request.headers["x-spmt-tenant"] ?? "");
    if (!token || !tenantId) return json(response, 401, { message: "Sign in to resolve display references" });
    const principal = this.options.auth.authenticateAccessToken(token);
    if (!principal) return json(response, 401, { message: "Session expired" });
    if (principal.tenantMode !== "any" && !principal.tenantIds.includes(tenantId)) return json(response, 403, { message: "Tenant access denied" });
    const tenant = this.options.control.getTenant(tenantId);
    if (tenant.status !== "active") return json(response, 403, { message: "Tenant is not active" });
    try {
      const body = await readJson(request);
      const references = await this.options.resolver.resolveMany(tenantId, normalizeHumanReferenceInputs(body.references));
      return json(response, 200, { schemaVersion: 1, references });
    } catch (error) {
      return json(response, 400, { message: error instanceof Error ? error.message : "Reference resolution failed" });
    }
  }
}

function fallbackLabel(input: HumanReferenceInputV1): string {
  if (input.kind === "message" && input.textHint) return messageLabel(input.textHint);
  const provider = input.provider ? input.provider[0]!.toUpperCase() + input.provider.slice(1) : "External";
  return `${provider} ${input.kind === "guild" ? "server" : input.kind === "unknown" ? "reference" : input.kind}`;
}
function messageLabel(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const preview = compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
  return preview ? `Message “${preview}”` : "Discord message";
}
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function record(value: unknown): Record<string, any> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined; }
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> { let size = 0; const chunks: Buffer[] = []; for await (const chunk of request) { size += chunk.length; if (size > 128_000) throw new Error("Request is too large"); chunks.push(Buffer.from(chunk)); } const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object"); return value as Record<string, unknown>; }
function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); return true; }
