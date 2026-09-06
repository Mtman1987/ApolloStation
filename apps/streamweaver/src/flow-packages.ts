import { DatabaseSync } from "node:sqlite";
import { DEVICE_AUTOMATION_ACTIONS, SPMT_SUITE_ACTION_CATALOG } from "@spmt/contracts";
import { STREAMWEAVER_DONOR_COMMANDS, type StreamWeaverDonorCommandFamilyV1, type StreamWeaverDonorCommandV1 } from "./donor-command-catalog.js";
import { assertFlowCodeValue } from "./flow-code.js";
import { assertStreamWeaverSecureChoiceConfig, STREAMWEAVER_SECURE_CHOICE_DONOR_ID } from "./secure-choice.js";

export const STREAMWEAVER_FLOW_PACKAGE_KIND = "streamweaver.flow-package" as const;
export const STREAMWEAVER_FLOW_AUTHOR = Object.freeze({ id: "mtman1987", displayName: "mtman1987" });

export function assertStreamWeaverFlowRunnable(item: StreamWeaverFlowPackageV1) {
  assertStreamWeaverFlowCode(item);
  const supported=new Set(["send-chat","send-discord","wait","run-action","run-native","set-variable","condition","ai-response","speak","points","obs-scene","obs-source","device-command"]);
  for(const command of item.commands)if(command.enabled&&command.migrationNote)throw new Error(command.migrationNote);
  for(const command of item.commands)if(command.enabled&&command.edges===undefined&&command.actionIds.some(id=>item.actions.find(a=>a.id===id)?.type==="condition"))throw new Error("Enable branching and choose destinations for each condition before enabling this flow");
  for(const action of item.actions) {
    if(!action.enabled||!item.commands.some(command=>command.enabled&&command.actionIds.includes(action.id)))continue;
    if(!supported.has(action.type))throw new Error(`${action.type} needs a registered execution capability. Replace that step before enabling the flow.`);
    assertFlowCodeValue(action.config);
    if(action.type==="obs-scene"||action.type==="obs-source"||action.type==="device-command"){if(!/^[A-Za-z0-9._:@/-]{1,200}$/.test(String(action.config.deviceId??"")))throw new Error("Choose a paired device on the Devices page, then select it for this step");if(action.type==="obs-scene"&&!String(action.config.sceneName??action.config.scene??"").trim())throw new Error("Choose an OBS scene name");if(action.type==="device-command"&&!Object.hasOwn(DEVICE_AUTOMATION_ACTIONS,String(action.config.action)))throw new Error("Choose an authorized device action");}
    if(action.type==="obs-source"&&(!String(action.config.sceneName??action.config.scene??"").trim()||!String(action.config.sourceName??action.config.source??"").trim()||typeof action.config.visible!=="boolean"))throw new Error("Choose the OBS scene, source and visibility");
    if(action.type==="wait"&&(!Number.isFinite(Number(action.config.milliseconds??action.config.value??0))||Number(action.config.milliseconds??action.config.value??0)<0||Number(action.config.milliseconds??action.config.value??0)>60000))throw new Error("Wait steps must be between 0 and 60000 milliseconds");
    if(action.type==="run-native"&&!STREAMWEAVER_DONOR_COMMANDS.some(c=>c.donorId===action.config.donorId))throw new Error("Choose an existing native command");
    if(action.type==="run-native"&&action.config.donorId===STREAMWEAVER_SECURE_CHOICE_DONOR_ID)assertStreamWeaverSecureChoiceConfig(action.config);
    if(action.type==="run-action"&&!SPMT_SUITE_ACTION_CATALOG.some(a=>a.id===action.config.action))throw new Error("Choose an existing cross-app action");
    if((action.type==="send-chat"||action.type==="send-discord")&&!String(action.config.text??action.config.message??"").trim())throw new Error("Message steps need reply text");
    if(action.type==="condition"&&!["==","===","!=","!==",">",">=","<","<=","includes","exists"].includes(String(action.config.operator)))throw new Error("Choose a supported condition operator");
    if(action.type==="speak"&&!String(action.config.text??" ").trim())throw new Error("Speech steps need text");
    if(action.type==="points"&&action.config.delta===undefined)throw new Error("Points steps need an amount");
    if(action.type==="ai-response"&&!String(action.config.input??"").trim())throw new Error("AI steps need an input prompt");
    if(action.config.saveAs!==undefined&&!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(String(action.config.saveAs)))throw new Error("Result variable names must start with a letter and contain only letters, numbers and underscores");
  }
}

function assertStreamWeaverFlowCode(item:StreamWeaverFlowPackageV1){for(const action of item.actions)assertFlowCodeValue(action.config);}

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
  minimumRole?: "guest"|"member"|"moderator"|"admin"|"owner";
  caseSensitive?: boolean;
  globalCooldownSeconds?: number;
  migrationNote?: string;
  edges?: Array<{ source: string; target: string; outcome?: "success" | "true" | "false" }>;
}

export interface StreamWeaverFlowActionV1 {
  id: string;
  type: "send-chat" | "send-discord" | "wait" | "run-action" | "run-native" | "http-request" | "set-variable" | "execute-code" | "obs-scene" | "obs-source" | "condition" | "ai-response" | "device-command" | "speak" | "points";
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface StreamWeaverFlowPackageV1 {
  schemaVersion: 1;
  kind: typeof STREAMWEAVER_FLOW_PACKAGE_KIND;
  packageId: string;
  packageKind: "command_flow" | "action_flow" | "support_flow";
  installUnit: "flow";
  legacySource?: Record<string,unknown>;
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
  enabled?: boolean;
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
      CREATE TABLE IF NOT EXISTS streamweaver_flow_runs(tenant_id TEXT NOT NULL, delivery_id TEXT NOT NULL, body TEXT NOT NULL, occurred_at TEXT NOT NULL, PRIMARY KEY(tenant_id,delivery_id)) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_flow_executions(tenant_id TEXT NOT NULL, delivery_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tenant_id,delivery_id)) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_flow_variables(tenant_id TEXT NOT NULL, package_id TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(tenant_id,package_id,name)) STRICT;
    `);
  }
  close() { this.db.close(); }

  execution<T>(tenantId:string,deliveryId:string): T | undefined {
    const row=this.db.prepare("SELECT body FROM streamweaver_flow_executions WHERE tenant_id=? AND delivery_id=?").get(tenantId,deliveryId) as {body:string}|undefined;
    return row ? JSON.parse(row.body) as T : undefined;
  }
  saveExecution(tenantId:string,deliveryId:string,state:string,body:unknown) {
    this.db.prepare("INSERT INTO streamweaver_flow_executions VALUES(?,?,?,?) ON CONFLICT(tenant_id,delivery_id) DO UPDATE SET state=excluded.state,body=excluded.body").run(tenantId,deliveryId,state,JSON.stringify(body));
    this.db.prepare("DELETE FROM streamweaver_flow_executions WHERE tenant_id=? AND state='succeeded' AND delivery_id NOT IN (SELECT delivery_id FROM streamweaver_flow_executions WHERE tenant_id=? AND state='succeeded' ORDER BY rowid DESC LIMIT 200)").run(tenantId,tenantId);
  }
  waitingExecutions<T>(limit=100):T[] {
    return (this.db.prepare("SELECT body FROM streamweaver_flow_executions WHERE state IN ('waiting','running') ORDER BY rowid LIMIT ?").all(Math.max(1,Math.min(100,limit))) as Array<{body:string}>).map(row=>JSON.parse(row.body) as T);
  }
  variables(tenantId:string,packageId:string):Record<string,string> {
    return Object.fromEntries((this.db.prepare("SELECT name,value FROM streamweaver_flow_variables WHERE tenant_id=? AND package_id=?").all(tenantId,packageId) as Array<{name:string;value:string}>).map(row=>[row.name,row.value]));
  }
  setVariable(tenantId:string,packageId:string,name:string,value:string) {
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||value.length>16000)throw new Error("Flow variable is invalid");
    this.db.prepare("INSERT INTO streamweaver_flow_variables VALUES(?,?,?,?) ON CONFLICT(tenant_id,package_id,name) DO UPDATE SET value=excluded.value").run(tenantId,packageId,name,value);
  }

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
    return this.listInstalls(tenantId).flatMap((install) => { const item = packages.get(install.packageId); return item && install.enabled !== false ? [item] : []; });
  }

  setInstallEnabled(tenantId: string, packageId: string, enabled: boolean) {
    const install = this.listInstalls(tenantId).find(item => item.packageId === packageId);
    if (!install) throw new Error("Install this flow before changing its enabled state");
    if(enabled)assertStreamWeaverFlowRunnable(this.get(tenantId,packageId)!);
    const value = { ...install, enabled };
    this.db.prepare("UPDATE streamweaver_flow_installs SET body=? WHERE tenant_id=? AND package_id=?").run(JSON.stringify(value), tenantId, packageId);
    return value;
  }

  editDraft(tenantId: string, value: unknown, author: { id: string; displayName?: string }, expectedUpdatedAt?: string) {
    const input = normalizeFlowPackage(value, { now: this.now(), author, visibility: "private" });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(tenantId, input.packageId);
      if (current && (current.author.id !== author.id || current.visibility !== "private")) throw new Error("Copy a community flow before editing it");
      if (current && (!expectedUpdatedAt || current.updatedAt !== expectedUpdatedAt)) throw new Error("This flow changed. Reload it before saving your edits");
      if (!current && expectedUpdatedAt) throw new Error("This flow was deleted. Reload the flow list");
      if(this.listInstalls(tenantId).some(row=>row.packageId===input.packageId&&row.enabled!==false))assertStreamWeaverFlowRunnable(input);
      const saved = this.saveDraft(tenantId, { ...input, createdAt: current?.createdAt ?? input.createdAt }, author);
      this.db.exec("COMMIT"); return saved;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  copyDraft(tenantId: string, packageId: string, author: { id: string; displayName?: string }) {
    const current = this.exportPackage(tenantId, packageId);
    assertStreamWeaverFlowCode(current);
    return this.saveDraft(tenantId, { ...current, packageId: `flow.${crypto.randomUUID()}`, name: `${current.name.slice(0,110)} copy` }, author);
  }

  deleteDraft(tenantId: string, packageId: string, authorId: string) {
    const current = this.get(tenantId, packageId);
    if (!current || current.visibility !== "private" || current.author.id !== authorId) throw new Error("Only your private drafts can be deleted");
    this.db.exec("BEGIN IMMEDIATE");
    try { this.uninstall(tenantId, packageId); this.db.prepare("DELETE FROM streamweaver_flow_packages WHERE tenant_id=? AND package_id=?").run(tenantId,packageId); this.db.exec("COMMIT"); }
    catch(error) { this.db.exec("ROLLBACK"); throw error; }
    return true;
  }

  recordRun(tenantId: string, deliveryId: string, value: Record<string, unknown>) {
    this.db.prepare("INSERT OR REPLACE INTO streamweaver_flow_runs VALUES(?,?,?,?)").run(tenantId, deliveryId, JSON.stringify({...value,deliveryId}), this.now());
    this.db.prepare("DELETE FROM streamweaver_flow_runs WHERE tenant_id=? AND delivery_id NOT IN (SELECT delivery_id FROM streamweaver_flow_runs WHERE tenant_id=? ORDER BY occurred_at DESC,rowid DESC LIMIT 200)").run(tenantId,tenantId);
  }
  listRuns(tenantId: string) {
    return (this.db.prepare("SELECT body FROM streamweaver_flow_runs WHERE tenant_id=? ORDER BY occurred_at DESC,rowid DESC LIMIT 100").all(tenantId) as Array<{body:string}>).map(row => JSON.parse(row.body) as Record<string,unknown>);
  }

  saveDraft(tenantId: string, value: unknown, author: { id: string; displayName?: string }) {
    const now = this.now();
    const input = normalizeFlowPackage(value, { now, author, visibility: "private" });
    const prior=this.get(tenantId,input.packageId);
    const updatedAt=new Date(Math.max(Date.parse(now),prior?Date.parse(prior.updatedAt)+1:0)).toISOString();
    const owned = { ...input, author: { id: identifier(author.id, "author.id"), displayName: display(author.displayName ?? author.id) }, visibility: "private" as const, updatedAt };
    this.put(tenantId, owned);
    return owned;
  }

  publish(tenantId: string, packageId: string, author: { id: string; displayName?: string }) {
    const item = this.get(tenantId, packageId);
    if (!item) throw new Error("Flow package does not exist");
    if (item.author.id !== author.id) throw new Error("Only the flow author may publish this package");
    assertStreamWeaverFlowCode(item);
    const published = { ...item, visibility: "community" as const, updatedAt: this.now() };
    this.put(tenantId, published);
    return published;
  }

  importPackage(tenantId: string, value: unknown, author: { id: string; displayName?: string }) {
    const candidate = object(value, "flow package");
    const candidateId = identifier(candidate.packageId, "packageId");
    const visible = this.get(tenantId, candidateId);
    if (visible?.visibility === "community") return { package: visible };
    const occupied = this.db.prepare("SELECT tenant_id AS tenantId FROM streamweaver_flow_packages WHERE package_id=?").get(candidateId) as { tenantId: string } | undefined;
    const source = occupied ? remapImportedFlowPackage(value) : value;
    const normalized=normalizeFlowPackage(source,{now:this.now(),author,visibility:"private"});
    assertStreamWeaverFlowCode(normalized);
    const saved = this.saveDraft(tenantId, normalized, author);
    return { package: saved };
  }

  install(tenantId: string, packageId: string) {
    tenantId = identifier(tenantId, "tenantId"); packageId = identifier(packageId, "packageId");
    const candidate=this.get(tenantId, packageId);
    if (!candidate) throw new Error("Flow package does not exist or is not visible to this tenant");
    if(candidate.commands.some(c=>c.enabled))assertStreamWeaverFlowRunnable(candidate);
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
    assertStreamWeaverFlowRunnable(item);
    if (item.visibility === "community") return { package: item, install: this.install(tenantId, item.packageId) };
    const approved: StreamWeaverFlowPackageV1 = { ...item, updatedAt: this.now() };
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
  if(item.legacySource!==undefined)result.legacySource=structuredClone(object(item.legacySource,"legacySource"));
  if (JSON.stringify(result).length > 256_000) throw new Error("Flow package is too large");
  return result;
}

function normalizeCommand(value: unknown, index: number, commandCount: number, rawActions: unknown[]): StreamWeaverFlowCommandV1 { const item=object(value,"command"),trigger=text(item.trigger??item.command,"command.trigger",120);if(!trigger.startsWith("!")&&item.matcher!=="regex"&&item.matcher!=="bare")throw new Error("Command trigger must begin with !");const legacyActionIds=item.actionIds===undefined&&commandCount===1?rawActions.map((raw)=>identifier(object(raw,"action").id,"action.id")):stringArray(item.actionIds,128,200);return{id:identifier(item.id??`command.${crypto.randomUUID()}`,"command.id"),trigger,aliases:stringArray(item.aliases,20,120),role:item.role==="addon"?"addon":index===0?"primary":"addon",required:item.required===undefined?index===0:item.required===true,actionIds:legacyActionIds,family:donorFamily(item.family),cooldownSeconds:integer(item.cooldownSeconds??0,0,86400,"command.cooldownSeconds"),matcher:item.matcher==="regex"||item.matcher==="bare"?item.matcher:"command",runtime:item.runtime==="donor"?"donor":"flow",...(typeof item.donorId==="string"?{donorId:identifier(item.donorId,"command.donorId")} : {}),enabled:item.enabled!==false,...commandAccess(item),...(item.edges===undefined?{}:{edges:normalizeEdges(item.edges,legacyActionIds)})}; }
function commandAccess(item:Record<string,unknown>){
  if(item.minimumRole!==undefined&&!['guest','member','moderator','admin','owner'].includes(String(item.minimumRole)))throw new Error('Command access role is invalid');
  return {...(item.minimumRole?{minimumRole:item.minimumRole as NonNullable<StreamWeaverFlowCommandV1['minimumRole']>}:{}),...(item.caseSensitive===true?{caseSensitive:true}:{}),...(item.globalCooldownSeconds===undefined?{}:{globalCooldownSeconds:integer(item.globalCooldownSeconds,0,86400,'globalCooldownSeconds')}),...(item.migrationNote?{migrationNote:optionalText(item.migrationNote,1000)}:{})};
}
function normalizeEdges(value: unknown, actionIds: string[]): NonNullable<StreamWeaverFlowCommandV1["edges"]> {
  const edges = array(value,"command.edges",512).map(raw => {
    const edge=object(raw,"edge"), source=identifier(edge.source,"edge.source"), target=identifier(edge.target,"edge.target");
    if(!actionIds.includes(source)||!actionIds.includes(target))throw new Error("Flow edges must reference this command's steps");
    if(edge.outcome!==undefined&&!["success","true","false"].includes(String(edge.outcome)))throw new Error("Flow edge outcome is invalid");
    return {source,target,...(edge.outcome===undefined?{}:{outcome:edge.outcome as "success"|"true"|"false"})};
  });
  const visiting=new Set<string>(),visited=new Set<string>();
  function visit(id:string){if(visiting.has(id))throw new Error("Flow edges cannot contain a cycle; use a separate trigger for repeated work");if(visited.has(id))return;visiting.add(id);for(const e of edges.filter(e=>e.source===id))visit(e.target);visiting.delete(id);visited.add(id);}
  for(const id of actionIds)visit(id);
  return edges;
}
function normalizeAction(value: unknown): StreamWeaverFlowActionV1 { const item=object(value,"action"),allowed=["send-chat","send-discord","wait","run-action","run-native","http-request","set-variable","execute-code","obs-scene","obs-source","condition","ai-response","speak","points","device-command"] as const,type=String(item.type);if(!allowed.includes(type as typeof allowed[number]))throw new Error(`Unsupported flow action: ${type}`);const config=object(item.config??{},"action.config");if(type==="run-native"){if(config.capability!=="streamweaver.donor-command.v1")throw new Error("run-native must reference the StreamWeaver donor command capability");identifier(config.donorId,"action.config.donorId");}if(JSON.stringify(config).length>32_000)throw new Error("Flow action config is too large");return{id:identifier(item.id??`action.${crypto.randomUUID()}`,"action.id"),type:type as StreamWeaverFlowActionV1["type"],enabled:item.enabled!==false,config:structuredClone(config)}; }
function streamerBotSubAction(action:StreamWeaverFlowActionV1,warnings:string[]){if(action.type==="run-native"){warnings.push("Native StreamWeaver actions require an equivalent action in Streamer.bot; the command/action wiring is preserved.");return{type:"RunAction",enabled:action.enabled,actionName:`StreamWeaver Native · ${String(action.config.donorId)}`,sourceCapability:action.config.capability};}const map:Partial<Record<StreamWeaverFlowActionV1["type"],string>>={"send-chat":"SendChatMessage","send-discord":"DiscordSendMessage",wait:"Delay","run-action":"RunAction","http-request":"ExecuteCode","set-variable":"SetGlobalVariable","execute-code":"ExecuteCode","obs-scene":"ObsSetScene","obs-source":"ObsSetSourceVisibility"};const type=map[action.type]??"ExecuteCode";if(type==="ExecuteCode"&&action.type!=="execute-code")warnings.push(`${action.type} was exported as an ExecuteCode compatibility fallback.`);return{type,enabled:action.enabled,...action.config};}
function remapImportedFlowPackage(value:unknown){const item=structuredClone(object(value,"flow package")),suffix=crypto.randomUUID().slice(0,8),commands=array(item.commands??[],"commands",32),actions=array(item.actions??[],"actions",128),actionMap=new Map<string,string>();for(const raw of actions){const action=object(raw,"action"),old=identifier(action.id,"action.id"),next=`${old}.import-${suffix}`;actionMap.set(old,next);action.id=next;}for(const raw of commands){const command=object(raw,"command"),old=identifier(command.id,"command.id");command.id=`${old}.import-${suffix}`;if(Array.isArray(command.actionIds))command.actionIds=command.actionIds.map((actionId)=>actionMap.get(String(actionId))??actionId);if(Array.isArray(command.edges))command.edges=command.edges.map(raw=>{const edge=object(raw,"edge");return {...edge,source:actionMap.get(String(edge.source))??edge.source,target:actionMap.get(String(edge.target))??edge.target};});}item.packageId=`${identifier(item.packageId,"packageId")}.import-${suffix}`;return item;}
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
