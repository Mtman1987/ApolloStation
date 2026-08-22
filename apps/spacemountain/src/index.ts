import type { AppFrameLaunchV1, RuntimeStateV1, SurfaceModeV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";

export const SPACEMOUNTAIN_APP_ID = "spacemountain";

export type SpaceMountainSource =
  | "session"
  | "workspace"
  | "xp"
  | "shipyard"
  | "installs"
  | "entitlements"
  | "commlink"
  | "notifications"
  | "athena"
  | "setup";

export interface SourceStateV1 {
  state: "ready" | "degraded" | "unavailable";
  detail?: string;
}

export interface SpaceMountainShellInputV1 {
  tenantId: string;
  userId: string;
}

export interface SpaceMountainAppCardV1 {
  appId: string;
  name: string;
  description: string;
  version: string;
  launchUrl: string;
  surfaces: SurfaceModeV1[];
  allowedScopes: string[];
  installed: boolean;
  enabled: boolean;
  grantedScopes: string[];
}

export interface SpaceMountainShellSnapshotV1 {
  state: RuntimeStateV1;
  tenantId: string;
  userId: string;
  session?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
  xp?: { tenantId: string; userId: string; balance: number };
  apps: SpaceMountainAppCardV1[];
  entitlements: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  athena: {
    context: Array<Record<string, unknown>>;
    commands: Array<Record<string, unknown>>;
  };
  setupOptions: Array<Record<string, unknown>>;
  sources: Record<SpaceMountainSource, SourceStateV1>;
}

export interface AppFrameTargetV1 {
  url: string;
  allowedOrigin: string;
  launch: AppFrameLaunchV1;
}

export class SpaceMountainShellController {
  constructor(private readonly spmt: SpmtClient) {}

  async load(input: SpaceMountainShellInputV1): Promise<SpaceMountainShellSnapshotV1> {
    requireId(input.tenantId, "tenantId");
    requireId(input.userId, "userId");

    const tasks = {
      session: this.spmt.getSession(),
      workspace: this.spmt.getWorkspaceProfile(input.tenantId),
      xp: this.spmt.getXpBalance(input.tenantId, input.userId),
      shipyard: this.spmt.listApps(),
      installs: this.spmt.listInstalls(input.tenantId),
      entitlements: this.spmt.listEntitlements(input.tenantId),
      commlink: this.spmt.listConversations(input.tenantId, input.userId),
      notifications: this.spmt.listNotifications(input.tenantId, input.userId),
      athenaContext: this.spmt.listAthenaContext(input.tenantId, input.userId),
      athenaCommands: this.spmt.listAthenaCommands(),
      setup: this.spmt.request<{ options?: Array<Record<string, unknown>> }>("/v1/auth/setup-options"),
    };

    const keys = Object.keys(tasks) as Array<keyof typeof tasks>;
    const settled = await Promise.allSettled(keys.map((key) => tasks[key]));
    const values = new Map<keyof typeof tasks, unknown>();
    const failures = new Map<keyof typeof tasks, string>();
    settled.forEach((result, index) => {
      const key = keys[index];
      if (!key) return;
      if (result.status === "fulfilled") values.set(key, result.value);
      else failures.set(key, errorDetail(result.reason));
    });

    const session = record(values.get("session"));
    const workspace = record(values.get("workspace"));
    const rawApps = records(values.get("shipyard"));
    const rawInstalls = records(values.get("installs"));
    const apps = joinApps(rawApps, rawInstalls);
    const sources: Record<SpaceMountainSource, SourceStateV1> = {
      session: source(failures, ["session"]),
      workspace: source(failures, ["workspace"]),
      xp: source(failures, ["xp"]),
      shipyard: source(failures, ["shipyard"]),
      installs: source(failures, ["installs"]),
      entitlements: source(failures, ["entitlements"]),
      commlink: source(failures, ["commlink"]),
      notifications: source(failures, ["notifications"]),
      athena: source(failures, ["athenaContext", "athenaCommands"]),
      setup: source(failures, ["setup"]),
    };

    const state: RuntimeStateV1 = failures.has("session") || failures.has("workspace")
      ? "unavailable"
      : failures.size > 0 ? "degraded" : "ready";

    const setupPayload = record(values.get("setup"));
    return {
      state,
      tenantId: input.tenantId,
      userId: input.userId,
      ...(session ? { session } : {}),
      ...(workspace ? { workspace } : {}),
      ...(isXp(values.get("xp")) ? { xp: values.get("xp") as { tenantId: string; userId: string; balance: number } } : {}),
      apps,
      entitlements: records(values.get("entitlements")),
      conversations: records(values.get("commlink")),
      notifications: records(values.get("notifications")),
      athena: { context: records(values.get("athenaContext")), commands: records(values.get("athenaCommands")) },
      setupOptions: Array.isArray(setupPayload?.options) ? setupPayload.options.filter(isRecord) : [],
      sources,
    };
  }

  async installApp(tenantId: string, appId: string, scopes?: string[]) {
    return this.spmt.installApp(tenantId, appId, scopes);
  }

  async disableApp(tenantId: string, appId: string) {
    return this.spmt.disableApp(tenantId, appId);
  }

  async saveWorkspace(tenantId: string, expectedRevision: number, patch: Record<string, unknown>) {
    return this.spmt.updateWorkspaceProfile(tenantId, expectedRevision, patch);
  }

  async markNotificationRead(tenantId: string, notificationId: string, userId?: string) {
    return this.spmt.markNotificationRead(tenantId, notificationId, userId);
  }
}

export function buildAppFrameTarget(app: SpaceMountainAppCardV1, tenantId: string, mode: SurfaceModeV1, launchId: string): AppFrameTargetV1 {
  if (!app.installed || !app.enabled) throw new Error(`App ${app.appId} is not enabled for this tenant`);
  if (!app.surfaces.includes(mode)) throw new Error(`App ${app.appId} does not support ${mode}`);
  const parsed = new URL(app.launchUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Embedded app launch URL must use HTTPS");
  if (parsed.username || parsed.password) throw new Error("Embedded app launch URL may not contain credentials");
  return {
    url: parsed.toString(),
    allowedOrigin: parsed.origin,
    launch: {
      schemaVersion: 1,
      launchId: requireId(launchId, "launchId"),
      appId: app.appId,
      surfaceMode: mode,
      tenantId: requireId(tenantId, "tenantId"),
      requestedScopes: [...app.grantedScopes],
    },
  };
}

export const DEFERRED_RUNTIME_SOURCES = Object.freeze([
  { id: "streamweaver-live-chat", owner: "streamweaver", presentation: "Commlink Live Chat", requiredForShell: false },
  { id: "athena-inference", owner: "streamweaver-workers", presentation: "Athena runtime", requiredForShell: false },
  { id: "companion-device-relay", owner: "companion-mountainview", presentation: "Companion devices", requiredForShell: false },
]);

function joinApps(apps: Array<Record<string, unknown>>, installs: Array<Record<string, unknown>>): SpaceMountainAppCardV1[] {
  const installByApp = new Map(installs.map((item) => [String(item.appId ?? ""), item]));
  return apps.map((app) => {
    const appId = String(app.appId ?? "");
    const install = installByApp.get(appId);
    return {
      appId,
      name: String(app.name ?? appId),
      description: String(app.description ?? ""),
      version: String(app.version ?? ""),
      launchUrl: String(app.launchUrl ?? ""),
      surfaces: surfaceModes(app.surfaces),
      allowedScopes: strings(app.allowedScopes),
      installed: Boolean(install),
      enabled: Boolean(install?.enabled),
      grantedScopes: strings(install?.grantedScopes),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function source(failures: Map<string, string>, keys: string[]): SourceStateV1 {
  const messages = keys.map((key) => failures.get(key)).filter((value): value is string => Boolean(value));
  return messages.length ? { state: "degraded", detail: messages.join("; ") } : { state: "ready" };
}
function record(value: unknown) { return isRecord(value) ? value : undefined; }
function records(value: unknown) { return Array.isArray(value) ? value.filter(isRecord) : []; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function surfaceModes(value: unknown): SurfaceModeV1[] { const allowed = new Set<SurfaceModeV1>(["shell", "standalone", "overlay", "popout"]); return strings(value).filter((item): item is SurfaceModeV1 => allowed.has(item as SurfaceModeV1)); }
function isXp(value: unknown): value is { tenantId: string; userId: string; balance: number } { return isRecord(value) && typeof value.tenantId === "string" && typeof value.userId === "string" && typeof value.balance === "number"; }
function errorDetail(value: unknown) { return value instanceof Error ? value.message : String(value ?? "unknown error"); }
function requireId(value: string, name: string) { if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); return value; }
