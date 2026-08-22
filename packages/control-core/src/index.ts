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
}

export class ControlService {
  private readonly store: ControlStore;
  private readonly now: () => string;

  constructor(options: ControlServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
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
      const appId = id(input.appId, "appId");
      const existing = this.store.getApp(appId);
      const now = this.now();
      const app: AppManifestV1 = {
        appId,
        name: text(input.name, "name", 120),
        description: text(input.description, "description", 1000),
        version: text(input.version, "version", 80),
        launchUrl: httpsUrl(input.launchUrl, "launchUrl"),
        ...(input.iconUrl ? { iconUrl: httpsUrl(input.iconUrl, "iconUrl") } : {}),
        allowedScopes: scopes(input.allowedScopes),
        surfaces: surfaces(input.surfaces),
        status: input.status,
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
