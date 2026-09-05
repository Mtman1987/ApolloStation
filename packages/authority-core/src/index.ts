import { randomBytes } from "node:crypto";

export type ProviderKindV1 = "twitch" | "discord" | "xbox" | "github" | "other";

export interface UserRecordV1 { id: string; createdAt: string; }
export interface ProviderLinkV1 { provider: ProviderKindV1; providerUserId: string; userId: string; linkedAt: string; revokedAt?: string; }
export type WorkspaceThemeV1 = "system" | "light" | "dark" | "solar-flare" | "nebula-purple" | "oceanic-blue" | "aurora-green";
export interface AppearanceV1 {
  theme: WorkspaceThemeV1;
  accent?: string;
  accentSecondary?: string;
  backgroundUrl?: string;
  glowIntensity?: number;
  starDensity?: number;
  glassOpacity?: number;
  blurStrength?: number;
  nebulaIntensity?: number;
  parallaxDepth?: number;
  borderStrength?: number;
  chatTransparency?: number;
  density?: "compact" | "comfortable" | "spacious";
  sidebarCollapsed?: boolean;
  sidebarStyle?: "glass" | "solid" | "minimal";
  sidebarPosition?: "left" | "right";
  topbarStyle?: "glass" | "solid" | "minimal";
  tabStyle?: "pills" | "underline" | "cards";
  tabPosition?: "top" | "bottom";
  showAvatars?: boolean;
  smoothTransitions?: boolean;
  pushToTalk?: boolean;
  animation?: { speed: number; particles: boolean; shootingStars: boolean };
}
export interface CommlinkChatSpaceV1 {
  id: string;
  name: string;
  sourceIds: string[];
}
export interface CommlinkDeskV1 {
  id: string;
  name: string;
  chatSpaceIds: string[];
}
export interface CommlinkWorkspaceV1 {
  schemaVersion: 1;
  chatSpaces: CommlinkChatSpaceV1[];
  desks: CommlinkDeskV1[];
  activeChatSpaceId: string;
  activeDeskId: string;
  view: "focus" | "desk";
  filter: "all" | "chat" | "events" | "streamweaver" | "queued";
  compact: boolean;
}
export interface WorkspaceProfileV1 {
  tenantId: string;
  revision: number;
  appearance: AppearanceV1;
  dockSlots: [string | null, string | null, string | null];
  /** Canonical Overlay Bay scene documents. SPMT stores them; SpaceMountain is their only editor. */
  overlayScenes?: Array<Record<string, unknown>>;
  /** @deprecated Compatibility pointer for pre named-output workspaces. */
  activeOverlaySceneId?: string;
  activePublicOverlaySceneId?: string | null;
  activePersonalOverlaySceneId?: string | null;
  ttsSubscriptionIds: string[];
  appThemes: Record<string, string>;
  commlink?: CommlinkWorkspaceV1;
  updatedAt: string;
}
export interface XpEventV1 {
  id: string; tenantId: string; userId: string; delta: number; sourceAppId: string;
  reason: string; idempotencyKey: string; createdAt: string;
  eventType?: string; metadata?: Record<string, unknown>;
}
export interface XpWalletV1 {
  tenantId: string; userId: string; spendableXp: number; currentXp: number;
  lifetimeXp: number; totalXp: number; rank: number; level: number;
}
export interface XpLeaderboardEntryV1 extends XpWalletV1 { rank: number; }
export interface XpTransferResultV1 { transferred: boolean; duplicate: boolean; amount: number; from: XpWalletV1; to: XpWalletV1; }
export interface XpSpendResultV1 { spent: boolean; duplicate: boolean; amount: number; wallet: XpWalletV1; event?: XpEventV1; }
export interface XpGambleSettlementV1 {
  settled: boolean; duplicate: boolean; wager: number; payout: number; refill: number;
  overflow: number; compressed: number; matchedGrowth: number; discardedOverflow: number;
  before: XpWalletV1; wallet: XpWalletV1;
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
  kind: "user" | "provider-link" | "workspace" | "xp" | "event" | "audit" | "service-identity" | "outbox" | "tenant" | "app" | "install" | "entitlement" | "overlay-widget" | "overlay-output-grant" | "runtime-projection" | "usage";
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
  listProviderLinks(userId: string): ProviderLinkV1[];
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
  listProviderLinks(userId: string) { return [...this.providerLinks.values()].filter((item) => item.userId === userId).sort((a, b) => `${a.provider}:${a.providerUserId}`.localeCompare(`${b.provider}:${b.providerUserId}`)).map(cloneJson); }
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
  private readonly store: AuthorityStore;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(options: AuthorityServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}_${randomBytes(12).toString("hex")}`);
  }

  ensureUser(userId: string): UserRecordV1 {
    return this.store.transaction(() => this.ensureUserInTransaction(userId));
  }

  linkProvider(userId: string, provider: ProviderKindV1, providerUserId: string): ProviderLinkV1 {
    return this.store.transaction(() => {
      this.ensureUserInTransaction(userId);
      requireId(providerUserId, "providerUserId");
      const existing = this.store.getProviderLink(provider, providerUserId);
      if (existing && !existing.revokedAt && existing.userId !== userId) throw new AuthorityConflictError(`Provider identity ${provider}:${providerUserId} is already linked to another SPMT user`);
      if (existing && !existing.revokedAt) return existing;
      const link = { provider, providerUserId, userId, linkedAt: this.now() };
      this.store.putProviderLink(link);
      return link;
    });
  }

  listProviderLinks(userId: string): ProviderLinkV1[] {
    requireId(userId, "userId");
    return this.store.listProviderLinks(userId).filter((item) => !item.revokedAt);
  }

  unlinkProvider(userId: string, provider: ProviderKindV1, providerUserId: string): ProviderLinkV1 {
    return this.store.transaction(() => {
      requireId(userId, "userId");
      requireId(providerUserId, "providerUserId");
      const existing = this.store.getProviderLink(provider, providerUserId);
      if (!existing || existing.userId !== userId) throw new AuthorityConflictError(`Provider identity ${provider}:${providerUserId} is not linked to this SPMT user`);
      if (existing.revokedAt) return existing;
      const revoked = { ...existing, revokedAt: this.now() };
      this.store.putProviderLink(revoked);
      return revoked;
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
      if (patch.dockSlots) patch.dockSlots.forEach((slot) => { if (slot !== null) requireWorkspaceValue(slot, "dock slot", 2048); });
      if (patch.appearance) validateAppearance(patch.appearance);
      if (patch.commlink) validateCommlinkWorkspace(patch.commlink);
      const next: WorkspaceProfileV1 = { ...current, ...cloneJson(patch), tenantId, revision: current.revision + 1, updatedAt: this.now() };
      validateOverlayWorkspace(next);
      this.store.putWorkspace(next);
      return next;
    });
  }

  awardXp(input: Omit<XpEventV1, "id" | "createdAt">): IdempotentResultV1<XpEventV1> {
    return this.store.transaction(() => {
      requireId(input.tenantId, "tenantId"); requireId(input.userId, "userId");
      requireId(input.sourceAppId, "sourceAppId"); requireId(input.idempotencyKey, "idempotencyKey");
      if (!Number.isSafeInteger(input.delta) || input.delta === 0) throw new AuthorityValidationError("XP delta must be a non-zero safe integer");
      if (input.eventType !== undefined) requireId(input.eventType, "eventType");
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

  getXpLedger(tenantId: string, userId: string, limit = 100): XpEventV1[] {
    requireId(tenantId, "tenantId"); requireId(userId, "userId");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AuthorityValidationError("XP ledger limit must be from 1 through 500");
    return this.store.listXp(tenantId, userId).slice(-limit).reverse();
  }

  getXpWallet(tenantId: string, userId: string): XpWalletV1 {
    requireId(tenantId, "tenantId"); requireId(userId, "userId");
    const events = this.store.listXp(tenantId, userId);
    const spendableXp = Math.max(0, events.reduce((total, item) => total + item.delta, 0));
    const lifetimeXp = Math.max(0, events.reduce((total, item) => total + (item.delta > 0 && item.metadata?.lifetimeEligible !== false ? item.delta : 0), 0));
    const rank = 1 + this.xpLifetimeTotals(tenantId).filter((item) => item.lifetimeXp > lifetimeXp).length;
    return { tenantId, userId, spendableXp, currentXp: spendableXp, lifetimeXp, totalXp: lifetimeXp, rank, level: Math.floor(Math.sqrt(lifetimeXp / 100)) + 1 };
  }

  getXpLeaderboard(tenantId: string, limit = 10): XpLeaderboardEntryV1[] {
    requireId(tenantId, "tenantId");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AuthorityValidationError("XP leaderboard limit must be from 1 through 100");
    return this.xpLifetimeTotals(tenantId).slice(0, limit).map((item, index) => ({ tenantId, userId: item.userId, spendableXp: item.spendableXp, currentXp: item.spendableXp, lifetimeXp: item.lifetimeXp, totalXp: item.lifetimeXp, rank: index + 1, level: Math.floor(Math.sqrt(item.lifetimeXp / 100)) + 1 }));
  }

  spendXp(input: { tenantId: string; userId: string; amount: number; sourceAppId: string; eventType?: string; reason?: string; idempotencyKey: string; metadata?: Record<string, unknown> }): XpSpendResultV1 {
    return this.store.transaction(() => {
      requirePositiveBoundedAmount(input.amount, "amount", 1_000_000);
      const existing = this.store.findIdempotent<XpEventV1>("xp", input.tenantId, input.idempotencyKey);
      if (existing) return { spent: false, duplicate: true, amount: input.amount, wallet: this.getXpWallet(input.tenantId, input.userId), event: existing };
      const wallet = this.getXpWallet(input.tenantId, input.userId);
      if (wallet.spendableXp < input.amount) throw new AuthorityConflictError("Insufficient spendable XP");
      const result = this.awardXp({ tenantId: input.tenantId, userId: input.userId, delta: -input.amount, sourceAppId: input.sourceAppId, reason: input.reason ?? input.eventType ?? "wallet-spend", idempotencyKey: input.idempotencyKey, ...(input.eventType ? { eventType: input.eventType } : {}), metadata: { ...(input.metadata ?? {}), lifetimeEligible: false, walletAction: "spend" } });
      return { spent: true, duplicate: result.duplicate, amount: input.amount, wallet: this.getXpWallet(input.tenantId, input.userId), event: result.value };
    });
  }

  transferXp(input: { tenantId: string; fromUserId: string; toUserId: string; amount: number; sourceAppId: string; eventType?: string; reason?: string; idempotencyKey: string; metadata?: Record<string, unknown> }): XpTransferResultV1 {
    return this.store.transaction(() => {
      requireId(input.tenantId, "tenantId"); requireId(input.fromUserId, "fromUserId"); requireId(input.toUserId, "toUserId"); requireId(input.sourceAppId, "sourceAppId"); requireId(input.idempotencyKey, "idempotencyKey");
      if (input.fromUserId === input.toUserId) throw new AuthorityValidationError("XP transfer requires two different users");
      requirePositiveBoundedAmount(input.amount, "amount", 1_000_000);
      const prior = this.store.findIdempotent<{ amount: number; fromUserId: string; toUserId: string }>("xp-transfer", input.tenantId, input.idempotencyKey);
      if (prior) return { transferred: false, duplicate: true, amount: prior.amount, from: this.getXpWallet(input.tenantId, prior.fromUserId), to: this.getXpWallet(input.tenantId, prior.toUserId) };
      const debitKey = `${input.idempotencyKey}:debit`; const creditKey = `${input.idempotencyKey}:credit`;
      if (this.store.findIdempotent("xp", input.tenantId, debitKey) || this.store.findIdempotent("xp", input.tenantId, creditKey)) throw new AuthorityConflictError("XP transfer idempotency key collides with an existing partial operation");
      if (this.getXpWallet(input.tenantId, input.fromUserId).spendableXp < input.amount) throw new AuthorityConflictError("Insufficient spendable XP");
      const metadata = { ...(input.metadata ?? {}), lifetimeEligible: false, walletAction: "transfer" };
      const eventType = input.eventType ?? "wallet-transfer"; const reason = input.reason ?? eventType;
      this.awardXp({ tenantId: input.tenantId, userId: input.fromUserId, delta: -input.amount, sourceAppId: input.sourceAppId, reason, idempotencyKey: debitKey, eventType, metadata: { ...metadata, direction: "debit", otherUserId: input.toUserId } });
      this.awardXp({ tenantId: input.tenantId, userId: input.toUserId, delta: input.amount, sourceAppId: input.sourceAppId, reason, idempotencyKey: creditKey, eventType, metadata: { ...metadata, direction: "credit", otherUserId: input.fromUserId } });
      this.store.putIdempotent("xp-transfer", input.tenantId, input.idempotencyKey, { amount: input.amount, fromUserId: input.fromUserId, toUserId: input.toUserId });
      return { transferred: true, duplicate: false, amount: input.amount, from: this.getXpWallet(input.tenantId, input.fromUserId), to: this.getXpWallet(input.tenantId, input.toUserId) };
    });
  }

  settleXpGamble(input: { tenantId: string; userId: string; wager: number; payout: number; sourceAppId: string; eventType?: string; idempotencyKey: string; metadata?: Record<string, unknown> }): XpGambleSettlementV1 {
    return this.store.transaction(() => {
      requireId(input.tenantId, "tenantId"); requireId(input.userId, "userId"); requireId(input.sourceAppId, "sourceAppId"); requireId(input.idempotencyKey, "idempotencyKey");
      requireNonNegativeBoundedAmount(input.wager, "wager", 1_000_000); requireNonNegativeBoundedAmount(input.payout, "payout", 100_000_000);
      const prior = this.store.findIdempotent<{ wager: number; payout: number; refill: number; overflow: number; compressed: number; matchedGrowth: number; discardedOverflow: number; before: XpWalletV1 }>("xp-gamble", input.tenantId, input.idempotencyKey);
      if (prior) return { settled: false, duplicate: true, ...prior, wallet: this.getXpWallet(input.tenantId, input.userId) };
      const before = this.getXpWallet(input.tenantId, input.userId);
      if (before.spendableXp < input.wager) throw new AuthorityConflictError("Insufficient spendable XP");
      const afterWager = before.spendableXp - input.wager;
      const missingToLifetime = Math.max(0, before.lifetimeXp - afterWager);
      const refill = Math.min(input.payout, missingToLifetime);
      const overflow = Math.max(0, input.payout - refill);
      const compressed = Math.floor(overflow / 10);
      const matchedGrowth = Math.floor(compressed / 2);
      const discardedOverflow = overflow - (matchedGrowth * 2);
      const eventType = input.eventType ?? "gamble-settle";
      const metadata = input.metadata ?? {};
      const debitKey = `${input.idempotencyKey}:wager`; const refillKey = `${input.idempotencyKey}:refill`; const growthKey = `${input.idempotencyKey}:growth`;
      for (const key of [debitKey, refillKey, growthKey]) if (this.store.findIdempotent("xp", input.tenantId, key)) throw new AuthorityConflictError("XP gamble idempotency key collides with an existing partial operation");
      if (input.wager > 0) this.awardXp({ tenantId: input.tenantId, userId: input.userId, delta: -input.wager, sourceAppId: input.sourceAppId, reason: eventType, idempotencyKey: debitKey, eventType, metadata: { ...metadata, lifetimeEligible: false, walletAction: "gamble-wager", wager: input.wager, payout: input.payout } });
      if (refill > 0) this.awardXp({ tenantId: input.tenantId, userId: input.userId, delta: refill, sourceAppId: input.sourceAppId, reason: eventType, idempotencyKey: refillKey, eventType, metadata: { ...metadata, lifetimeEligible: false, walletAction: "gamble-refill", wager: input.wager, payout: input.payout, refill } });
      if (matchedGrowth > 0) this.awardXp({ tenantId: input.tenantId, userId: input.userId, delta: matchedGrowth, sourceAppId: input.sourceAppId, reason: eventType, idempotencyKey: growthKey, eventType, metadata: { ...metadata, lifetimeEligible: true, walletAction: "gamble-growth", wager: input.wager, payout: input.payout, overflow, compressed, matchedGrowth } });
      const receipt = { wager: input.wager, payout: input.payout, refill, overflow, compressed, matchedGrowth, discardedOverflow, before };
      this.store.putIdempotent("xp-gamble", input.tenantId, input.idempotencyKey, receipt);
      return { settled: true, duplicate: false, ...receipt, wallet: this.getXpWallet(input.tenantId, input.userId) };
    });
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

  listEvents(
    tenantId: string,
    options: { type?: string; sourceAppId?: string; limit?: number } = {},
  ): PlatformEventV1[] {
    requireId(tenantId, "tenantId");
    if (options.type !== undefined) requireId(options.type, "type");
    if (options.sourceAppId !== undefined) requireId(options.sourceAppId, "sourceAppId");
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new AuthorityValidationError("event limit must be an integer from 1 through 200");
    }
    return this.store.listEvents(tenantId)
      .filter((event) => options.type === undefined || event.type === options.type)
      .filter((event) => options.sourceAppId === undefined || event.sourceAppId === options.sourceAppId)
      .slice(-limit)
      .reverse();
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

  private xpLifetimeTotals(tenantId: string) {
    const totals = new Map<string, { userId: string; spendableXp: number; lifetimeXp: number }>();
    for (const entry of this.store.listJournal()) {
      if (entry.kind !== "xp" || entry.tenantId !== tenantId) continue;
      const event = entry.payload as unknown as XpEventV1;
      if (!event.userId || !Number.isSafeInteger(event.delta)) continue;
      const current = totals.get(event.userId) ?? { userId: event.userId, spendableXp: 0, lifetimeXp: 0 };
      current.spendableXp += event.delta;
      if (event.delta > 0 && event.metadata?.lifetimeEligible !== false) current.lifetimeXp += event.delta;
      totals.set(event.userId, current);
    }
    return [...totals.values()].map((item) => ({ ...item, spendableXp: Math.max(0, item.spendableXp), lifetimeXp: Math.max(0, item.lifetimeXp) })).sort((a, b) => b.lifetimeXp - a.lifetimeXp || a.userId.localeCompare(b.userId));
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

function validateCommlinkWorkspace(workspace: CommlinkWorkspaceV1) {
  if (workspace.schemaVersion !== 1) throw new AuthorityValidationError("Commlink workspace schemaVersion is invalid");
  if (!Array.isArray(workspace.chatSpaces) || workspace.chatSpaces.length < 1 || workspace.chatSpaces.length > 24) throw new AuthorityValidationError("Commlink must contain between 1 and 24 ChatSpaces");
  if (!Array.isArray(workspace.desks) || workspace.desks.length < 1 || workspace.desks.length > 12) throw new AuthorityValidationError("Commlink must contain between 1 and 12 Desks");
  const spaceIds = new Set<string>();
  for (const space of workspace.chatSpaces) {
    requireWorkspaceValue(space.id, "ChatSpace id", 80); requireWorkspaceValue(space.name, "ChatSpace name", 60);
    if (spaceIds.has(space.id)) throw new AuthorityValidationError("Commlink ChatSpace ids must be unique");
    spaceIds.add(space.id);
    if (!Array.isArray(space.sourceIds) || space.sourceIds.length > 32) throw new AuthorityValidationError("Commlink ChatSpace sources are invalid");
    space.sourceIds.forEach((id) => requireWorkspaceValue(id, "Commlink source id", 160));
  }
  const deskIds = new Set<string>();
  for (const desk of workspace.desks) {
    requireWorkspaceValue(desk.id, "Desk id", 80); requireWorkspaceValue(desk.name, "Desk name", 60);
    if (deskIds.has(desk.id)) throw new AuthorityValidationError("Commlink Desk ids must be unique");
    deskIds.add(desk.id);
    if (!Array.isArray(desk.chatSpaceIds) || desk.chatSpaceIds.length < 1 || desk.chatSpaceIds.length > 6 || desk.chatSpaceIds.some((id) => !spaceIds.has(id))) throw new AuthorityValidationError("Commlink Desk panels are invalid");
  }
  if (!spaceIds.has(workspace.activeChatSpaceId) || !deskIds.has(workspace.activeDeskId)) throw new AuthorityValidationError("Commlink active workspace selection is invalid");
  if (!["focus", "desk"].includes(workspace.view) || !["all", "chat", "events", "streamweaver", "queued"].includes(workspace.filter) || typeof workspace.compact !== "boolean") throw new AuthorityValidationError("Commlink workspace controls are invalid");
}

function validateOverlayWorkspace(workspace: WorkspaceProfileV1) {
  const scenes = workspace.overlayScenes ?? [];
  if (!Array.isArray(scenes) || scenes.length > 32) throw new AuthorityValidationError("Overlay Bay may contain at most 32 scenes");
  if (JSON.stringify(scenes).length > 2_000_000) throw new AuthorityValidationError("Overlay Bay scene data is too large");
  const ids = new Set<string>();
  for (const value of scenes) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthorityValidationError("Overlay Bay scenes must be objects");
    const scene = value as Record<string, unknown>;
    if (scene.schemaVersion !== 1 || typeof scene.id !== "string") throw new AuthorityValidationError("Overlay Bay scene identity is invalid");
    requireWorkspaceValue(scene.id, "Overlay Bay scene id", 200);
    if (ids.has(scene.id)) throw new AuthorityValidationError("Overlay Bay scene ids must be unique");
    ids.add(scene.id);
  }
  for (const [name, value] of [
    ["legacy", workspace.activeOverlaySceneId],
    ["Public", workspace.activePublicOverlaySceneId],
    ["Personal", workspace.activePersonalOverlaySceneId],
  ] as const) {
    if (value === undefined || value === null) continue;
    requireWorkspaceValue(value, `${name} overlay scene id`, 200);
    if (!ids.has(value)) throw new AuthorityValidationError(`${name} overlay scene does not exist in this workspace`);
  }
}

function requireId(value: string, name: string) {
  if (!value || value.trim() !== value || value.length > 200) throw new AuthorityValidationError(`${name} is invalid`);
}
function requirePositiveBoundedAmount(value: number, name: string, max: number) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new AuthorityValidationError(`${name} must be a positive whole number no greater than ${max}`);
}
function requireNonNegativeBoundedAmount(value: number, name: string, max: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new AuthorityValidationError(`${name} must be a non-negative whole number no greater than ${max}`);
}
function requireWorkspaceValue(value: string, name: string, max: number) {
  if (!value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new AuthorityValidationError(`${name} is invalid`);
}
function validateAppearance(value: AppearanceV1) {
  if (!["system", "light", "dark", "solar-flare", "nebula-purple", "oceanic-blue", "aurora-green"].includes(value.theme)) throw new AuthorityValidationError("Workspace theme is invalid");
  if (value.accent !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value.accent)) throw new AuthorityValidationError("Workspace accent is invalid");
  if (value.accentSecondary !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value.accentSecondary)) throw new AuthorityValidationError("Workspace secondary accent is invalid");
  if (value.backgroundUrl !== undefined) {
    requireWorkspaceValue(value.backgroundUrl, "background URL", 2048);
    let url: URL;
    try { url = new URL(value.backgroundUrl); } catch { throw new AuthorityValidationError("Workspace background URL is invalid"); }
    if (url.protocol !== "https:" || url.username || url.password) throw new AuthorityValidationError("Workspace background URL must be credential-free HTTPS");
  }
  for (const [name, setting] of Object.entries({ glowIntensity: value.glowIntensity, starDensity: value.starDensity, glassOpacity: value.glassOpacity, blurStrength: value.blurStrength, nebulaIntensity: value.nebulaIntensity, parallaxDepth: value.parallaxDepth, borderStrength: value.borderStrength, chatTransparency: value.chatTransparency })) {
    if (setting !== undefined && (!Number.isFinite(setting) || setting < 0 || setting > 100)) throw new AuthorityValidationError(`Workspace ${name} must be from 0 through 100`);
  }
  if (value.density !== undefined && !["compact", "comfortable", "spacious"].includes(value.density)) throw new AuthorityValidationError("Workspace density is invalid");
  if (value.sidebarStyle !== undefined && !["glass", "solid", "minimal"].includes(value.sidebarStyle)) throw new AuthorityValidationError("Workspace sidebar style is invalid");
  if (value.sidebarPosition !== undefined && !["left", "right"].includes(value.sidebarPosition)) throw new AuthorityValidationError("Workspace sidebar position is invalid");
  if (value.topbarStyle !== undefined && !["glass", "solid", "minimal"].includes(value.topbarStyle)) throw new AuthorityValidationError("Workspace topbar style is invalid");
  if (value.tabStyle !== undefined && !["pills", "underline", "cards"].includes(value.tabStyle)) throw new AuthorityValidationError("Workspace tab style is invalid");
  if (value.tabPosition !== undefined && !["top", "bottom"].includes(value.tabPosition)) throw new AuthorityValidationError("Workspace tab position is invalid");
  for (const [name, setting] of Object.entries({ sidebarCollapsed: value.sidebarCollapsed, showAvatars: value.showAvatars, smoothTransitions: value.smoothTransitions, pushToTalk: value.pushToTalk })) {
    if (setting !== undefined && typeof setting !== "boolean") throw new AuthorityValidationError(`Workspace ${name} must be boolean`);
  }
  if (value.animation !== undefined) {
    if (!Number.isFinite(value.animation.speed) || value.animation.speed < 0 || value.animation.speed > 100) throw new AuthorityValidationError("Workspace animation speed must be from 0 through 100");
    if (typeof value.animation.particles !== "boolean" || typeof value.animation.shootingStars !== "boolean") throw new AuthorityValidationError("Workspace animation toggles must be boolean");
  }
}
function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
