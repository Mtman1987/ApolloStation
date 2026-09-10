from pathlib import Path

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')

def replace_once(path, old, new):
    content = read(path)
    if new in content:
        return
    if old not in content:
        raise SystemExit(f'Expected patch anchor missing in {path}: {old[:120]!r}')
    write(path, content.replace(old, new, 1))

HUMAN_REFERENCE = r'''export type HumanReferenceKindV1 = "user" | "guild" | "channel" | "message" | "unknown";

export interface HumanReferenceInputV1 {
  provider?: string;
  kind: HumanReferenceKindV1;
  id: string;
  guildId?: string;
  channelId?: string;
  labelHint?: string;
  textHint?: string;
}

export interface HumanReferenceV1 extends HumanReferenceInputV1 {
  schemaVersion: 1;
  label: string;
  resolved: boolean;
  secondary?: string;
  url?: string;
}

export interface HumanReferenceBatchV1 {
  schemaVersion: 1;
  references: HumanReferenceV1[];
}

const ID = /^[A-Za-z0-9:_-]{1,300}$/;
const PROVIDER = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const DISCORD_ID = /^\d{5,30}$/;

export function normalizeHumanReferenceInputs(value: unknown): HumanReferenceInputV1[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error("Reference batch must contain at most 200 items");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Reference ${index + 1} is invalid`);
    const raw = item as Record<string, unknown>;
    const kind = raw.kind;
    if (!(["user", "guild", "channel", "message", "unknown"] as const).includes(kind as HumanReferenceKindV1)) throw new Error(`Reference ${index + 1} kind is invalid`);
    const id = clean(raw.id, "id", 300);
    if (!ID.test(id)) throw new Error(`Reference ${index + 1} id is invalid`);
    const provider = optional(raw.provider, 64);
    if (provider && !PROVIDER.test(provider)) throw new Error(`Reference ${index + 1} provider is invalid`);
    const guildId = optional(raw.guildId, 300), channelId = optional(raw.channelId, 300);
    const labelHint = optional(raw.labelHint, 200), textHint = optional(raw.textHint, 500);
    return {
      kind: kind as HumanReferenceKindV1,
      id,
      ...(provider ? { provider: provider.toLowerCase() } : {}),
      ...(guildId ? { guildId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(labelHint ? { labelHint } : {}),
      ...(textHint ? { textHint } : {}),
    };
  });
}

/** Stable within a tenant-scoped response/cache. Tenant id belongs outside this portable key. */
export function humanReferenceKey(input: Pick<HumanReferenceInputV1, "provider" | "kind" | "id" | "guildId" | "channelId">): string {
  return [input.provider ?? "", input.kind, input.id, input.guildId ?? "", input.channelId ?? ""].join(":");
}

/**
 * Extract only context-labelled opaque identifiers. We intentionally do not turn every long
 * number into a Discord lookup: logs contain timestamps, counters, transaction ids and money.
 */
export function discoverHumanReferencesInText(text: string): HumanReferenceInputV1[] {
  if (!text) return [];
  const refs: HumanReferenceInputV1[] = [];
  const add = (kind: HumanReferenceKindV1, id: string, provider = "discord") => {
    if (DISCORD_ID.test(id)) refs.push({ provider, kind, id });
  };
  const patterns: Array<[HumanReferenceKindV1, RegExp]> = [
    ["guild", /\b(?:guild|server)(?:[\s_-]*id)?\b\s*["']?\s*[:=#-]?\s*["']?(\d{5,30})/gi],
    ["channel", /\b(?:channel|room)(?:[\s_-]*id)?\b\s*["']?\s*[:=#-]?\s*["']?(\d{5,30})/gi],
    ["message", /\b(?:message|msg)(?:[\s_-]*id)?\b\s*["']?\s*[:=#-]?\s*["']?(\d{5,30})/gi],
    ["user", /\b(?:provider[\s_-]*user|user|member|author|sender|recipient)(?:[\s_-]*id)?\b\s*["']?\s*[:=#-]?\s*["']?(\d{5,30})/gi],
  ];
  for (const [kind, pattern] of patterns) for (const match of text.matchAll(pattern)) if (match[1]) add(kind, match[1]);
  for (const match of text.matchAll(/<@!?(\d{5,30})>/g)) if (match[1]) add("user", match[1]);
  for (const match of text.matchAll(/<#(\d{5,30})>/g)) if (match[1]) add("channel", match[1]);

  const unique = [...new Map(refs.map((ref) => [humanReferenceKey(ref), ref])).values()];
  const channels = unique.filter((ref) => ref.kind === "channel");
  const guilds = unique.filter((ref) => ref.kind === "guild");
  const onlyChannel = channels.length === 1 ? channels[0]!.id : undefined;
  const onlyGuild = guilds.length === 1 ? guilds[0]!.id : undefined;
  return unique.map((ref) => ({
    ...ref,
    ...(onlyGuild && ref.kind !== "guild" && !ref.guildId ? { guildId: onlyGuild } : {}),
    ...(onlyChannel && ref.kind === "message" && !ref.channelId ? { channelId: onlyChannel } : {}),
  }));
}

export function humanizeTextWithReferences(text: string, references: readonly HumanReferenceV1[]): string {
  let result = text;
  const byId = new Map<string, HumanReferenceV1>();
  for (const ref of references) {
    const current = byId.get(ref.id);
    if (!current || (!current.resolved && ref.resolved)) byId.set(ref.id, ref);
  }
  for (const ref of [...byId.values()].sort((a, b) => b.id.length - a.id.length)) {
    const label = `${ref.label}${ref.secondary ? ` (${ref.secondary})` : ""}`;
    result = result.replace(new RegExp(escapeRegExp(ref.id), "g"), label);
  }
  return result;
}

function clean(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error(`Reference ${name} is invalid`);
  return value.trim();
}
function optional(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error("Reference text is invalid");
  return value.trim() || undefined;
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
'''
write('packages/contracts/src/human-reference.ts', HUMAN_REFERENCE)

replace_once(
    'packages/contracts/package.json',
    '    "./surface": { "types": "./dist/surface.d.ts", "default": "./dist/surface.js" }',
    '    "./surface": { "types": "./dist/surface.d.ts", "default": "./dist/surface.js" },\n    "./human-reference": { "types": "./dist/human-reference.d.ts", "default": "./dist/human-reference.js" }'
)

HUMAN_REFERENCE_API = r'''import type { IncomingMessage, ServerResponse } from "node:http";
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
    if (input.kind === "user") return input.guildId ? this.discordMember(input, authorization) : undefined;
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
    if (!input.guildId) return undefined;
    const member = await this.discordGet(`/guilds/${encodeURIComponent(input.guildId)}/members/${encodeURIComponent(input.id)}`, authorization);
    if (!member) return undefined;
    const user = record(member.user);
    const label = text(member.nick) ?? (user ? text(user.global_name) ?? text(user.username) : undefined);
    if (!label) return undefined;
    const guild = await this.discordGet(`/guilds/${encodeURIComponent(input.guildId)}`, authorization);
    return { schemaVersion: 1, ...input, kind: "user", label, resolved: true, ...(guild && text(guild.name) ? { secondary: text(guild.name)! } : {}) };
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
'''
write('apps/spmt-service/src/human-reference-api.ts', HUMAN_REFERENCE_API)

# SDK: expose one canonical batch resolver to every app.
sdk = read('packages/sdk/src/index.ts')
if '@spmt/contracts/human-reference' not in sdk:
    sdk = 'import type { HumanReferenceBatchV1, HumanReferenceInputV1 } from "@spmt/contracts/human-reference";\n' + sdk
anchor = '  getSession(){return this.request<Record<string,unknown>>("/v1/session");}'
method = '  resolveHumanReferences(tenantId:string,references:HumanReferenceInputV1[]){return this.request<HumanReferenceBatchV1>("/v1/presentation/references",{method:"POST",tenantId,headers:{"content-type":"application/json"},body:JSON.stringify({references})});}\n'
if method not in sdk:
    if anchor not in sdk:
        raise SystemExit('SDK getSession anchor missing')
    sdk = sdk.replace(anchor, method + anchor, 1)
write('packages/sdk/src/index.ts', sdk)

# SPMT service: instantiate the resolver once and put it ahead of product APIs.
service = read('apps/spmt-service/src/index.ts')
if 'HumanReferenceApi' not in service:
    service = service.replace('import {TwitchBotApi,parseTwitchBotRoles,type TwitchBotRole} from "./twitch-bot-api.js";\n', 'import { HumanReferenceApi, HumanReferenceService } from "./human-reference-api.js";\nimport {TwitchBotApi,parseTwitchBotRoles,type TwitchBotRole} from "./twitch-bot-api.js";\n', 1)
credential_anchor = '  const providerCredentials = options.providerCredentialKey ? new SqliteProviderCredentialAuthority(options.databasePath, options.providerCredentialKey, createFirstPartyProviderRefreshAdapters(fetchImpl), { ...(options.providerOAuthClients ? { clients: options.providerOAuthClients } : {}) }) : undefined;\n'
if 'const humanReferenceResolver =' not in service:
    if credential_anchor not in service:
        raise SystemExit('SPMT provider credential anchor missing')
    service = service.replace(credential_anchor, credential_anchor + '  const humanReferenceResolver = new HumanReferenceService({ ...(providerCredentials ? { credentials: providerCredentials } : {}), fetchImpl });\n  const humanReferenceApi = new HumanReferenceApi({ resolver: humanReferenceResolver, auth, control, accessToken });\n', 1)
operator_anchor = '  const operatorApi = new CommlinkOperatorApi({store:commlinkOperator,chat:commlinkLiveChat,auth,control,authority,accessToken});'
if 'resolveReferences:(tenant,references)=>humanReferenceResolver.resolveMany(tenant,references)' not in service:
    if operator_anchor not in service:
        raise SystemExit('SPMT operator construction anchor missing')
    service = service.replace(operator_anchor, '  const operatorApi = new CommlinkOperatorApi({store:commlinkOperator,chat:commlinkLiveChat,auth,control,authority,accessToken,resolveReferences:(tenant,references)=>humanReferenceResolver.resolveMany(tenant,references)});', 1)
handle_anchor = '      if (await mediaApi.handle(request, response, url)) return;\n'
if 'humanReferenceApi.handle' not in service:
    if handle_anchor not in service:
        raise SystemExit('SPMT request handle anchor missing')
    service = service.replace(handle_anchor, '      if (await humanReferenceApi.handle(request, response, url)) return;\n' + handle_anchor, 1)
write('apps/spmt-service/src/index.ts', service)

# Commlink operator response gets the same presentation metadata used by the shell.
operator = read('apps/spmt-service/src/commlink-operator-api.ts')
if '@spmt/contracts/human-reference' not in operator:
    operator = operator.replace('import { createHash } from "node:crypto";\n', 'import { createHash } from "node:crypto";\nimport { humanReferenceKey, type HumanReferenceInputV1, type HumanReferenceV1 } from "@spmt/contracts/human-reference";\n', 1)
old_ctor = 'constructor(private readonly options:{store:CommlinkOperatorStore;chat:CommlinkLiveChatStore;auth:AuthService;control:ControlService;authority:AuthorityService;accessToken(request:IncomingMessage):string|undefined}){}'
new_ctor = 'constructor(private readonly options:{store:CommlinkOperatorStore;chat:CommlinkLiveChatStore;auth:AuthService;control:ControlService;authority:AuthorityService;accessToken(request:IncomingMessage):string|undefined;resolveReferences?:(tenantId:string,references:HumanReferenceInputV1[])=>Promise<HumanReferenceV1[]>}){}'
if old_ctor in operator:
    operator = operator.replace(old_ctor, new_ctor, 1)
old_response = '          const retained=Object.values(state.snapshots??{}).filter(m=>!ids.has(m.id));\n          return json(response,200,{state,messages:[...retained,...current],canOperate:workspace.ownerUserId===user});'
new_response = '          const retained=Object.values(state.snapshots??{}).filter(m=>!ids.has(m.id));\n          const messages=[...retained,...current];\n          const references=this.options.resolveReferences?await this.options.resolveReferences(tenant,operatorReferenceInputs(messages)).catch(()=>[]):[];\n          return json(response,200,{state,messages:messages.map(message=>operatorPresentation(message,references)),canOperate:workspace.ownerUserId===user});'
if old_response in operator:
    operator = operator.replace(old_response, new_response, 1)
if 'function operatorReferenceInputs(' not in operator:
    operator += r'''
function operatorReferenceInputs(messages:readonly Record<string,any>[]):HumanReferenceInputV1[]{
  const values:HumanReferenceInputV1[]=[];
  for(const message of messages){const provider=typeof message.provider==="string"?message.provider:undefined;
    if(typeof message.providerUserId==="string"&&message.providerUserId)values.push({provider,kind:"user",id:message.providerUserId,labelHint:String(message.displayName??message.username??"")||undefined});
    if(typeof message.channelId==="string"&&message.channelId)values.push({provider,kind:"channel",id:message.channelId});
    if(typeof message.messageId==="string"&&message.messageId)values.push({provider,kind:"message",id:message.messageId,channelId:typeof message.channelId==="string"?message.channelId:undefined,textHint:typeof message.text==="string"?message.text:undefined});
  }
  return [...new Map(values.map(value=>[humanReferenceKey(value),value])).values()];
}
function operatorPresentation<T extends Record<string,any>>(message:T,references:readonly HumanReferenceV1[]):T&{presentation:Record<string,HumanReferenceV1|undefined>;__humanContext?:string}{
  const find=(kind:HumanReferenceV1["kind"],id:unknown)=>typeof id==="string"?references.find(ref=>ref.kind===kind&&ref.id===id):undefined;
  const actor=find("user",message.providerUserId),channel=find("channel",message.channelId),providerMessage=find("message",message.messageId);
  const context=[channel?.label,channel?.secondary].filter(Boolean).join(" · ");
  return {...message,presentation:{actor,channel,message:providerMessage},...(context?{__humanContext:context}:{})};
}
'''
write('apps/spmt-service/src/commlink-operator-api.ts', operator)

# SpaceMountain fetches a single batch for both Commlink and operations evidence.
shell = read('apps/spacemountain/src/index.ts')
if '@spmt/contracts/human-reference' not in shell:
    shell = shell.replace('import type { AppFrameLaunchV1,', 'import { discoverHumanReferencesInText, humanReferenceKey, humanizeTextWithReferences, type HumanReferenceInputV1, type HumanReferenceV1 } from "@spmt/contracts/human-reference";\nimport type { AppFrameLaunchV1,', 1)
values_anchor = '''    const session = record(values.get("session"));
'''
presentation_block = '''    const rawLiveChat = liveChatRecords(values.get("commlinkLive"));
    const rawOperationsLogs = operationsLogs(values.get("operationsLogs"));
    const referenceInputs = collectHumanReferenceInputs(rawLiveChat, rawOperationsLogs);
    let resolvedReferences: HumanReferenceV1[] = [];
    if (referenceInputs.length && typeof this.spmt.resolveHumanReferences === "function") {
      try { resolvedReferences = (await this.spmt.resolveHumanReferences(input.tenantId, referenceInputs)).references; } catch { /* presentation lookup must never take the shell down */ }
    }
    const presentedLiveChat = presentLiveChat(rawLiveChat, resolvedReferences);
    const presentedOperationsLogs = presentOperationsLogs(rawOperationsLogs, resolvedReferences);

'''
if 'const rawLiveChat = liveChatRecords' not in shell:
    if values_anchor not in shell:
        raise SystemExit('SpaceMountain values anchor missing')
    shell = shell.replace(values_anchor, presentation_block + values_anchor, 1)
shell = shell.replace('      liveChat: liveChatRecords(values.get("commlinkLive")),', '      liveChat: presentedLiveChat,')
shell = shell.replace('logs: operationsLogs(values.get("operationsLogs"))', 'logs: presentedOperationsLogs')
if 'function collectHumanReferenceInputs(' not in shell:
    shell += r'''

function collectHumanReferenceInputs(liveChat:readonly CommlinkLiveChatRecordV1[],logs:readonly OperationsLogV1[]):HumanReferenceInputV1[]{
  const refs:HumanReferenceInputV1[]=[];
  for(const message of liveChat){
    refs.push({provider:message.provider,kind:"user",id:message.providerUserId,labelHint:message.displayName??message.username});
    refs.push({provider:message.provider,kind:"channel",id:message.channelId});
    refs.push({provider:message.provider,kind:"message",id:message.messageId,channelId:message.channelId,textHint:message.text});
  }
  for(const log of logs){refs.push(...discoverHumanReferencesInText(log.summary));if(log.detail)refs.push(...discoverHumanReferencesInText(log.detail));}
  return [...new Map(refs.map(ref=>[humanReferenceKey(ref),ref])).values()];
}
function presentLiveChat(messages:readonly CommlinkLiveChatRecordV1[],refs:readonly HumanReferenceV1[]):CommlinkLiveChatRecordV1[]{
  return messages.map(message=>{const actor=refs.find(ref=>ref.kind==="user"&&ref.id===message.providerUserId),channel=refs.find(ref=>ref.kind==="channel"&&ref.id===message.channelId),providerMessage=refs.find(ref=>ref.kind==="message"&&ref.id===message.messageId);const context=[channel?.label,channel?.secondary].filter(Boolean).join(" · ");return {...message,presentation:{actor,channel,message:providerMessage},...(context?{__humanContext:context}:{})} as CommlinkLiveChatRecordV1;});
}
function presentOperationsLogs(logs:readonly OperationsLogV1[],refs:readonly HumanReferenceV1[]):OperationsLogV1[]{
  return logs.map(log=>({...log,presentation:{summary:humanizeTextWithReferences(log.summary,refs),...(log.detail?{detail:humanizeTextWithReferences(log.detail,refs)}:{})}} as OperationsLogV1));
}
'''
write('apps/spacemountain/src/index.ts', shell)

# Human-facing renderer consumes presentation fields while keeping raw evidence in memory.
ui = read('apps/spacemountain/src/shell-ui-base.ts')
old_log = '''    const logList = logs.map((item) => `<article class="spmt-ops-log level-${escapeHtml(item.level)}"><div><span class="spmt-record-kind">${escapeHtml(item.sourceAppId)} • ${escapeHtml(item.level)}</span><strong>${escapeHtml(item.summary)}</strong>${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}<small>${escapeHtml(item.kind)} • ${escapeHtml(formatRecordTime(item.occurredAt))}${item.correlationId ? ` • ${escapeHtml(item.correlationId)}` : ""}</small></div>${this.snapshot.operations.canInvokeCoder ? `<button data-coder-log="${escapeHtml(item.id)}">Prepare coder</button>` : ""}</article>`).join("");
'''
new_log = '''    const logList = logs.map((item) => { const presentation=recordObject(item,"presentation"), summary=recordText(presentation,["summary"])??item.summary, detail=recordText(presentation,["detail"])??item.detail; return `<article class="spmt-ops-log level-${escapeHtml(item.level)}"><div><span class="spmt-record-kind">${escapeHtml(item.sourceAppId)} • ${escapeHtml(item.level)}</span><strong>${escapeHtml(summary)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}<small>${escapeHtml(item.kind)} • ${escapeHtml(formatRecordTime(item.occurredAt))}${item.correlationId ? ` • ${escapeHtml(item.correlationId)}` : ""}</small></div>${this.snapshot.operations.canInvokeCoder ? `<button data-coder-log="${escapeHtml(item.id)}">Prepare coder</button>` : ""}</article>`; }).join("");
'''
if new_log not in ui:
    if old_log not in ui:
        raise SystemExit('Operations log renderer anchor missing')
    ui = ui.replace(old_log, new_log, 1)
body_anchor = '  const body = recordText(item, ["text", "body", "content", "summary", "title"]) ?? payloadKeySummary(item.payload);\n'
if 'const context = recordText(item, ["__humanContext"])' not in ui:
    if body_anchor not in ui:
        raise SystemExit('Commlink card body anchor missing')
    ui = ui.replace(body_anchor, body_anchor + '  const context = recordText(item, ["__humanContext"]);\n', 1)
old_time = '<small>${escapeHtml(formatRecordTime(recordText(item, ["occurredAt", "occurred_at", "createdAt", "created_at", "updatedAt", "updated_at"])))}</small>'
new_time = '<small>${context ? `${escapeHtml(context)} · ` : ""}${escapeHtml(formatRecordTime(recordText(item, ["occurredAt", "occurred_at", "createdAt", "created_at", "updatedAt", "updated_at"])))}</small>'
if new_time not in ui:
    if old_time not in ui:
        raise SystemExit('Commlink card timestamp anchor missing')
    ui = ui.replace(old_time, new_time, 1)
write('apps/spacemountain/src/shell-ui-base.ts', ui)

TEST = r'''import test from "node:test";
import assert from "node:assert/strict";
import { discoverHumanReferencesInText, humanizeTextWithReferences, normalizeHumanReferenceInputs } from "../packages/contracts/dist/human-reference.js";
import { HumanReferenceService } from "../apps/spmt-service/dist/human-reference-api.js";

test("human reference discovery requires semantic context and pairs message with channel", () => {
  const refs = discoverHumanReferencesInText('Discord serverId=123456789012345678 channel 223456789012345678 messageId:323456789012345678 user 423456789012345678 total 523456789012345678');
  assert.equal(refs.length, 4);
  assert.equal(refs.find((ref) => ref.kind === "message")?.channelId, "223456789012345678");
  assert.equal(refs.find((ref) => ref.kind === "message")?.guildId, "123456789012345678");
  assert.equal(refs.some((ref) => ref.id === "523456789012345678"), false);
});

test("humanized logs replace opaque ids with resolved labels without changing canonical reference records", () => {
  const text = 'channelId=223456789012345678 messageId=323456789012345678';
  const refs = [
    { schemaVersion:1, provider:"discord", kind:"channel", id:"223456789012345678", label:"#general", secondary:"SpaceMountain", resolved:true },
    { schemaVersion:1, provider:"discord", kind:"message", id:"323456789012345678", channelId:"223456789012345678", label:'Message “hello”', resolved:true },
  ];
  assert.equal(humanizeTextWithReferences(text, refs), 'channelId=#general (SpaceMountain) messageId=Message “hello”');
  assert.equal(refs[0].id, "223456789012345678");
});

test("Discord remote resolution is tenant-scoped and does not perform global user lookups", async () => {
  const listed = [], fetched = [];
  const credentials = {
    list(tenantId) { listed.push(tenantId); return [{ provider:"discord", providerUserId:"bot", state:"ready", metadata:{authorizationScheme:"Bot"} }]; },
    async resolve(input) { assert.equal(input.tenantId, "tenant-a"); return { accessToken:"secret", metadata:{authorizationScheme:"Bot"} }; },
  };
  const fetchImpl = async (url) => { fetched.push(String(url)); if (String(url).endsWith('/channels/223456789012345678')) return new Response(JSON.stringify({id:"223456789012345678",name:"general",guild_id:"123456789012345678"}),{status:200}); if (String(url).endsWith('/guilds/123456789012345678')) return new Response(JSON.stringify({id:"123456789012345678",name:"SpaceMountain"}),{status:200}); return new Response('{}',{status:404}); };
  const service = new HumanReferenceService({ credentials, fetchImpl });
  const [channel] = await service.resolveMany("tenant-a", normalizeHumanReferenceInputs([{provider:"discord",kind:"channel",id:"223456789012345678"}]));
  assert.equal(channel.label, "#general");
  assert.equal(channel.secondary, "SpaceMountain");
  assert.deepEqual(listed, ["tenant-a"]);
  const [user] = await service.resolveMany("tenant-a", [{provider:"discord",kind:"user",id:"423456789012345678"}]);
  assert.equal(user.resolved, false);
  assert.equal(fetched.some((url) => url.includes('/users/423456789012345678')), false);
});
'''
write('tests/human-reference-presentation.test.mjs', TEST)

print('human-reference presentation patch applied')
