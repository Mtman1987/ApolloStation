export type ProviderKindV1 = "twitch" | "discord" | "xbox" | "github" | "other";

export interface UserRecordV1 {
  id: string;
  createdAt: string;
}

export interface ProviderLinkV1 {
  provider: ProviderKindV1;
  providerUserId: string;
  userId: string;
  linkedAt: string;
}

export interface AppearanceV1 {
  theme: "system" | "light" | "dark";
  accent?: string;
  backgroundUrl?: string;
}

export interface WorkspaceProfileV1 {
  tenantId: string;
  revision: number;
  appearance: AppearanceV1;
  dockSlots: [string | null, string | null, string | null];
  activeOverlaySceneId?: string;
  ttsSubscriptionIds: string[];
  appThemes: Record<string, string>;
  updatedAt: string;
}

export interface XpEventV1 {
  id: string;
  tenantId: string;
  userId: string;
  delta: number;
  sourceAppId: string;
  reason: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface PlatformEventV1 {
  id: string;
  tenantId: string;
  sourceAppId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
}

export interface AuditRecordV1 {
  id: string;
  tenantId?: string;
  actorType: "user" | "service" | "system";
  actorId: string;
  action: string;
  target?: string;
  outcome: "accepted" | "denied" | "duplicate" | "conflict";
  correlationId?: string;
  createdAt: string;
}

export interface IdempotentResultV1<T> {
  duplicate: boolean;
  value: T;
}

export interface AuthorityStore {
  getUser(userId: string): UserRecordV1 | undefined;
  putUser(user: UserRecordV1): void;
  getProviderLink(provider: ProviderKindV1, providerUserId: string): ProviderLinkV1 | undefined;
  putProviderLink(link: ProviderLinkV1): void;
  getWorkspace(tenantId: string): WorkspaceProfileV1 | undefined;
  putWorkspace(profile: WorkspaceProfileV1): void;
  findIdempotent<T>(namespace: string, tenantId: string, key: string): T | undefined;
  putIdempotent<T>(namespace: string, tenantId: string, key: string, value: T): void;
  appendXp(event: XpEventV1): void;
  listXp(tenantId: string, userId: string): XpEventV1[];
  appendEvent(event: PlatformEventV1): void;
  listEvents(tenantId: string): PlatformEventV1[];
  appendAudit(record: AuditRecordV1): void;
  listAudit(tenantId?: string): AuditRecordV1[];
}

export class AuthorityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityConflictError";
  }
}

export class AuthorityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityValidationError";
  }
}

/**
 * Deterministic test/reference adapter only. Production code must bind a
 * durable AuthorityStore and must never silently fall back to this store.
 */
export class MemoryAuthorityStore implements AuthorityStore {
  private readonly users = new Map<string, UserRecordV1>();
  private readonly providerLinks = new Map<string, ProviderLinkV1>();
  private readonly workspaces = new Map<string, WorkspaceProfileV1>();
  private readonly idempotency = new Map<string, unknown>();
  private readonly xp: XpEventV1[] = [];
  private readonly events: PlatformEventV1[] = [];
  private readonly audits: AuditRecordV1[] = [];

  getUser(userId: string) { return cloneJson(this.users.get(userId)); }
  putUser(user: UserRecordV1) { this.users.set(user.id, cloneJson(user)); }
  getProviderLink(provider: ProviderKindV1, providerUserId: string) { return cloneJson(this.providerLinks.get(`${provider}:${providerUserId}`)); }
  putProviderLink(link: ProviderLinkV1) { this.providerLinks.set(`${link.provider}:${link.providerUserId}`, cloneJson(link)); }
  getWorkspace(tenantId: string) { return cloneJson(this.workspaces.get(tenantId)); }
  putWorkspace(profile: WorkspaceProfileV1) { this.workspaces.set(profile.tenantId, cloneJson(profile)); }
  findIdempotent<T>(namespace: string, tenantId: string, key: string) { return cloneJson(this.idempotency.get(`${namespace}:${tenantId}:${key}`)) as T | undefined; }
  putIdempotent<T>(namespace: string, tenantId: string, key: string, value: T) { this.idempotency.set(`${namespace}:${tenantId}:${key}`, cloneJson(value)); }
  appendXp(event: XpEventV1) { this.xp.push(cloneJson(event)); }
  listXp(tenantId: string, userId: string) { return this.xp.filter((item) => item.tenantId === tenantId && item.userId === userId).map((item) => cloneJson(item)); }
  appendEvent(event: PlatformEventV1) { this.events.push(cloneJson(event)); }
  listEvents(tenantId: string) { return this.events.filter((item) => item.tenantId === tenantId).map((item) => cloneJson(item)); }
  appendAudit(record: AuditRecordV1) { this.audits.push(cloneJson(record)); }
  listAudit(tenantId?: string) { return this.audits.filter((item) => tenantId === undefined || item.tenantId === tenantId).map((item) => cloneJson(item)); }
}

export interface AuthorityServiceOptions {
  store: AuthorityStore;
  now?: () => string;
  idFactory?: (prefix: string) => string;
}

export class AuthorityService {
  private sequence = 0;
  private readonly store: AuthorityStore;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(options: AuthorityServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${++this.sequence}`);
  }

  ensureUser(userId: string): UserRecordV1 {
    requireId(userId, "userId");
    const existing = this.store.getUser(userId);
    if (existing) return existing;
    const user = { id: userId, createdAt: this.now() };
    this.store.putUser(user);
    return user;
  }

  linkProvider(userId: string, provider: ProviderKindV1, providerUserId: string): ProviderLinkV1 {
    this.ensureUser(userId);
    requireId(providerUserId, "providerUserId");
    const existing = this.store.getProviderLink(provider, providerUserId);
    if (existing && existing.userId !== userId) {
      throw new AuthorityConflictError(`Provider identity ${provider}:${providerUserId} is already linked to another SPMT user`);
    }
    if (existing) return existing;
    const link = { provider, providerUserId, userId, linkedAt: this.now() };
    this.store.putProviderLink(link);
    return link;
  }

  getOrCreateWorkspace(tenantId: string): WorkspaceProfileV1 {
    requireId(tenantId, "tenantId");
    const existing = this.store.getWorkspace(tenantId);
    if (existing) return existing;
    const profile: WorkspaceProfileV1 = {
      tenantId,
      revision: 1,
      appearance: { theme: "system" },
      dockSlots: [null, null, null],
      ttsSubscriptionIds: [],
      appThemes: {},
      updatedAt: this.now(),
    };
    this.store.putWorkspace(profile);
    return profile;
  }

  updateWorkspace(tenantId: string, expectedRevision: number, patch: Partial<Omit<WorkspaceProfileV1, "tenantId" | "revision" | "updatedAt">>): WorkspaceProfileV1 {
    const current = this.getOrCreateWorkspace(tenantId);
    if (expectedRevision !== current.revision) {
      throw new AuthorityConflictError(`Workspace revision conflict: expected ${expectedRevision}, current ${current.revision}`);
    }
    if (patch.dockSlots && patch.dockSlots.length !== 3) throw new AuthorityValidationError("Workspace must contain exactly three dock slots");
    const next: WorkspaceProfileV1 = {
      ...current,
      ...cloneJson(patch),
      tenantId,
      revision: current.revision + 1,
      updatedAt: this.now(),
    };
    this.store.putWorkspace(next);
    return next;
  }

  awardXp(input: Omit<XpEventV1, "id" | "createdAt">): IdempotentResultV1<XpEventV1> {
    requireId(input.tenantId, "tenantId");
    requireId(input.userId, "userId");
    requireId(input.sourceAppId, "sourceAppId");
    requireId(input.idempotencyKey, "idempotencyKey");
    if (!Number.isSafeInteger(input.delta) || input.delta === 0) throw new AuthorityValidationError("XP delta must be a non-zero safe integer");
    const existing = this.store.findIdempotent<XpEventV1>("xp", input.tenantId, input.idempotencyKey);
    if (existing) return { duplicate: true, value: existing };
    const event: XpEventV1 = { ...cloneJson(input), id: this.idFactory("xp"), createdAt: this.now() };
    this.store.appendXp(event);
    this.store.putIdempotent("xp", input.tenantId, input.idempotencyKey, event);
    return { duplicate: false, value: event };
  }

  getXpBalance(tenantId: string, userId: string) {
    return this.store.listXp(tenantId, userId).reduce((total, item) => total + item.delta, 0);
  }

  publishEvent(input: Omit<PlatformEventV1, "id" | "createdAt">): IdempotentResultV1<PlatformEventV1> {
    requireId(input.tenantId, "tenantId");
    requireId(input.sourceAppId, "sourceAppId");
    requireId(input.type, "type");
    requireId(input.idempotencyKey, "idempotencyKey");
    const existing = this.store.findIdempotent<PlatformEventV1>("event", input.tenantId, input.idempotencyKey);
    if (existing) return { duplicate: true, value: existing };
    const event: PlatformEventV1 = { ...cloneJson(input), id: this.idFactory("evt"), createdAt: this.now() };
    this.store.appendEvent(event);
    this.store.putIdempotent("event", input.tenantId, input.idempotencyKey, event);
    return { duplicate: false, value: event };
  }

  audit(input: Omit<AuditRecordV1, "id" | "createdAt">): AuditRecordV1 {
    requireId(input.actorId, "actorId");
    requireId(input.action, "action");
    const record: AuditRecordV1 = { ...cloneJson(input), id: this.idFactory("audit"), createdAt: this.now() };
    this.store.appendAudit(record);
    return record;
  }
}

function requireId(value: string, name: string) {
  if (!value || value.trim() !== value || value.length > 200) throw new AuthorityValidationError(`${name} is invalid`);
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
