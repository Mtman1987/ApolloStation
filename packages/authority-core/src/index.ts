export type ProviderKindV1 = "twitch" | "discord" | "xbox" | "github" | "other";

export interface UserRecordV1 { id: string; createdAt: string; }
export interface ProviderLinkV1 { provider: ProviderKindV1; providerUserId: string; userId: string; linkedAt: string; }
export interface AppearanceV1 { theme: "system" | "light" | "dark"; accent?: string; backgroundUrl?: string; }
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
  id: string; tenantId: string; userId: string; delta: number; sourceAppId: string;
  reason: string; idempotencyKey: string; createdAt: string;
}
export interface PlatformEventV1 {
  id: string; tenantId: string; sourceAppId: string; type: string;
  payload: Record<string, unknown>; idempotencyKey: string; createdAt: string;
}
export interface AuditRecordV1 {
  id: string; tenantId?: string; actorType: "user" | "service" | "system";
  actorId: string; action: string; target?: string;
  outcome: "accepted" | "denied" | "duplicate" | "conflict";
  correlationId?: string; createdAt: string;
}
export type OutboxStateV1 = "pending" | "leased" | "delivered" | "dead";
export interface OutboxRecordV1 {
  id: string;
  eventId: string;
  tenantId: string;
  topic: string;
  payload: Record<string, unknown>;
  state: OutboxStateV1;
  attempts: number;
  availableAt: string;
  createdAt: string;
  leaseOwner?: string;
  leaseUntil?: string;
  deliveredAt?: string;
  lastError?: string;
}
export interface AuthorityJournalEntryV1 {
  sequence: number;
  epoch: number;
  kind: "user" | "provider-link" | "workspace" | "xp" | "event" | "audit" | "service-identity" | "outbox" | "tenant" | "app" | "install" | "entitlement";
  tenantId?: string;
  recordId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface IdempotentResultV1<T> { duplicate: boolean; value: T; }

export interface AuthorityStore {
  transaction<T>(work: () => T): T;
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
  getOutbox(id: string): OutboxRecordV1 | undefined;
  putOutbox(record: OutboxRecordV1): void;
  listClaimableOutbox(now: string, limit: number): OutboxRecordV1[];
  listOutbox(): OutboxRecordV1[];
  getAuthorityEpoch(): number;
  promoteAuthorityEpoch(nextEpoch: number): number;
  listJournal(afterSequence?: number): AuthorityJournalEntryV1[];
}

export class AuthorityConflictError extends Error {
  constructor(message: string) { super(message); this.name = "AuthorityConflictError"; }
}
export class AuthorityValidationError extends Error {
  constructor(message: string) { super(message); this.name = "AuthorityValidationError"; }
}

/** Test/reference adapter only. Production must bind a durable store and never silently fall back here. */
export class MemoryAuthorityStore implements AuthorityStore {
  private readonly users = new Map<string, UserRecordV1>();
  private readonly providerLinks = new Map<string, ProviderLinkV1>();
  private readonly workspaces = new Map<string, WorkspaceProfileV1>();
  private readonly idempotency = new Map<string, unknown>();
  private readonly xp: XpEventV1[] = [];
  private readonly events: PlatformEventV1[] = [];
  private readonly audits: AuditRecordV1[] = [];
  private readonly outbox = new Map<string, OutboxRecordV1>();
  private readonly journal: AuthorityJournalEntryV1[] = [];
  private epoch = 1;
  private journalSequence = 0;

  transaction<T>(work: () => T): T { return work(); }
  getUser(userId: string) { return cloneJson(this.users.get(userId)); }
  putUser(user: UserRecordV1) { this.users.set(user.id, cloneJson(user)); this.writeJournal("user", user.id, user); }
  getProviderLink(provider: ProviderKindV1, providerUserId: string) { return cloneJson(this.providerLinks.get(`${provider}:${providerUserId}`)); }
  putProviderLink(link: ProviderLinkV1) { this.providerLinks.set(`${link.provider}:${link.providerUserId}`, cloneJson(link)); this.writeJournal("provider-link", `${link.provider}:${link.providerUserId}`, link); }
  getWorkspace(tenantId: string) { return cloneJson(this.workspaces.get(tenantId)); }
  putWorkspace(profile: WorkspaceProfileV1) { this.workspaces.set(profile.tenantId, cloneJson(profile)); this.writeJournal("workspace", profile.tenantId, profile, profile.tenantId); }
  findIdempotent<T>(namespace: string, tenantId: string, key: string) { return cloneJson(this.idempotency.get(`${namespace}:${tenantId}:${key}`)) as T | undefined; }
  putIdempotent<T>(namespace: string, tenantId: string, key: string, value: T) { this.idempotency.set(`${namespace}:${tenantId}:${key}`, cloneJson(value)); }
  appendXp(event: XpEventV1) { this.xp.push(cloneJson(event)); this.writeJournal("xp", event.id, event, event.tenantId); }
  listXp(tenantId: string, userId: string) { return this.xp.filter((item) => item.tenantId === tenantId && item.userId === userId).map(cloneJson); }
  appendEvent(event: PlatformEventV1) { this.events.push(cloneJson(event)); this.writeJournal("event", event.id, event, event.tenantId); }
  listEvents(tenantId: string) { return this.events.filter((item) => item.tenantId === tenantId).map(cloneJson); }
  appendAudit(record: AuditRecordV1) { this.audits.push(cloneJson(record)); this.writeJournal("audit", record.id, record, record.tenantId); }
  listAudit(tenantId?: string) { return this.audits.filter((item) => tenantId === undefined || item.tenantId === tenantId).map(cloneJson); }
  getOutbox(id: string) { return cloneJson(this.outbox.get(id)); }
  putOutbox(record: OutboxRecordV1) { this.outbox.set(record.id, cloneJson(record)); this.writeJournal("outbox", record.id, record, record.tenantId); }
  listClaimableOutbox(now: string, limit: number) {
    return [...this.outbox.values()].filter((item) => item.state === "pending" ? item.availableAt <= now : item.state === "leased" && Boolean(item.leaseUntil) && item.leaseUntil! <= now).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit).map(cloneJson);
  }
  listOutbox() { return [...this.outbox.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(cloneJson); }
  getAuthorityEpoch() { return this.epoch; }
  promoteAuthorityEpoch(nextEpoch: number) {
    if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= this.epoch) throw new AuthorityConflictError("Authority epoch must increase monotonically");
    this.epoch = nextEpoch;
    return this.epoch;
  }
  listJournal(afterSequence = 0) { return this.journal.filter((entry) => entry.sequence > afterSequence).map(cloneJson); }

  private writeJournal(kind: AuthorityJournalEntryV1["kind"], recordId: string, payload: object, tenantId?: string) {
    this.journal.push({ sequence: ++this.journalSequence, epoch: this.epoch, kind, ...(tenantId ? { tenantId } : {}), recordId, payload: cloneJson(payload) as Record<string, unknown>, createdAt: new Date().toISOString() });
  }
}

export interface AuthorityServiceOptions { store: AuthorityStore; now?: () => string; idFactory?: (prefix: string) => string; }

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
    return this.store.transaction(() => this.ensureUserInTransaction(userId));
  }

  linkProvider(userId: string, provider: ProviderKindV1, providerUserId: string): ProviderLinkV1 {
    return this.store.transaction(() => {
      this.ensureUserInTransaction(userId);
      requireId(providerUserId, "providerUserId");
      const existing = this.store.getProviderLink(provider, providerUserId);
      if (existing && existing.userId !== userId) throw new AuthorityConflictError(`Provider identity ${provider}:${providerUserId} is already linked to another SPMT user`);
      if (existing) return existing;
      const link = { provider, providerUserId, userId, linkedAt: this.now() };
      this.store.putProviderLink(link);
      return link;
    });
  }

  getWorkspace(tenantId: string): WorkspaceProfileV1 | undefined {
    requireId(tenantId, "tenantId");
    return this.store.getWorkspace(tenantId);
  }

  getOrCreateWorkspace(tenantId: string): WorkspaceProfileV1 {
    requireId(tenantId, "tenantId");
    return this.store.transaction(() => {
      const existing = this.store.getWorkspace(tenantId);
      if (existing) return existing;
      const profile: WorkspaceProfileV1 = { tenantId, revision: 1, appearance: { theme: "system" }, dockSlots: [null, null, null], ttsSubscriptionIds: [], appThemes: {}, updatedAt: this.now() };
      this.store.putWorkspace(profile);
      return profile;
    });
  }

  updateWorkspace(tenantId: string, expectedRevision: number, patch: Partial<Omit<WorkspaceProfileV1, "tenantId" | "revision" | "updatedAt">>): WorkspaceProfileV1 {
    return this.store.transaction(() => {
      const current = this.store.getWorkspace(tenantId);
      if (!current) throw new AuthorityConflictError(`Workspace ${tenantId} does not exist; create it before revisioned updates`);
      if (expectedRevision !== current.revision) throw new AuthorityConflictError(`Workspace revision conflict: expected ${expectedRevision}, current ${current.revision}`);
      if (patch.dockSlots && patch.dockSlots.length !== 3) throw new AuthorityValidationError("Workspace must contain exactly three dock slots");
      const next: WorkspaceProfileV1 = { ...current, ...cloneJson(patch), tenantId, revision: current.revision + 1, updatedAt: this.now() };
      this.store.putWorkspace(next);
      return next;
    });
  }

  awardXp(input: Omit<XpEventV1, "id" | "createdAt">): IdempotentResultV1<XpEventV1> {
    return this.store.transaction(() => {
      requireId(input.tenantId, "tenantId"); requireId(input.userId, "userId");
      requireId(input.sourceAppId, "sourceAppId"); requireId(input.idempotencyKey, "idempotencyKey");
      if (!Number.isSafeInteger(input.delta) || input.delta === 0) throw new AuthorityValidationError("XP delta must be a non-zero safe integer");
      const existing = this.store.findIdempotent<XpEventV1>("xp", input.tenantId, input.idempotencyKey);
      if (existing) return { duplicate: true, value: existing };
      const event: XpEventV1 = { ...cloneJson(input), id: this.idFactory("xp"), createdAt: this.now() };
      this.store.appendXp(event);
      this.store.putIdempotent("xp", input.tenantId, input.idempotencyKey, event);
      return { duplicate: false, value: event };
    });
  }

  getXpBalance(tenantId: string, userId: string) {
    return this.store.listXp(tenantId, userId).reduce((total, item) => total + item.delta, 0);
  }

  publishEvent(input: Omit<PlatformEventV1, "id" | "createdAt">): IdempotentResultV1<PlatformEventV1> {
    return this.store.transaction(() => {
      requireId(input.tenantId, "tenantId"); requireId(input.sourceAppId, "sourceAppId");
      requireId(input.type, "type"); requireId(input.idempotencyKey, "idempotencyKey");
      const existing = this.store.findIdempotent<PlatformEventV1>("event", input.tenantId, input.idempotencyKey);
      if (existing) return { duplicate: true, value: existing };
      const now = this.now();
      const event: PlatformEventV1 = { ...cloneJson(input), id: this.idFactory("evt"), createdAt: now };
      const outbox: OutboxRecordV1 = { id: `outbox_${event.id}`, eventId: event.id, tenantId: event.tenantId, topic: event.type, payload: cloneJson(event) as unknown as Record<string, unknown>, state: "pending", attempts: 0, availableAt: now, createdAt: now };
      this.store.appendEvent(event);
      this.store.putOutbox(outbox);
      this.store.putIdempotent("event", input.tenantId, input.idempotencyKey, event);
      return { duplicate: false, value: event };
    });
  }

  listOutbox() { return this.store.listOutbox(); }

  claimOutbox(workerId: string, leaseSeconds = 30, limit = 50): OutboxRecordV1[] {
    requireId(workerId, "workerId");
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) throw new AuthorityValidationError("leaseSeconds is invalid");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AuthorityValidationError("limit is invalid");
    return this.store.transaction(() => {
      const now = this.now();
      const leaseUntil = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
      const claimable = this.store.listClaimableOutbox(now, limit);
      return claimable.map((record) => {
        const next: OutboxRecordV1 = { ...record, state: "leased", attempts: record.attempts + 1, leaseOwner: workerId, leaseUntil };
        this.store.putOutbox(next);
        return next;
      });
    });
  }

  completeOutbox(outboxId: string, workerId: string): OutboxRecordV1 {
    return this.store.transaction(() => {
      const record = this.requireLease(outboxId, workerId);
      const next: OutboxRecordV1 = { ...record, state: "delivered", deliveredAt: this.now() };
      delete next.leaseOwner; delete next.leaseUntil; delete next.lastError;
      this.store.putOutbox(next);
      return next;
    });
  }

  failOutbox(outboxId: string, workerId: string, error: string, retrySeconds = 15, maxAttempts = 10): OutboxRecordV1 {
    return this.store.transaction(() => {
      const record = this.requireLease(outboxId, workerId);
      const now = this.now();
      const dead = record.attempts >= maxAttempts;
      const next: OutboxRecordV1 = {
        ...record,
        state: dead ? "dead" : "pending",
        availableAt: dead ? record.availableAt : new Date(Date.parse(now) + retrySeconds * 1000).toISOString(),
        lastError: String(error || "delivery failed").slice(0, 1000),
      };
      delete next.leaseOwner; delete next.leaseUntil;
      this.store.putOutbox(next);
      return next;
    });
  }

  audit(input: Omit<AuditRecordV1, "id" | "createdAt">): AuditRecordV1 {
    return this.store.transaction(() => {
      requireId(input.actorId, "actorId"); requireId(input.action, "action");
      const record: AuditRecordV1 = { ...cloneJson(input), id: this.idFactory("audit"), createdAt: this.now() };
      this.store.appendAudit(record);
      return record;
    });
  }

  private requireLease(outboxId: string, workerId: string) {
    requireId(outboxId, "outboxId"); requireId(workerId, "workerId");
    const record = this.store.getOutbox(outboxId);
    if (!record) throw new AuthorityConflictError(`Outbox ${outboxId} does not exist`);
    if (record.state !== "leased" || record.leaseOwner !== workerId) throw new AuthorityConflictError(`Outbox ${outboxId} is not leased by ${workerId}`);
    return record;
  }

  private ensureUserInTransaction(userId: string) {
    requireId(userId, "userId");
    const existing = this.store.getUser(userId);
    if (existing) return existing;
    const user = { id: userId, createdAt: this.now() };
    this.store.putUser(user);
    return user;
  }
}

function requireId(value: string, name: string) {
  if (!value || value.trim() !== value || value.length > 200) throw new AuthorityValidationError(`${name} is invalid`);
}
function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
