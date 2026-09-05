import { DatabaseSync } from "node:sqlite";
import { STREAMWEAVER_DONOR_COMMANDS, type StreamWeaverDonorCommandFamilyV1, type StreamWeaverDonorCommandV1 } from "./donor-command-catalog.js";

export const STREAMWEAVER_FLOW_PACKAGE_KIND = "streamweaver.flow-package" as const;
export const STREAMWEAVER_FLOW_AUTHOR = Object.freeze({ id: "mtman1987", displayName: "mtman1987" });

export interface StreamWeaverFlowCommandV1 {
  id: string;
  trigger: string;
  aliases: string[];
  role: "primary" | "addon";
  required: boolean;
  actionIds: string[];
  family: StreamWeaverDonorCommandFamilyV1 | "custom";
  cooldownSeconds: number;
  matcher: "command" | "regex" | "bare";
  runtime: "donor" | "flow";
  donorId?: string;
  enabled: boolean;
}

export interface StreamWeaverFlowActionV1 {
  id: string;
  type: "send-chat" | "send-discord" | "wait" | "run-action" | "run-native" | "http-request" | "set-variable" | "execute-code" | "obs-scene" | "obs-source";
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
    const occupied = this.db.prepare("SELECT tenant_id AS tenantId FROM streamweaver_flow_packages WHERE package_id=?").get(candidateId) as { tenantId: string } | undefined;
    const source = occupied && occupied.tenantId !== tenantId ? remapImportedFlowPackage(value) : value;
    const saved = this.saveDraft(tenantId, source, author);
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
    const commandActions = item.commands.map((command) => {
      if (command.actionIds.length <= 1) return command.actionIds[0];
      const wrapperId = `${command.id}.pipeline`;
      actions.push({ id: wrapperId, name: `${item.name} · ${command.trigger} pipeline`, enabled: command.enabled, subActions: command.actionIds.map((actionId) => ({ type: "RunAction", enabled: true, actionId })) });
      return wrapperId;
    });
    return { format: "streamerbot-package", version: 1, source: "StreamWeaver", packageId: item.packageId, name: item.name, commands: item.commands.map((command, index) => ({ id: command.id, name: command.trigger.replace(/^!/, ""), command: command.trigger, aliases: command.aliases, enabled: command.enabled, role: command.role, required: command.required, ...(commandActions[index] ? { actionId: commandActions[index] } : {}) })), actions, warnings: [...new Set(warnings)] };
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
  const excluded = new Set(STREAMWEAVER_DONOR_COMMANDS.filter((command) => command.family === "economy" || command.family === "persona" || command.donorId === "commands-chat" || command.donorId === "commands-system").map((command) => command.donorId));
  const bundled = new Map<string, readonly string[]>([
    ["accept", ["accept", "no", "yes"]],
    ["lurk-chat", ["lurk-chat", "unlurk"]],
  ]);
  const consumed = new Set([...bundled.values()].flat());
  const byId = new Map(STREAMWEAVER_DONOR_COMMANDS.map((command) => [command.donorId, command]));
  const result: StreamWeaverFlowPackageV1[] = [];
  for (const command of STREAMWEAVER_DONOR_COMMANDS) {
    if (excluded.has(command.donorId) || (consumed.has(command.donorId) && !bundled.has(command.donorId))) continue;
    const members = (bundled.get(command.donorId) ?? [command.donorId]).map((donorId) => byId.get(donorId)).filter((entry): entry is StreamWeaverDonorCommandV1 => Boolean(entry));
    result.push(legacyPackage(members, createdAt));
  }
  return result;
}

function legacyPackage(commands: readonly StreamWeaverDonorCommandV1[], createdAt: string): StreamWeaverFlowPackageV1 {
  const primary = commands[0]!;
  const actions = commands.map((command) => ({ id: `action.${command.donorId}`, type: "run-native" as const, enabled: true, config: { capability: "streamweaver.donor-command.v1", donorId: command.donorId } }));
  return { schemaVersion: 1, kind: STREAMWEAVER_FLOW_PACKAGE_KIND, packageId: `mtman1987.${primary.donorId}`, packageKind: "command_flow", installUnit: "flow", name: primary.trigger, description: `Complete ${primary.family} flow from the original StreamWeaver catalog, including its command${commands.length === 1 ? "" : "s"}, actions, and wiring.`, author: { ...STREAMWEAVER_FLOW_AUTHOR }, visibility: "community", collection: "Original StreamWeaver · Curated", tags: [...new Set(commands.map((command) => command.family)), "curated", "starter-option", ...(commands.length > 1 ? ["bundle"] : [])], commands: commands.map((command, index) => ({ id: `command.${command.donorId}`, trigger: command.trigger, aliases: [...(command.aliases ?? [])], role: index === 0 ? "primary" : "addon", required: index === 0, actionIds: [`action.${command.donorId}`], family: command.family, cooldownSeconds: command.cooldownSeconds, matcher: command.matcher ?? "command", runtime: "flow", donorId: command.donorId, enabled: true })), actions, createdAt, updatedAt: createdAt };
}

export function normalizeFlowPackage(value: unknown, defaults?: { now: string; author: { id: string; displayName?: string }; visibility: "private" | "community" }): StreamWeaverFlowPackageV1 {
  const item = object(value, "flow package");
  if (item.kind !== STREAMWEAVER_FLOW_PACKAGE_KIND && item.kind !== "command_flow") throw new Error(`Flow package kind must be ${STREAMWEAVER_FLOW_PACKAGE_KIND}`);
  const now = defaults?.now ?? iso(item.updatedAt, "updatedAt");
  const rawAuthor = item.author === undefined && defaults ? defaults.author : object(item.author, "author");
  const author = { id: identifier(rawAuthor.id, "author.id"), displayName: display(rawAuthor.displayName ?? rawAuthor.id) };
  const rawCommands = array(item.commands ?? [], "commands", 32);
  const rawActions = array(item.actions ?? [], "actions", 128);
  const commands = rawCommands.map((raw, index) => normalizeCommand(raw, index, rawCommands.length, rawActions));
  const actions = rawActions.map((raw) => normalizeAction(raw));
  if (!commands.length && !actions.length) throw new Error("A flow package must contain at least one command or action");
  const packageKind = item.packageKind === "action_flow" || item.packageKind === "support_flow" ? item.packageKind : "command_flow";
  if (packageKind === "command_flow" && !commands.length) throw new Error("A command-flow JSON must contain a primary command");
  if (commands.length && commands.filter((command) => command.role === "primary").length !== 1) throw new Error("A flow command bundle must contain exactly one primary command");
  uniqueIds(commands.map((command) => command.id), "command");
  uniqueIds(actions.map((action) => action.id), "action");
  const actionIds = new Set(actions.map((action) => action.id));
  for (const command of commands) {
    if (!command.actionIds.length) throw new Error(`Command ${command.id} must be wired to at least one action`);
    for (const actionId of command.actionIds) if (!actionIds.has(actionId)) throw new Error(`Command ${command.id} references missing action ${actionId}`);
  }
  const wired = new Set(commands.flatMap((command) => command.actionIds));
  if (packageKind === "command_flow" && actions.some((action) => !wired.has(action.id))) throw new Error("Command-flow actions must be wired to a command");
  const result: StreamWeaverFlowPackageV1 = { schemaVersion: 1, kind: STREAMWEAVER_FLOW_PACKAGE_KIND, packageId: identifier(item.packageId ?? `flow.${crypto.randomUUID()}`, "packageId"), packageKind, installUnit: "flow", name: text(item.name, "name", 120), description: optionalText(item.description, 1000), author, visibility: defaults?.visibility ?? (item.visibility === "community" ? "community" : "private"), collection: optionalText(item.collection, 120) || "Community", tags: stringArray(item.tags, 24, 48), commands, actions, createdAt: item.createdAt === undefined ? now : iso(item.createdAt, "createdAt"), updatedAt: now };
  if (JSON.stringify(result).length > 256_000) throw new Error("Flow package is too large");
  return result;
}

function normalizeCommand(value: unknown, index: number, commandCount: number, rawActions: unknown[]): StreamWeaverFlowCommandV1 { const item=object(value,"command"),trigger=text(item.trigger??item.command,"command.trigger",120);if(!trigger.startsWith("!")&&item.matcher!=="regex"&&item.matcher!=="bare")throw new Error("Command trigger must begin with !");const legacyActionIds=item.actionIds===undefined&&commandCount===1?rawActions.map((raw)=>identifier(object(raw,"action").id,"action.id")):stringArray(item.actionIds,128,200);return{id:identifier(item.id??`command.${crypto.randomUUID()}`,"command.id"),trigger,aliases:stringArray(item.aliases,20,120),role:item.role==="addon"?"addon":index===0?"primary":"addon",required:item.required===undefined?index===0:item.required===true,actionIds:legacyActionIds,family:donorFamily(item.family),cooldownSeconds:integer(item.cooldownSeconds??0,0,86400,"command.cooldownSeconds"),matcher:item.matcher==="regex"||item.matcher==="bare"?item.matcher:"command",runtime:item.runtime==="donor"?"donor":"flow",...(typeof item.donorId==="string"?{donorId:identifier(item.donorId,"command.donorId")} : {}),enabled:item.enabled!==false}; }
function normalizeAction(value: unknown): StreamWeaverFlowActionV1 { const item=object(value,"action"),allowed=["send-chat","send-discord","wait","run-action","run-native","http-request","set-variable","execute-code","obs-scene","obs-source"] as const,type=String(item.type);if(!allowed.includes(type as typeof allowed[number]))throw new Error(`Unsupported flow action: ${type}`);const config=object(item.config??{},"action.config");if(type==="run-native"){if(config.capability!=="streamweaver.donor-command.v1")throw new Error("run-native must reference the StreamWeaver donor command capability");identifier(config.donorId,"action.config.donorId");}if(JSON.stringify(config).length>32_000)throw new Error("Flow action config is too large");return{id:identifier(item.id??`action.${crypto.randomUUID()}`,"action.id"),type:type as StreamWeaverFlowActionV1["type"],enabled:item.enabled!==false,config:structuredClone(config)}; }
function streamerBotSubAction(action:StreamWeaverFlowActionV1,warnings:string[]){if(action.type==="run-native"){warnings.push("Native StreamWeaver actions require an equivalent action in Streamer.bot; the command/action wiring is preserved.");return{type:"RunAction",enabled:action.enabled,actionName:`StreamWeaver Native · ${String(action.config.donorId)}`,sourceCapability:action.config.capability};}const map:Partial<Record<StreamWeaverFlowActionV1["type"],string>>={"send-chat":"SendChatMessage","send-discord":"DiscordSendMessage",wait:"Delay","run-action":"RunAction","http-request":"ExecuteCode","set-variable":"SetGlobalVariable","execute-code":"ExecuteCode","obs-scene":"ObsSetScene","obs-source":"ObsSetSourceVisibility"};const type=map[action.type]??"ExecuteCode";if(type==="ExecuteCode"&&action.type!=="execute-code")warnings.push(`${action.type} was exported as an ExecuteCode compatibility fallback.`);return{type,enabled:action.enabled,...action.config};}
function remapImportedFlowPackage(value:unknown){const item=structuredClone(object(value,"flow package")),suffix=crypto.randomUUID().slice(0,8),commands=array(item.commands??[],"commands",32),actions=array(item.actions??[],"actions",128),actionMap=new Map<string,string>();for(const raw of actions){const action=object(raw,"action"),old=identifier(action.id,"action.id"),next=`${old}.import-${suffix}`;actionMap.set(old,next);action.id=next;}for(const raw of commands){const command=object(raw,"command"),old=identifier(command.id,"command.id");command.id=`${old}.import-${suffix}`;if(Array.isArray(command.actionIds))command.actionIds=command.actionIds.map((actionId)=>actionMap.get(String(actionId))??actionId);}item.packageId=`${identifier(item.packageId,"packageId")}.import-${suffix}`;return item;}
function uniqueIds(values:string[],name:string){if(new Set(values).size!==values.length)throw new Error(`Flow package contains duplicate ${name} IDs`);}
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
