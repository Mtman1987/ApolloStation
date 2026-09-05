import { DatabaseSync } from "node:sqlite";
import { STREAMWEAVER_DONOR_COMMANDS, type StreamWeaverDonorCommandFamilyV1, type StreamWeaverDonorCommandV1 } from "./donor-command-catalog.js";

export const STREAMWEAVER_FLOW_PACKAGE_KIND = "streamweaver.flow-package" as const;
export const STREAMWEAVER_FLOW_AUTHOR = Object.freeze({ id: "mtman1987", displayName: "mtman1987" });

export interface StreamWeaverFlowCommandV1 {
  id: string;
  trigger: string;
  aliases: string[];
  family: StreamWeaverDonorCommandFamilyV1 | "custom";
  cooldownSeconds: number;
  matcher: "command" | "regex" | "bare";
  runtime: "donor" | "flow";
  donorId?: string;
  enabled: boolean;
}

export interface StreamWeaverFlowActionV1 {
  id: string;
  type: "send-chat" | "send-discord" | "wait" | "run-action" | "http-request" | "set-variable" | "execute-code" | "obs-scene" | "obs-source";
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface StreamWeaverFlowPackageV1 {
  schemaVersion: 1;
  kind: typeof STREAMWEAVER_FLOW_PACKAGE_KIND;
  packageId: string;
  packageKind: "command_flow" | "action_flow" | "support_flow";
  installUnit: "flow";
  name: string;
  description: string;
  author: { id: string; displayName: string };
  visibility: "private" | "community";
  collection: string;
  tags: string[];
  commands: StreamWeaverFlowCommandV1[];
  actions: StreamWeaverFlowActionV1[];
  createdAt: string;
  updatedAt: string;
}

export interface StreamWeaverFlowInstallV1 {
  schemaVersion: 1;
  tenantId: string;
  packageId: string;
  installedAt: string;
}

export class StreamWeaverFlowPackageStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    if (!path) throw new Error("StreamWeaver flow database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streamweaver_flow_packages(
        package_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK(visibility IN ('private','community')),
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_flow_installs(
        tenant_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        body TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id,package_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS streamweaver_flow_packages_visibility ON streamweaver_flow_packages(visibility,updated_at DESC);
      CREATE INDEX IF NOT EXISTS streamweaver_flow_installs_tenant ON streamweaver_flow_installs(tenant_id,installed_at);
    `);
  }
  close() { this.db.close(); }

  listCommunity() {
    const custom = this.db.prepare("SELECT body FROM streamweaver_flow_packages WHERE visibility='community' ORDER BY updated_at DESC,package_id").all() as Array<{ body: string }>;
    const byId = new Map<string, StreamWeaverFlowPackageV1>(legacyCommunityPackages().map((item) => [item.packageId, item]));
    for (const row of custom) { const value = normalizeFlowPackage(JSON.parse(row.body)); byId.set(value.packageId, value); }
    return [...byId.values()];
  }

  listTenantPackages(tenantId: string) {
    tenantId = identifier(tenantId, "tenantId");
    const privateRows = this.db.prepare("SELECT body FROM streamweaver_flow_packages WHERE tenant_id=? ORDER BY updated_at DESC,package_id").all(tenantId) as Array<{ body: string }>;
    const packages = new Map(this.listCommunity().map((item) => [item.packageId, item]));
    for (const row of privateRows) { const value = normalizeFlowPackage(JSON.parse(row.body)); packages.set(value.packageId, value); }
    return [...packages.values()];
  }

  listInstalls(tenantId: string) {
    tenantId = identifier(tenantId, "tenantId");
    const rows = this.db.prepare("SELECT body FROM streamweaver_flow_installs WHERE tenant_id=? ORDER BY installed_at,package_id").all(tenantId) as Array<{ body: string }>;
    return rows.map((row) => JSON.parse(row.body) as StreamWeaverFlowInstallV1);
  }

  listInstalledPackages(tenantId: string) {
    const packages = new Map(this.listTenantPackages(tenantId).map((item) => [item.packageId, item]));
    return this.listInstalls(tenantId).flatMap((install) => { const item = packages.get(install.packageId); return item ? [item] : []; });
  }

  saveDraft(tenantId: string, value: unknown, author: { id: string; displayName?: string }) {
    const now = this.now();
    const input = normalizeFlowPackage(value, { now, author, visibility: "private" });
    const owned = { ...input, author: { id: identifier(author.id, "author.id"), displayName: display(author.displayName ?? author.id) }, visibility: "private" as const, updatedAt: now };
    this.put(tenantId, owned);
    return owned;
  }

  publish(tenantId: string, packageId: string, author: { id: string; displayName?: string }) {
    const item = this.get(tenantId, packageId);
    if (!item) throw new Error("Flow package does not exist");
    if (item.author.id !== author.id) throw new Error("Only the flow author may publish this package");
    const published = { ...item, visibility: "community" as const, updatedAt: this.now() };
    this.put(tenantId, published);
    return published;
  }

  importPackage(tenantId: string, value: unknown, author: { id: string; displayName?: string }) {
    const candidate = object(value, "flow package");
    const candidateId = identifier(candidate.packageId, "packageId");
    const visible = this.get(tenantId, candidateId);
    if (visible?.visibility === "community") return { package: visible, install: this.install(tenantId, visible.packageId) };
    const saved = this.saveDraft(tenantId, value, author);
    return { package: saved, install: this.install(tenantId, saved.packageId) };
  }

  install(tenantId: string, packageId: string) {
    tenantId = identifier(tenantId, "tenantId"); packageId = identifier(packageId, "packageId");
    if (!this.get(tenantId, packageId)) throw new Error("Flow package does not exist or is not visible to this tenant");
    const existing = this.db.prepare("SELECT body FROM streamweaver_flow_installs WHERE tenant_id=? AND package_id=?").get(tenantId, packageId) as { body: string } | undefined;
    if (existing) return JSON.parse(existing.body) as StreamWeaverFlowInstallV1;
    const install: StreamWeaverFlowInstallV1 = { schemaVersion: 1, tenantId, packageId, installedAt: this.now() };
    this.db.prepare("INSERT INTO streamweaver_flow_installs(tenant_id,package_id,body,installed_at) VALUES(?,?,?,?)").run(tenantId, packageId, JSON.stringify(install), install.installedAt);
    return install;
  }

  uninstall(tenantId: string, packageId: string) {
    tenantId = identifier(tenantId, "tenantId"); packageId = identifier(packageId, "packageId");
    return Number(this.db.prepare("DELETE FROM streamweaver_flow_installs WHERE tenant_id=? AND package_id=?").run(tenantId, packageId).changes) > 0;
  }

  donorEnabled(tenantId: string, donorId: string) {
    return this.listInstalledPackages(tenantId).some((item) => item.commands.some((command) => command.enabled && command.runtime === "donor" && command.donorId === donorId));
  }

  commandEnabled(tenantId: string, command: string) {
    const normalized = command.trim().toLowerCase();
    return this.listInstalledPackages(tenantId).some((item) => item.commands.some((entry) => entry.enabled && (entry.trigger.toLowerCase() === normalized || entry.aliases.some((alias) => alias.toLowerCase() === normalized))));
  }

  approveAndInstall(tenantId: string, packageId: string) {
    const item = this.get(tenantId, packageId);
    if (!item) throw new Error("Flow package does not exist or is not visible to this tenant");
    if (item.visibility === "community") return { package: item, install: this.install(tenantId, item.packageId) };
    const approved: StreamWeaverFlowPackageV1 = { ...item, commands: item.commands.map((command) => ({ ...command, enabled: true })), actions: item.actions.map((action) => ({ ...action, enabled: true })), updatedAt: this.now() };
    this.put(tenantId, approved);
    return { package: approved, install: this.install(tenantId, approved.packageId) };
  }

  get(tenantId: string, packageId: string) {
    const builtin = legacyCommunityPackages().find((item) => item.packageId === packageId);
    if (builtin) return builtin;
    const row = this.db.prepare("SELECT body,tenant_id,visibility FROM streamweaver_flow_packages WHERE package_id=?").get(identifier(packageId, "packageId")) as { body: string; tenant_id: string; visibility: string } | undefined;
    if (!row || (row.visibility !== "community" && row.tenant_id !== tenantId)) return undefined;
    return normalizeFlowPackage(JSON.parse(row.body));
  }

  exportPackage(tenantId: string, packageId: string) {
    const item = this.get(tenantId, packageId);
    if (!item) throw new Error("Flow package does not exist");
    return structuredClone(item);
  }

  exportStreamerBot(tenantId: string, packageId: string) {
    const item = this.get(tenantId, packageId); if (!item) throw new Error("Flow package does not exist");
    const warnings: string[] = [];
    const actions = item.actions.map((action) => ({ id: action.id, name: `${item.name} · ${action.type}`, enabled: action.enabled, subActions: [streamerBotSubAction(action, warnings)] }));
    const defaultActionId = actions[0]?.id;
    return { format: "streamerbot-package", version: 1, source: "StreamWeaver", packageId: item.packageId, name: item.name, commands: item.commands.map((command) => ({ id: command.id, name: command.trigger.replace(/^!/, ""), command: command.trigger, aliases: command.aliases, enabled: command.enabled, ...(defaultActionId ? { actionId: defaultActionId } : {}) })), actions, warnings };
  }

  private put(tenantId: string, item: StreamWeaverFlowPackageV1) {
    tenantId = identifier(tenantId, "tenantId");
    if (legacyCommunityPackages().some((candidate) => candidate.packageId === item.packageId)) throw new Error("That flow package ID belongs to the original StreamWeaver library");
    const existing = this.db.prepare("SELECT tenant_id FROM streamweaver_flow_packages WHERE package_id=?").get(item.packageId) as { tenant_id: string } | undefined;
    if (existing && existing.tenant_id !== tenantId) throw new Error("That flow package ID belongs to another tenant");
    this.db.prepare("INSERT INTO streamweaver_flow_packages(package_id,tenant_id,visibility,author_id,body,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(package_id) DO UPDATE SET tenant_id=excluded.tenant_id,visibility=excluded.visibility,author_id=excluded.author_id,body=excluded.body,updated_at=excluded.updated_at").run(item.packageId, tenantId, item.visibility, item.author.id, JSON.stringify(item), item.updatedAt);
  }
}

export function legacyCommunityPackages(): StreamWeaverFlowPackageV1[] {
  const createdAt = "2026-08-23T00:00:00.000Z";
  const donor = STREAMWEAVER_DONOR_COMMANDS.map((command) => legacyPackage(command, createdAt));
  const existing = new Set(donor.flatMap((item) => item.commands.map((command) => command.trigger.toLowerCase())));
  const native = ["!currency", "!currencyname", "!exchange"].filter((trigger) => !existing.has(trigger)).map((trigger) => nativePackage(trigger, createdAt));
  return [...donor, ...native];
}

function legacyPackage(command: StreamWeaverDonorCommandV1, createdAt: string): StreamWeaverFlowPackageV1 {
  return { schemaVersion: 1, kind: STREAMWEAVER_FLOW_PACKAGE_KIND, packageId: `mtman1987.${command.donorId}`, packageKind: "command_flow", installUnit: "flow", name: command.trigger, description: `Preserved ${command.family} command flow from the original StreamWeaver catalog.`, author: { ...STREAMWEAVER_FLOW_AUTHOR }, visibility: "community", collection: "Original StreamWeaver", tags: [command.family, "legacy", "starter-option"], commands: [{ id: `command.${command.donorId}`, trigger: command.trigger, aliases: [...(command.aliases ?? [])], family: command.family, cooldownSeconds: command.cooldownSeconds, matcher: command.matcher ?? "command", runtime: "donor", donorId: command.donorId, enabled: true }], actions: [], createdAt, updatedAt: createdAt };
}
function nativePackage(trigger:string,createdAt:string):StreamWeaverFlowPackageV1{const id=trigger.slice(1);return{schemaVersion:1,kind:STREAMWEAVER_FLOW_PACKAGE_KIND,packageId:`mtman1987.${id}`,packageKind:"command_flow",installUnit:"flow",name:trigger,description:`Native StreamWeaver ${id} command flow.`,author:{...STREAMWEAVER_FLOW_AUTHOR},visibility:"community",collection:"Original StreamWeaver",tags:["economy","native","starter-option"],commands:[{id:`command.${id}`,trigger,aliases:[],family:"economy",cooldownSeconds:0,matcher:"command",runtime:"donor",enabled:true}],actions:[],createdAt,updatedAt:createdAt};}

export function normalizeFlowPackage(value: unknown, defaults?: { now: string; author: { id: string; displayName?: string }; visibility: "private" | "community" }): StreamWeaverFlowPackageV1 {
  const item = object(value, "flow package");
  if (item.kind !== STREAMWEAVER_FLOW_PACKAGE_KIND && item.kind !== "command_flow") throw new Error(`Flow package kind must be ${STREAMWEAVER_FLOW_PACKAGE_KIND}`);
  const now = defaults?.now ?? iso(item.updatedAt, "updatedAt");
  const rawAuthor = item.author === undefined && defaults ? defaults.author : object(item.author, "author");
  const author = { id: identifier(rawAuthor.id, "author.id"), displayName: display(rawAuthor.displayName ?? rawAuthor.id) };
  const commands = array(item.commands ?? [], "commands", 1).map((raw) => normalizeCommand(raw));
  const actions = array(item.actions ?? [], "actions", 128).map((raw) => normalizeAction(raw));
  if (!commands.length && !actions.length) throw new Error("A flow package must contain at least one command or action");
  const packageKind = item.packageKind === "action_flow" || item.packageKind === "support_flow" ? item.packageKind : "command_flow";
  if (packageKind === "command_flow" && commands.length !== 1) throw new Error("A command-flow JSON must contain exactly one command");
  const result: StreamWeaverFlowPackageV1 = { schemaVersion: 1, kind: STREAMWEAVER_FLOW_PACKAGE_KIND, packageId: identifier(item.packageId ?? `flow.${crypto.randomUUID()}`, "packageId"), packageKind, installUnit: "flow", name: text(item.name, "name", 120), description: optionalText(item.description, 1000), author, visibility: defaults?.visibility ?? (item.visibility === "community" ? "community" : "private"), collection: optionalText(item.collection, 120) || "Community", tags: stringArray(item.tags, 24, 48), commands, actions, createdAt: item.createdAt === undefined ? now : iso(item.createdAt, "createdAt"), updatedAt: now };
  if (JSON.stringify(result).length > 256_000) throw new Error("Flow package is too large");
  return result;
}

function normalizeCommand(value: unknown): StreamWeaverFlowCommandV1 { const item=object(value,"command"),trigger=text(item.trigger??item.command,"command.trigger",120);if(!trigger.startsWith("!")&&item.matcher!=="regex"&&item.matcher!=="bare")throw new Error("Command trigger must begin with !");return{id:identifier(item.id??`command.${crypto.randomUUID()}`,"command.id"),trigger,aliases:stringArray(item.aliases,20,120),family:donorFamily(item.family),cooldownSeconds:integer(item.cooldownSeconds??0,0,86400,"command.cooldownSeconds"),matcher:item.matcher==="regex"||item.matcher==="bare"?item.matcher:"command",runtime:item.runtime==="donor"?"donor":"flow",...(typeof item.donorId==="string"?{donorId:identifier(item.donorId,"command.donorId")} : {}),enabled:item.enabled!==false}; }
function normalizeAction(value: unknown): StreamWeaverFlowActionV1 { const item=object(value,"action"),allowed=["send-chat","send-discord","wait","run-action","http-request","set-variable","execute-code","obs-scene","obs-source"] as const,type=String(item.type);if(!allowed.includes(type as typeof allowed[number]))throw new Error(`Unsupported flow action: ${type}`);const config=object(item.config??{},"action.config");if(JSON.stringify(config).length>32_000)throw new Error("Flow action config is too large");return{id:identifier(item.id??`action.${crypto.randomUUID()}`,"action.id"),type:type as StreamWeaverFlowActionV1["type"],enabled:item.enabled!==false,config:structuredClone(config)}; }
function streamerBotSubAction(action:StreamWeaverFlowActionV1,warnings:string[]){const map:Partial<Record<StreamWeaverFlowActionV1["type"],string>>={"send-chat":"SendChatMessage","send-discord":"DiscordSendMessage",wait:"Delay","run-action":"RunAction","http-request":"ExecuteCode","set-variable":"SetGlobalVariable","execute-code":"ExecuteCode","obs-scene":"ObsSetScene","obs-source":"ObsSetSourceVisibility"};const type=map[action.type]??"ExecuteCode";if(type==="ExecuteCode"&&action.type!=="execute-code")warnings.push(`${action.type} was exported as an ExecuteCode compatibility fallback.`);return{type,enabled:action.enabled,...action.config};}
function donorFamily(value:unknown):StreamWeaverFlowCommandV1["family"]{const allowed=new Set(["economy","social","links","twitch","moderation","community","watchtime","music","redeem","system","persona","pokemon","secret","custom"]);const result=String(value??"custom");return allowed.has(result)?result as StreamWeaverFlowCommandV1["family"]:"custom";}
function object(value:unknown,name:string){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${name} must be an object`);return value as Record<string,unknown>;}
function array(value:unknown,name:string,max:number){if(!Array.isArray(value)||value.length>max)throw new Error(`${name} must be an array with at most ${max} items`);return value;}
function stringArray(value:unknown,max:number,itemMax:number){if(value===undefined)return[];if(!Array.isArray(value)||value.length>max||value.some((item)=>typeof item!=="string"||!item.trim()||item.length>itemMax))throw new Error("Flow package string list is invalid");return [...new Set(value.map((item)=>String(item).trim()))];}
function identifier(value:unknown,name:string){const result=String(value??"").trim();if(!/^[A-Za-z0-9._:@/-]{1,200}$/.test(result))throw new Error(`${name} is invalid`);return result;}
function text(value:unknown,name:string,max:number){const result=String(value??"").replace(/\0/g,"").trim();if(!result||result.length>max)throw new Error(`${name} is invalid`);return result;}
function optionalText(value:unknown,max:number){const result=String(value??"").replace(/\0/g,"").trim();if(result.length>max)throw new Error("Flow package text is too long");return result;}
function display(value:unknown){return text(value,"author.displayName",120);}
function integer(value:unknown,min:number,max:number,name:string){const result=Number(value);if(!Number.isSafeInteger(result)||result<min||result>max)throw new Error(`${name} is invalid`);return result;}
function iso(value:unknown,name:string){if(typeof value!=="string"||!Number.isFinite(Date.parse(value)))throw new Error(`${name} is invalid`);return value;}
