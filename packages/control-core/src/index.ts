import { createHash, randomBytes } from "node:crypto";
import { assertAppCatalogRegistrationV1, assertOverlayWidgetManifestV1, type AppRuntimeProjectionV1, type IssuedOverlayOutputGrantV1, type OverlayOutputGrantV1, type OverlayOutputResolutionV1, type OverlayWidgetManifestV1, type RegisteredOverlayWidgetV1, type RuntimeStateV1 } from "@spmt/contracts";

export type TenantStatusV1 = "active" | "suspended";
export type AppStatusV1 = "active" | "disabled";
export type AppSurfaceV1 = "shell" | "standalone" | "overlay" | "popout";

export interface TenantRecordV1 {
  id: string;
  ownerUserId: string;
  displayName: string;
  status: TenantStatusV1;
  createdAt: string;
  updatedAt: string;
}

export interface AppManifestV1 {
  appId: string;
  name: string;
  description: string;
  version: string;
  launchUrl: string;
  iconUrl?: string;
  allowedScopes: string[];
  surfaces: AppSurfaceV1[];
  status: AppStatusV1;
  createdAt: string;
  updatedAt: string;
}

export interface AppInstallV1 {
  tenantId: string;
  appId: string;
  enabled: boolean;
  grantedScopes: string[];
  installedAt: string;
  updatedAt: string;
}

export interface EntitlementV1 {
  tenantId: string;
  appId: string;
  key: string;
  value: string | number | boolean;
  updatedAt: string;
}

/** Internal persistence form. tokenHash is deliberately absent from all public grant contracts. */
export interface StoredOverlayOutputGrantV1 extends OverlayOutputGrantV1 {
  tokenHash: string;
}

export interface ControlStore {
  transaction<T>(work: () => T): T;
  getTenant(tenantId: string): TenantRecordV1 | undefined;
  putTenant(tenant: TenantRecordV1): void;
  listTenants(): TenantRecordV1[];
  getApp(appId: string): AppManifestV1 | undefined;
  putApp(app: AppManifestV1): void;
  listApps(): AppManifestV1[];
  getInstall(tenantId: string, appId: string): AppInstallV1 | undefined;
  putInstall(install: AppInstallV1): void;
  listInstalls(tenantId: string): AppInstallV1[];
  getEntitlement(tenantId: string, appId: string, key: string): EntitlementV1 | undefined;
  putEntitlement(entitlement: EntitlementV1): void;
  listEntitlements(tenantId: string, appId?: string): EntitlementV1[];
  getOverlayWidget(tenantId: string, appId: string, widgetId: string): RegisteredOverlayWidgetV1 | undefined;
  putOverlayWidget(widget: RegisteredOverlayWidgetV1): void;
  listOverlayWidgets(tenantId: string, appId?: string): RegisteredOverlayWidgetV1[];
  getOverlayOutputGrant(grantId: string): StoredOverlayOutputGrantV1 | undefined;
  getOverlayOutputGrantByTokenHash(tokenHash: string): StoredOverlayOutputGrantV1 | undefined;
  putOverlayOutputGrant(grant: StoredOverlayOutputGrantV1): void;
  listOverlayOutputGrants(tenantId: string, appId?: string): StoredOverlayOutputGrantV1[];
  getRuntimeProjection(tenantId: string, appId: string): AppRuntimeProjectionV1 | undefined;
  putRuntimeProjection(projection: AppRuntimeProjectionV1): void;
  listRuntimeProjections(tenantId: string, appId?: string): AppRuntimeProjectionV1[];
}

export class ControlConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ControlConflictError"; }
}
export class ControlNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "ControlNotFoundError"; }
}
export class ControlValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ControlValidationError"; }
}

export interface ControlServiceOptions {
  store: ControlStore;
  now?: () => string;
  outputBaseUrl?: string;
  tokenFactory?: (kind: "grant-id" | "output-token") => string;
}

export class ControlService {
  private readonly store: ControlStore;
  private readonly now: () => string;
  private readonly outputBaseUrl: string | undefined;
  private readonly tokenFactory: (kind: "grant-id" | "output-token") => string;

  constructor(options: ControlServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.outputBaseUrl = options.outputBaseUrl === undefined ? undefined : outputBaseUrl(options.outputBaseUrl);
    this.tokenFactory = options.tokenFactory ?? ((kind) => kind === "grant-id" ? `out_${randomBytes(12).toString("base64url")}` : randomBytes(32).toString("base64url"));
  }

  registerTenant(input: { tenantId: string; ownerUserId: string; displayName: string }): TenantRecordV1 {
    return this.store.transaction(() => {
      const tenantId = id(input.tenantId, "tenantId");
      const ownerUserId = id(input.ownerUserId, "ownerUserId");
      const displayName = text(input.displayName, "displayName", 120);
      const existing = this.store.getTenant(tenantId);
      if (existing) {
        if (existing.ownerUserId !== ownerUserId) throw new ControlConflictError(`Tenant ${tenantId} already belongs to another owner`);
        return existing;
      }
      const now = this.now();
      const tenant: TenantRecordV1 = { id: tenantId, ownerUserId, displayName, status: "active", createdAt: now, updatedAt: now };
      this.store.putTenant(tenant);
      return tenant;
    });
  }

  getTenant(tenantId: string) {
    const tenant = this.store.getTenant(id(tenantId, "tenantId"));
    if (!tenant) throw new ControlNotFoundError(`Tenant ${tenantId} does not exist`);
    return tenant;
  }

  registerApp(input: Omit<AppManifestV1, "createdAt" | "updatedAt">): AppManifestV1 {
    return this.store.transaction(() => {
      let normalized;
      try { normalized = assertAppCatalogRegistrationV1(input); }
      catch (error) { throw new ControlValidationError(error instanceof Error ? error.message : "App catalog manifest is invalid"); }
      const existing = this.store.getApp(normalized.appId);
      const now = this.now();
      const app: AppManifestV1 = {
        ...normalized,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.store.putApp(app);
      return app;
    });
  }

  listApps() { return this.store.listApps().filter((app) => app.status === "active"); }

  getApp(appId: string) {
    const app = this.store.getApp(id(appId, "appId"));
    if (!app) throw new ControlNotFoundError(`App ${appId} does not exist`);
    return app;
  }

  installApp(tenantId: string, appId: string, grantedScopes?: string[]): AppInstallV1 {
    return this.store.transaction(() => {
      const tenant = this.getTenant(tenantId);
      if (tenant.status !== "active") throw new ControlConflictError(`Tenant ${tenant.id} is suspended`);
      const app = this.getApp(appId);
      if (app.status !== "active") throw new ControlConflictError(`App ${app.appId} is disabled`);
      const requested = scopes(grantedScopes ?? app.allowedScopes);
      const invalid = requested.filter((scope) => !app.allowedScopes.includes(scope));
      if (invalid.length) throw new ControlValidationError(`Scopes are not allowed by ${app.appId}: ${invalid.join(", ")}`);
      const existing = this.store.getInstall(tenant.id, app.appId);
      const now = this.now();
      const install: AppInstallV1 = {
        tenantId: tenant.id,
        appId: app.appId,
        enabled: true,
        grantedScopes: requested,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
      };
      this.store.putInstall(install);
      return install;
    });
  }

  disableApp(tenantId: string, appId: string): AppInstallV1 {
    return this.store.transaction(() => {
      const existing = this.store.getInstall(id(tenantId, "tenantId"), id(appId, "appId"));
      if (!existing) throw new ControlNotFoundError(`App ${appId} is not installed for tenant ${tenantId}`);
      const next = { ...existing, enabled: false, updatedAt: this.now() };
      this.store.putInstall(next);
      return next;
    });
  }

  listInstalls(tenantId: string) {
    this.getTenant(tenantId);
    return this.store.listInstalls(tenantId);
  }

  setEntitlement(input: { tenantId: string; appId: string; key: string; value: string | number | boolean }): EntitlementV1 {
    return this.store.transaction(() => {
      this.getTenant(input.tenantId);
      this.getApp(input.appId);
      const key = id(input.key, "entitlement key");
      if (!["string", "number", "boolean"].includes(typeof input.value)) throw new ControlValidationError("Entitlement value must be string, number, or boolean");
      const entitlement: EntitlementV1 = { tenantId: input.tenantId, appId: input.appId, key, value: input.value, updatedAt: this.now() };
      this.store.putEntitlement(entitlement);
      return entitlement;
    });
  }

  listEntitlements(tenantId: string, appId?: string) {
    this.getTenant(tenantId);
    if (appId) this.getApp(appId);
    return this.store.listEntitlements(tenantId, appId);
  }

  registerOverlayWidget(input: { tenantId: string; manifest: OverlayWidgetManifestV1 }): RegisteredOverlayWidgetV1 {
    return this.store.transaction(() => {
      const tenantId = id(input.tenantId, "tenantId");
      const appId = id(input.manifest.appId, "appId");
      this.requireEnabledInstall(tenantId, appId);
      let manifest: OverlayWidgetManifestV1;
      try { manifest = assertOverlayWidgetManifestV1(input.manifest); }
      catch (error) { throw new ControlValidationError(error instanceof Error ? error.message : "Overlay widget manifest is invalid"); }
      const app = this.getApp(appId);
      const invalidScopes = manifest.requiredScopes.filter((scope) => !app.allowedScopes.includes(scope));
      if (invalidScopes.length) throw new ControlValidationError(`Overlay widget scopes are not allowed by ${appId}: ${invalidScopes.join(", ")}`);
      const widgetId = id(manifest.widgetId, "widgetId");
      const existing = this.store.getOverlayWidget(tenantId, appId, widgetId);
      const now = this.now();
      const widget: RegisteredOverlayWidgetV1 = {
        schemaVersion: 1,
        tenantId,
        manifest: { ...manifest, appId, widgetId, requiredScopes: scopes(manifest.requiredScopes) },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.store.putOverlayWidget(widget);
      return widget;
    });
  }

  listOverlayWidgets(tenantId: string, appId?: string) {
    const normalizedTenantId = id(tenantId, "tenantId");
    this.getTenant(normalizedTenantId);
    if (appId) this.getApp(id(appId, "appId"));
    return this.store.listOverlayWidgets(normalizedTenantId, appId);
  }

  issueOverlayOutputGrant(input: { tenantId: string; appId: string; widgetId: string; createdByUserId: string; viewerUserId?: string; ttlMs?: number }): IssuedOverlayOutputGrantV1 {
    return this.store.transaction(() => {
      const tenantId = id(input.tenantId, "tenantId");
      const appId = id(input.appId, "appId");
      const widgetId = id(input.widgetId, "widgetId");
      const createdByUserId = id(input.createdByUserId, "createdByUserId");
      const tenant = this.getTenant(tenantId);
      if (tenant.ownerUserId !== createdByUserId) throw new ControlConflictError("Only the tenant owner may issue overlay output grants");
      this.requireEnabledInstall(tenantId, appId);
      if (!this.store.getOverlayWidget(tenantId, appId, widgetId)) throw new ControlNotFoundError(`Overlay widget ${appId}/${widgetId} is not registered for tenant ${tenantId}`);
      if (!this.outputBaseUrl) throw new ControlConflictError("Overlay output base URL is not configured");
      const ttlMs = outputTtl(input.ttlMs);
      const createdAt = this.now();
      const createdTime = Date.parse(createdAt);
      if (!Number.isFinite(createdTime)) throw new ControlConflictError("Control clock returned an invalid timestamp");
      const token = opaqueToken(this.tokenFactory("output-token"), "output token");
      const grantId = id(this.tokenFactory("grant-id"), "grantId");
      if (this.store.getOverlayOutputGrant(grantId)) throw new ControlConflictError("Overlay output grant ID collision; retry issuance");
      const grant: StoredOverlayOutputGrantV1 = {
        schemaVersion: 1,
        grantId,
        tenantId,
        appId,
        widgetId,
        ...(input.viewerUserId === undefined ? {} : { viewerUserId: id(input.viewerUserId, "viewerUserId") }),
        createdByUserId,
        createdAt,
        expiresAt: new Date(createdTime + ttlMs).toISOString(),
        tokenHash: hashOutputToken(token),
      };
      this.store.putOverlayOutputGrant(grant);
      return { schemaVersion: 1, grant: publicOutputGrant(grant), browserSourceUrl: `${this.outputBaseUrl}/o/${encodeURIComponent(token)}` };
    });
  }

  listOverlayOutputGrants(tenantId: string, appId?: string): OverlayOutputGrantV1[] {
    const normalizedTenantId = id(tenantId, "tenantId");
    this.getTenant(normalizedTenantId);
    const normalizedAppId = appId === undefined ? undefined : id(appId, "appId");
    if (normalizedAppId) this.getApp(normalizedAppId);
    return this.store.listOverlayOutputGrants(normalizedTenantId, normalizedAppId).map(publicOutputGrant);
  }

  revokeOverlayOutputGrant(input: { tenantId: string; grantId: string; revokedByUserId: string }): OverlayOutputGrantV1 {
    return this.store.transaction(() => {
      const tenantId = id(input.tenantId, "tenantId");
      const revokedByUserId = id(input.revokedByUserId, "revokedByUserId");
      const tenant = this.getTenant(tenantId);
      if (tenant.ownerUserId !== revokedByUserId) throw new ControlConflictError("Only the tenant owner may revoke overlay output grants");
      const grant = this.store.getOverlayOutputGrant(id(input.grantId, "grantId"));
      if (!grant || grant.tenantId !== tenantId) throw new ControlNotFoundError("Overlay output grant does not exist");
      if (grant.revokedAt) return publicOutputGrant(grant);
      const revoked = { ...grant, revokedAt: this.now() };
      this.store.putOverlayOutputGrant(revoked);
      return publicOutputGrant(revoked);
    });
  }

  resolveOverlayOutputToken(token: string): OverlayOutputResolutionV1 {
    const normalizedToken = opaqueToken(token, "output token");
    const grant = this.store.getOverlayOutputGrantByTokenHash(hashOutputToken(normalizedToken));
    if (!grant) throw new ControlNotFoundError("Overlay output is unavailable");
    if (grant.revokedAt || Date.parse(grant.expiresAt) <= Date.parse(this.now())) throw new ControlNotFoundError("Overlay output is unavailable");
    this.requireEnabledInstall(grant.tenantId, grant.appId);
    const widget = this.store.getOverlayWidget(grant.tenantId, grant.appId, grant.widgetId);
    if (!widget) throw new ControlNotFoundError("Overlay output is unavailable");
    return {
      schemaVersion: 1,
      principal: {
        schemaVersion: 1,
        grantId: grant.grantId,
        tenantId: grant.tenantId,
        appId: grant.appId,
        widgetId: grant.widgetId,
        ...(grant.viewerUserId === undefined ? {} : { viewerUserId: grant.viewerUserId }),
      },
      rendererUrl: widget.manifest.rendererUrl,
    };
  }

  reportRuntimeState(input: { tenantId: string; appId: string; state: RuntimeStateV1; detail?: string }): AppRuntimeProjectionV1 {
    return this.store.transaction(() => {
      const tenantId = id(input.tenantId, "tenantId");
      const appId = id(input.appId, "appId");
      this.requireEnabledInstall(tenantId, appId);
      const allowed = new Set<RuntimeStateV1>(["starting", "ready", "degraded", "draining", "unavailable"]);
      if (!allowed.has(input.state)) throw new ControlValidationError("Runtime state is invalid");
      const projection: AppRuntimeProjectionV1 = {
        schemaVersion: 1,
        tenantId,
        appId,
        state: input.state,
        ...(input.detail === undefined ? {} : { detail: text(input.detail, "detail", 1000) }),
        updatedAt: this.now(),
      };
      this.store.putRuntimeProjection(projection);
      return projection;
    });
  }

  listRuntimeProjections(tenantId: string, appId?: string) {
    const normalizedTenantId = id(tenantId, "tenantId");
    this.getTenant(normalizedTenantId);
    if (appId) this.getApp(id(appId, "appId"));
    return this.store.listRuntimeProjections(normalizedTenantId, appId);
  }

  private requireEnabledInstall(tenantId: string, appId: string) {
    const tenant = this.getTenant(tenantId);
    if (tenant.status !== "active") throw new ControlConflictError(`Tenant ${tenantId} is suspended`);
    const app = this.getApp(appId);
    if (app.status !== "active") throw new ControlConflictError(`App ${appId} is disabled`);
    const install = this.store.getInstall(tenantId, appId);
    if (!install?.enabled) throw new ControlConflictError(`App ${appId} is not enabled for tenant ${tenantId}`);
    return install;
  }
}

function id(value: string, name: string) {
  if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new ControlValidationError(`${name} is invalid`);
  return value;
}
function text(value: string, name: string, max: number) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max) throw new ControlValidationError(`${name} is invalid`);
  return normalized;
}
function scopes(values: string[]) {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (normalized.some((value) => value.length > 120 || !/^[A-Za-z0-9.*:_-]+$/.test(value))) throw new ControlValidationError("Scope contains invalid characters");
  return normalized;
}
function surfaces(values: AppSurfaceV1[]) {
  const allowed = new Set<AppSurfaceV1>(["shell", "standalone", "overlay", "popout"]);
  const normalized = [...new Set(values)];
  if (!normalized.length || normalized.some((value) => !allowed.has(value))) throw new ControlValidationError("App must declare valid surface modes");
  return normalized;
}
function httpsUrl(value: string, name: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ControlValidationError(`${name} must be an absolute URL`); }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new ControlValidationError(`${name} must use HTTPS`);
  if (url.username || url.password) throw new ControlValidationError(`${name} may not contain embedded credentials`);
  return url.toString();
}
function outputBaseUrl(value: string) {
  const normalized = httpsUrl(value, "outputBaseUrl");
  const url = new URL(normalized);
  if (url.search || url.hash) throw new ControlValidationError("outputBaseUrl may not contain a query or fragment");
  return normalized.replace(/\/$/, "");
}
function outputTtl(value?: number) {
  const ttl = value ?? 30 * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(ttl) || ttl < 5 * 60 * 1000 || ttl > 90 * 24 * 60 * 60 * 1000) throw new ControlValidationError("Overlay output ttlMs must be between 5 minutes and 90 days");
  return ttl;
}
function opaqueToken(value: string, name: string) {
  if (typeof value !== "string" || value.length < 24 || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ControlValidationError(`${name} is invalid`);
  return value;
}
function hashOutputToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function publicOutputGrant(grant: StoredOverlayOutputGrantV1): OverlayOutputGrantV1 {
  const { tokenHash: _tokenHash, ...value } = grant;
  return value;
}
