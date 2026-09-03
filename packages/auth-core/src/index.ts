import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type AuthActorTypeV1 = "user" | "service";
export type TenantModeV1 = "any" | "allow-list";

export interface ServiceIdentityV1 {
  id: string;
  scopes: string[];
  tenantMode: TenantModeV1;
  tenantIds: string[];
  credentialSalt: string;
  credentialHash: string;
  authzVersion: number;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface AccessSessionV1 {
  id: string;
  tokenHash: string;
  actorType: AuthActorTypeV1;
  actorId: string;
  scopes: string[];
  tenantMode: TenantModeV1;
  tenantIds: string[];
  authzVersion?: number;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface RefreshTokenV1 {
  id: string;
  tokenHash: string;
  familyId: string;
  actorId: string;
  scopes: string[];
  tenantIds: string[];
  issuedAt: string;
  expiresAt: string;
  usedAt?: string;
  revokedAt?: string;
}

export interface AuthStore {
  transaction<T>(work: () => T): T;
  getServiceIdentity(serviceId: string): ServiceIdentityV1 | undefined;
  putServiceIdentity(identity: ServiceIdentityV1): void;
  listServiceIdentities(): ServiceIdentityV1[];
  getAccessSessionByTokenHash(tokenHash: string): AccessSessionV1 | undefined;
  putAccessSession(session: AccessSessionV1): void;
  getRefreshTokenByTokenHash(tokenHash: string): RefreshTokenV1 | undefined;
  putRefreshToken(token: RefreshTokenV1): void;
  revokeRefreshFamily(familyId: string, revokedAt: string): void;
}

export interface AuthPrincipalV1 {
  actorType: AuthActorTypeV1;
  actorId: string;
  scopes: string[];
  tenantMode: TenantModeV1;
  tenantIds: string[];
  sessionId: string;
}

export interface IssuedAccessV1 {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
}

export class AuthDeniedError extends Error {
  constructor(message: string) { super(message); this.name = "AuthDeniedError"; }
}

export class AuthConflictError extends Error {
  constructor(message: string) { super(message); this.name = "AuthConflictError"; }
}

export class AuthValidationError extends Error {
  constructor(message: string) { super(message); this.name = "AuthValidationError"; }
}

export interface AuthServiceOptions {
  store: AuthStore;
  now?: () => string;
  tokenFactory?: (kind: "access" | "refresh" | "id") => string;
}

export class AuthService {
  private readonly store: AuthStore;
  private readonly now: () => string;
  private readonly tokenFactory: (kind: "access" | "refresh" | "id") => string;

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.tokenFactory = options.tokenFactory ?? ((kind) => `${kind}_${randomBytes(32).toString("base64url")}`);
  }

  registerServiceIdentity(input: {
    serviceId: string;
    credential: string;
    scopes: string[];
    tenantMode: TenantModeV1;
    tenantIds?: string[];
  }): ServiceIdentityV1 {
    return this.store.transaction(() => {
      requireId(input.serviceId, "serviceId");
      requireCredential(input.credential);
      if (this.store.getServiceIdentity(input.serviceId)) throw new AuthConflictError(`Service identity ${input.serviceId} already exists`);
      const now = this.now();
      const salt = randomBytes(16).toString("base64url");
      const identity: ServiceIdentityV1 = {
        id: input.serviceId,
        scopes: normalizeScopes(input.scopes),
        tenantMode: input.tenantMode,
        tenantIds: normalizeTenants(input.tenantMode, input.tenantIds ?? []),
        credentialSalt: salt,
        credentialHash: deriveCredential(input.credential, salt),
        authzVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.store.putServiceIdentity(identity);
      return publicClone(identity);
    });
  }

  /** Reconciles a supervised service identity to its declared credential and authorization policy. */
  reconcileServiceIdentity(input: {
    serviceId: string;
    credential: string;
    scopes: string[];
    tenantMode: TenantModeV1;
    tenantIds?: string[];
  }): ServiceIdentityV1 {
    return this.store.transaction(() => {
      requireId(input.serviceId, "serviceId");
      requireCredential(input.credential);
      const current = this.store.getServiceIdentity(input.serviceId);
      if (!current) {
        const now = this.now();
        const salt = randomBytes(16).toString("base64url");
        const created: ServiceIdentityV1 = {
          id: input.serviceId,
          scopes: normalizeScopes(input.scopes),
          tenantMode: input.tenantMode,
          tenantIds: normalizeTenants(input.tenantMode, input.tenantIds ?? []),
          credentialSalt: salt,
          credentialHash: deriveCredential(input.credential, salt),
          authzVersion: 1,
          createdAt: now,
          updatedAt: now,
        };
        this.store.putServiceIdentity(created);
        return publicClone(created);
      }
      if (current.revokedAt) throw new AuthDeniedError(`Service identity ${input.serviceId} is revoked`);
      const salt = randomBytes(16).toString("base64url");
      const next: ServiceIdentityV1 = {
        ...current,
        scopes: normalizeScopes(input.scopes),
        tenantMode: input.tenantMode,
        tenantIds: normalizeTenants(input.tenantMode, input.tenantIds ?? []),
        credentialSalt: salt,
        credentialHash: deriveCredential(input.credential, salt),
        authzVersion: current.authzVersion + 1,
        updatedAt: this.now(),
      };
      this.store.putServiceIdentity(next);
      return publicClone(next);
    });
  }

  rotateServiceCredential(serviceId: string, nextCredential: string): ServiceIdentityV1 {
    return this.store.transaction(() => {
      requireCredential(nextCredential);
      const current = this.requireService(serviceId);
      if (current.revokedAt) throw new AuthDeniedError(`Service identity ${serviceId} is revoked`);
      const salt = randomBytes(16).toString("base64url");
      const next: ServiceIdentityV1 = {
        ...current,
        credentialSalt: salt,
        credentialHash: deriveCredential(nextCredential, salt),
        authzVersion: current.authzVersion + 1,
        updatedAt: this.now(),
      };
      this.store.putServiceIdentity(next);
      return publicClone(next);
    });
  }

  revokeServiceIdentity(serviceId: string): ServiceIdentityV1 {
    return this.store.transaction(() => {
      const current = this.requireService(serviceId);
      if (current.revokedAt) return publicClone(current);
      const now = this.now();
      const next: ServiceIdentityV1 = {
        ...current,
        revokedAt: now,
        updatedAt: now,
        authzVersion: current.authzVersion + 1,
      };
      this.store.putServiceIdentity(next);
      return publicClone(next);
    });
  }

  issueServiceAccess(serviceId: string, credential: string, ttlSeconds = 900): IssuedAccessV1 {
    return this.store.transaction(() => {
      const identity = this.requireService(serviceId);
      if (identity.revokedAt || !verifyCredential(credential, identity.credentialSalt, identity.credentialHash)) {
        throw new AuthDeniedError("Invalid service credential");
      }
      return this.issueAccess({
        actorType: "service",
        actorId: identity.id,
        scopes: identity.scopes,
        tenantMode: identity.tenantMode,
        tenantIds: identity.tenantIds,
        authzVersion: identity.authzVersion,
        ttlSeconds: clampTtl(ttlSeconds, 60, 3600),
      });
    });
  }

  issueHumanSession(input: {
    userId: string;
    scopes: string[];
    tenantIds: string[];
    accessTtlSeconds?: number;
    refreshTtlSeconds?: number;
  }): IssuedAccessV1 {
    return this.store.transaction(() => {
      requireId(input.userId, "userId");
      const scopes = normalizeScopes(input.scopes);
      const tenantIds = normalizeTenants("allow-list", input.tenantIds);
      const familyId = this.tokenFactory("id");
      const access = this.issueAccess({
        actorType: "user",
        actorId: input.userId,
        scopes,
        tenantMode: "allow-list",
        tenantIds,
        ttlSeconds: clampTtl(input.accessTtlSeconds ?? 900, 60, 3600),
      });
      const refresh = this.issueRefresh({
        familyId,
        actorId: input.userId,
        scopes,
        tenantIds,
        ttlSeconds: clampTtl(input.refreshTtlSeconds ?? 2_592_000, 300, 7_776_000),
      });
      return { ...access, refreshToken: refresh.token, refreshExpiresAt: refresh.record.expiresAt };
    });
  }

  rotateHumanRefresh(refreshToken: string, accessTtlSeconds = 900): IssuedAccessV1 {
    const tokenHash = hashToken(refreshToken);
    const current = this.store.getRefreshTokenByTokenHash(tokenHash);
    if (!current) throw new AuthDeniedError("Invalid refresh token");
    const now = this.now();
    if (current.revokedAt || isExpired(current.expiresAt, now)) throw new AuthDeniedError("Refresh token is expired or revoked");
    if (current.usedAt) {
      this.store.transaction(() => this.store.revokeRefreshFamily(current.familyId, now));
      throw new AuthDeniedError("Refresh token replay detected; token family revoked");
    }

    return this.store.transaction(() => {
      const latest = this.store.getRefreshTokenByTokenHash(tokenHash);
      if (!latest || latest.revokedAt || isExpired(latest.expiresAt, now)) throw new AuthDeniedError("Refresh token is expired or revoked");
      if (latest.usedAt) throw new AuthDeniedError("Refresh token replay detected; token family revoked");
      this.store.putRefreshToken({ ...latest, usedAt: now });
      const access = this.issueAccess({
        actorType: "user",
        actorId: latest.actorId,
        scopes: latest.scopes,
        tenantMode: "allow-list",
        tenantIds: latest.tenantIds,
        ttlSeconds: clampTtl(accessTtlSeconds, 60, 3600),
      });
      const remainingSeconds = Math.max(300, Math.floor((Date.parse(latest.expiresAt) - Date.parse(now)) / 1000));
      const refresh = this.issueRefresh({
        familyId: latest.familyId,
        actorId: latest.actorId,
        scopes: latest.scopes,
        tenantIds: latest.tenantIds,
        ttlSeconds: remainingSeconds,
      });
      return { ...access, refreshToken: refresh.token, refreshExpiresAt: refresh.record.expiresAt };
    });
  }

  authenticateAccessToken(accessToken: string): AuthPrincipalV1 | undefined {
    const session = this.store.getAccessSessionByTokenHash(hashToken(accessToken));
    if (!session || session.revokedAt || isExpired(session.expiresAt, this.now())) return undefined;
    if (session.actorType === "service") {
      const identity = this.store.getServiceIdentity(session.actorId);
      if (!identity || identity.revokedAt || identity.authzVersion !== session.authzVersion) return undefined;
    }
    return {
      actorType: session.actorType,
      actorId: session.actorId,
      scopes: [...session.scopes],
      tenantMode: session.tenantMode,
      tenantIds: [...session.tenantIds],
      sessionId: session.id,
    };
  }

  authorize(accessToken: string, requiredScope: string, tenantId?: string): AuthPrincipalV1 {
    const principal = this.authenticateAccessToken(accessToken);
    if (!principal) throw new AuthDeniedError("Access token is invalid or expired");
    if (!scopeAllowed(principal.scopes, requiredScope)) throw new AuthDeniedError(`Missing required scope ${requiredScope}`);
    if (tenantId && principal.tenantMode !== "any" && !principal.tenantIds.includes(tenantId)) {
      throw new AuthDeniedError(`Principal is not authorized for tenant ${tenantId}`);
    }
    return principal;
  }

  private requireService(serviceId: string) {
    requireId(serviceId, "serviceId");
    const identity = this.store.getServiceIdentity(serviceId);
    if (!identity) throw new AuthDeniedError(`Unknown service identity ${serviceId}`);
    return identity;
  }

  private issueAccess(input: {
    actorType: AuthActorTypeV1;
    actorId: string;
    scopes: string[];
    tenantMode: TenantModeV1;
    tenantIds: string[];
    authzVersion?: number;
    ttlSeconds: number;
  }): IssuedAccessV1 {
    const token = this.tokenFactory("access");
    const issuedAt = this.now();
    const record: AccessSessionV1 = {
      id: this.tokenFactory("id"),
      tokenHash: hashToken(token),
      actorType: input.actorType,
      actorId: input.actorId,
      scopes: [...input.scopes],
      tenantMode: input.tenantMode,
      tenantIds: [...input.tenantIds],
      issuedAt,
      expiresAt: addSeconds(issuedAt, input.ttlSeconds),
      ...(input.authzVersion === undefined ? {} : { authzVersion: input.authzVersion }),
    };
    this.store.putAccessSession(record);
    return { accessToken: token, accessExpiresAt: record.expiresAt };
  }

  private issueRefresh(input: { familyId: string; actorId: string; scopes: string[]; tenantIds: string[]; ttlSeconds: number }) {
    const token = this.tokenFactory("refresh");
    const issuedAt = this.now();
    const record: RefreshTokenV1 = {
      id: this.tokenFactory("id"),
      tokenHash: hashToken(token),
      familyId: input.familyId,
      actorId: input.actorId,
      scopes: [...input.scopes],
      tenantIds: [...input.tenantIds],
      issuedAt,
      expiresAt: addSeconds(issuedAt, input.ttlSeconds),
    };
    this.store.putRefreshToken(record);
    return { token, record };
  }
}

export function scopeAllowed(granted: string[], required: string) {
  if (granted.includes("*")) return true;
  if (granted.includes(required)) return true;
  const separator = required.indexOf(":");
  return separator > 0 && granted.includes(`${required.slice(0, separator)}:*`);
}

export function hashToken(token: string) {
  if (!token) throw new AuthValidationError("Token is required");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function deriveCredential(credential: string, salt: string) {
  return scryptSync(credential, salt, 32).toString("hex");
}

function verifyCredential(credential: string, salt: string, expectedHex: string) {
  if (!credential) return false;
  const actual = Buffer.from(deriveCredential(credential, salt), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeScopes(scopes: string[]) {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
  if (!normalized.length) throw new AuthValidationError("At least one scope is required");
  if (normalized.some((scope) => scope.length > 120 || !/^[a-z0-9.*:_-]+$/i.test(scope))) throw new AuthValidationError("Scope contains invalid characters");
  return normalized;
}

function normalizeTenants(mode: TenantModeV1, tenantIds: string[]) {
  if (mode === "any") return [];
  const normalized = [...new Set(tenantIds.map((tenant) => tenant.trim()).filter(Boolean))].sort();
  if (!normalized.length) throw new AuthValidationError("Allow-list tenant mode requires at least one tenant");
  normalized.forEach((tenant) => requireId(tenant, "tenantId"));
  return normalized;
}

function requireId(value: string, name: string) {
  if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new AuthValidationError(`${name} is invalid`);
}

function requireCredential(value: string) {
  if (value.length < 24 || value.length > 512) throw new AuthValidationError("Service credential must be 24-512 characters");
}

function clampTtl(value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value)) throw new AuthValidationError("Token TTL must be a safe integer");
  return Math.min(maximum, Math.max(minimum, value));
}

function addSeconds(iso: string, seconds: number) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function isExpired(expiresAt: string, now: string) {
  return Date.parse(expiresAt) <= Date.parse(now);
}

function publicClone(identity: ServiceIdentityV1) {
  return { ...identity, credentialHash: "[REDACTED]", credentialSalt: "[REDACTED]" };
}
