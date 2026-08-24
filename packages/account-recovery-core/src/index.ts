import { createHash, randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { AuthorityStore, ProviderKindV1, ProviderLinkV1 } from "@spmt/authority-core";
import { AuthorityService } from "@spmt/authority-core";
import { ControlNotFoundError, ControlService } from "@spmt/control-core";
import type { PlatformDataStore, UserProfileV1 } from "@spmt/platform-data-core";

export type CredentialStateV1 = "setup-required" | "password-set";
export type SignInStateV1 = "not-found" | CredentialStateV1;
export type SetupPurposeV1 = "first-time-setup" | "dm-password-reset";
export type GrandfatherProviderV1 = "discord" | "twitch";

export interface AccountProvisionInputV1 {
  tenantId: string;
  sourceAppId: string;
  username?: string;
  displayName?: string;
  discord?: { id: string; username?: string };
  twitch?: { id: string; username?: string };
}

export interface AccountProvisionResultV1 {
  userId: string;
  tenantId: string;
  profile: UserProfileV1;
  credentialState: CredentialStateV1;
  createdUser: boolean;
  createdTenant: boolean;
}

export interface ProviderGrandfatherInputV1 {
  sourceAppId: string;
  provider: GrandfatherProviderV1;
  providerUserId: string;
  providerUsername?: string;
  username?: string;
  displayName?: string;
}

export interface ProviderIdentityResultV1 {
  provider: GrandfatherProviderV1;
  providerUserId: string;
  userId: string;
  profile: UserProfileV1;
  credentialState: CredentialStateV1;
  createdUser: boolean;
  linkedProvider: boolean;
  recoveredRevokedLink: boolean;
}

export interface AccountSetupTicketV1 {
  tokenHash: string;
  purpose: SetupPurposeV1;
  userId: string;
  tenantId: string;
  sourceAppId: string;
  discordUserId?: string;
  discordVerifiedAt?: string;
  twitchUserId?: string;
  twitchUsername?: string;
  twitchVerifiedAt?: string;
  oauthStateHash?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

export interface SignInInspectionV1 {
  state: SignInStateV1;
  userId?: string;
  tenantId?: string;
}

export class AccountSetupError extends Error {
  constructor(message: string) { super(message); this.name = "AccountSetupError"; }
}

export class SqliteAccountSetupStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new AccountSetupError("Account setup database path is required");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_setup_tickets(
        token_hash TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        body TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS account_setup_ticket_user ON account_setup_tickets(user_id, purpose, expires_at);
    `);
  }
  close() { this.db.close(); }
  getTicket(tokenHash: string) {
    const row = this.db.prepare("SELECT body FROM account_setup_tickets WHERE token_hash=?").get(tokenHash) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as AccountSetupTicketV1 : undefined;
  }
  putTicket(value: AccountSetupTicketV1) {
    this.db.prepare("INSERT INTO account_setup_tickets(token_hash,purpose,user_id,tenant_id,expires_at,used_at,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at,used_at=excluded.used_at,body=excluded.body")
      .run(value.tokenHash, value.purpose, value.userId, value.tenantId, value.expiresAt, value.usedAt ?? null, JSON.stringify(value));
  }
  findProviderUserId(userId: string, provider: ProviderKindV1) {
    const rows = this.db.prepare("SELECT body FROM provider_links WHERE user_id=? AND provider=? ORDER BY provider_user_id").all(userId, provider) as Array<{ body: string }>;
    return rows.map((row) => JSON.parse(row.body) as ProviderLinkV1).find((link) => !link.revokedAt)?.providerUserId;
  }
}

export interface AccountRecoveryServiceOptions {
  authority: AuthorityService;
  authorityStore: AuthorityStore;
  control: ControlService;
  platformStore: PlatformDataStore;
  setupStore: SqliteAccountSetupStore;
  now?: () => string;
  tokenFactory?: () => string;
}

export class AccountRecoveryService {
  private readonly authority: AuthorityService;
  private readonly authorityStore: AuthorityStore;
  private readonly control: ControlService;
  private readonly platformStore: PlatformDataStore;
  private readonly setupStore: SqliteAccountSetupStore;
  private readonly now: () => string;
  private readonly tokenFactory: () => string;

  constructor(options: AccountRecoveryServiceOptions) {
    this.authority = options.authority;
    this.authorityStore = options.authorityStore;
    this.control = options.control;
    this.platformStore = options.platformStore;
    this.setupStore = options.setupStore;
    this.now = options.now ?? (() => new Date().toISOString());
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  /**
   * Production-style provider import for trusted first-party services.
   * This is deliberately global identity creation: it never creates, owns, or joins a tenant.
   * Provider display names are presentation hints only; the immutable providerUserId is the identity key.
   */
  grandfatherProviderIdentity(input: ProviderGrandfatherInputV1): ProviderIdentityResultV1 {
    requireId(input.sourceAppId, "sourceAppId");
    const provider = requireGrandfatherProvider(input.provider);
    const providerUserId = requireProviderUserId(input.providerUserId);
    const rawLink = this.authorityStore.getProviderLink(provider, providerUserId);
    const recoveredRevokedLink = Boolean(rawLink?.revokedAt);
    const userId = rawLink?.userId ?? `usr_provider_${sha256(`${provider}:${providerUserId}`).slice(0, 24)}`;
    const createdUser = !this.authorityStore.getUser(userId);
    this.authority.ensureUser(userId);

    let linkedProvider = false;
    if (!rawLink || rawLink.revokedAt) {
      this.authority.linkProvider(userId, provider, providerUserId);
      linkedProvider = true;
    } else if (rawLink.userId !== userId) {
      throw new AccountSetupError("Provider identity is already linked to a different SPMT account");
    }

    let profile = this.platformStore.getUserProfile(userId);
    const requestedUsername = input.username ?? input.providerUsername;
    const requestedDisplay = input.displayName ?? input.providerUsername ?? requestedUsername ?? "SpaceMountain member";
    if (!profile) {
      const now = this.now();
      profile = {
        userId,
        username: this.availableUsername(requestedUsername, userId),
        displayName: cleanDisplayName(requestedDisplay),
        tenantIds: [],
        createdAt: now,
        updatedAt: now,
      };
      this.platformStore.putUserProfile(profile);
    } else if (!this.platformStore.getUserCredential(userId) && input.displayName && cleanDisplayName(input.displayName) !== profile.displayName) {
      profile = { ...profile, displayName: cleanDisplayName(input.displayName), updatedAt: this.now() };
      this.platformStore.putUserProfile(profile);
    }

    return {
      provider,
      providerUserId,
      userId,
      profile,
      credentialState: this.platformStore.getUserCredential(userId) ? "password-set" : "setup-required",
      createdUser,
      linkedProvider,
      recoveredRevokedLink,
    };
  }

  resolveProviderIdentity(providerInput: GrandfatherProviderV1, providerUserIdInput: string): ProviderIdentityResultV1 | undefined {
    const provider = requireGrandfatherProvider(providerInput);
    const providerUserId = requireProviderUserId(providerUserIdInput);
    const link = this.authorityStore.getProviderLink(provider, providerUserId);
    if (!link || link.revokedAt) return undefined;
    const profile = this.platformStore.getUserProfile(link.userId);
    if (!profile) return undefined;
    return {
      provider,
      providerUserId,
      userId: link.userId,
      profile,
      credentialState: this.platformStore.getUserCredential(link.userId) ? "password-set" : "setup-required",
      createdUser: false,
      linkedProvider: false,
      recoveredRevokedLink: false,
    };
  }

  provisionAccount(input: AccountProvisionInputV1): AccountProvisionResultV1 {
    const tenantId = requireId(input.tenantId, "tenantId");
    requireId(input.sourceAppId, "sourceAppId");
    const rawDiscordLink = input.discord?.id ? this.authorityStore.getProviderLink("discord", requireId(input.discord.id, "discord.id")) : undefined;
    const rawTwitchLink = input.twitch?.id ? this.authorityStore.getProviderLink("twitch", requireId(input.twitch.id, "twitch.id")) : undefined;
    const discordLink = rawDiscordLink?.revokedAt ? undefined : rawDiscordLink;
    const twitchLink = rawTwitchLink?.revokedAt ? undefined : rawTwitchLink;
    const providerUsers = new Set([discordLink?.userId, twitchLink?.userId].filter((value): value is string => Boolean(value)));
    if (providerUsers.size > 1) throw new AccountSetupError("Discord and Twitch are already linked to different SPMT accounts");

    let tenantOwner: string | undefined;
    try { tenantOwner = this.control.getTenant(tenantId).ownerUserId; }
    catch (error) { if (!(error instanceof ControlNotFoundError)) throw error; }
    const linkedOwner = providerUsers.values().next().value as string | undefined;
    if (tenantOwner && linkedOwner && tenantOwner !== linkedOwner) {
      throw new AccountSetupError("This tenant and provider identity belong to different SPMT accounts and require migration review");
    }

    const userId = tenantOwner ?? linkedOwner ?? `usr_tenant_${sha256(tenantId).slice(0, 24)}`;
    const createdUser = !this.authorityStore.getUser(userId);
    this.authority.ensureUser(userId);
    let createdTenant = false;
    if (!tenantOwner) {
      this.control.registerTenant({ tenantId, ownerUserId: userId, displayName: cleanDisplayName(input.displayName ?? input.username ?? "SpaceMountain member") });
      createdTenant = true;
    }
    this.authority.getOrCreateWorkspace(tenantId);

    if (input.discord?.id) this.authority.linkProvider(userId, "discord", input.discord.id);
    if (input.twitch?.id) this.authority.linkProvider(userId, "twitch", input.twitch.id);

    let profile = this.platformStore.getUserProfile(userId);
    if (!profile) {
      const now = this.now();
      profile = {
        userId,
        username: this.availableUsername(input.username ?? input.discord?.username ?? input.twitch?.username, userId),
        displayName: cleanDisplayName(input.displayName ?? input.username ?? input.discord?.username ?? input.twitch?.username ?? "SpaceMountain member"),
        tenantIds: [tenantId],
        createdAt: now,
        updatedAt: now,
      };
      this.platformStore.putUserProfile(profile);
    } else if (!profile.tenantIds.includes(tenantId)) {
      profile = { ...profile, tenantIds: [...profile.tenantIds, tenantId].sort(), updatedAt: this.now() };
      this.platformStore.putUserProfile(profile);
    }

    return {
      userId,
      tenantId,
      profile,
      credentialState: this.platformStore.getUserCredential(userId) ? "password-set" : "setup-required",
      createdUser,
      createdTenant,
    };
  }

  inspectSignIn(identifier: string): SignInInspectionV1 {
    const username = normalizeUsername(identifier);
    const profile = this.platformStore.getUserProfileByUsername(username);
    if (!profile) return { state: "not-found" };
    const tenantId = profile.tenantIds[0];
    return {
      state: this.platformStore.getUserCredential(profile.userId) ? "password-set" : "setup-required",
      userId: profile.userId,
      ...(tenantId ? { tenantId } : {}),
    };
  }

  createDiscordInvite(input: AccountProvisionInputV1 & { discord: { id: string; username?: string } }) {
    const account = this.provisionAccount(input);
    const token = this.tokenFactory();
    const now = this.now();
    const ticket: AccountSetupTicketV1 = {
      tokenHash: sha256(token),
      purpose: "first-time-setup",
      userId: account.userId,
      tenantId: account.tenantId,
      sourceAppId: input.sourceAppId,
      discordUserId: input.discord.id,
      discordVerifiedAt: now,
      createdAt: now,
      expiresAt: addMinutes(now, 30),
    };
    this.setupStore.putTicket(ticket);
    return { account, ticket: token };
  }

  beginTwitchVerification(ticketToken: string) {
    const ticket = this.requireTicket(ticketToken, "first-time-setup");
    if (!ticket.discordVerifiedAt) throw new AccountSetupError("Discord verification is required before Twitch verification");
    const state = this.tokenFactory();
    this.setupStore.putTicket({ ...ticket, oauthStateHash: sha256(state) });
    return { state, userId: ticket.userId, tenantId: ticket.tenantId };
  }

  completeTwitchVerification(ticketToken: string, state: string, twitch: { id: string; username?: string }) {
    const ticket = this.requireTicket(ticketToken, "first-time-setup");
    if (!ticket.oauthStateHash || ticket.oauthStateHash !== sha256(state)) throw new AccountSetupError("Twitch verification state is invalid or expired");
    this.authority.linkProvider(ticket.userId, "twitch", requireId(twitch.id, "twitch.id"));
    const { oauthStateHash: _oauthStateHash, ...rest } = ticket;
    const next: AccountSetupTicketV1 = {
      ...rest,
      twitchUserId: twitch.id,
      ...(twitch.username ? { twitchUsername: twitch.username } : {}),
      twitchVerifiedAt: this.now(),
    };
    this.setupStore.putTicket(next);
    return { userId: next.userId, tenantId: next.tenantId, readyForPassword: true };
  }

  completeFirstTimePassword(ticketToken: string, password: string) {
    const ticket = this.requireTicket(ticketToken, "first-time-setup");
    if (!ticket.discordVerifiedAt || !ticket.twitchVerifiedAt) throw new AccountSetupError("Discord and Twitch verification are both required");
    this.setPassword(ticket.userId, password);
    const usedAt = this.now();
    this.setupStore.putTicket({ ...ticket, usedAt });
    return { userId: ticket.userId, tenantId: ticket.tenantId, credentialState: "password-set" as const };
  }

  createDmPasswordReset(identifier: string) {
    const username = normalizeUsername(identifier);
    const profile = this.platformStore.getUserProfileByUsername(username);
    if (!profile) return undefined;
    const discordUserId = this.setupStore.findProviderUserId(profile.userId, "discord");
    if (!discordUserId) return undefined;
    const token = this.tokenFactory();
    const now = this.now();
    const ticket: AccountSetupTicketV1 = {
      tokenHash: sha256(token),
      purpose: "dm-password-reset",
      userId: profile.userId,
      tenantId: profile.tenantIds[0] ?? `tenant_${profile.userId}`,
      sourceAppId: "spmt",
      discordUserId,
      discordVerifiedAt: now,
      createdAt: now,
      expiresAt: addMinutes(now, 15),
    };
    this.setupStore.putTicket(ticket);
    return { ticket: token, discordUserId, userId: profile.userId };
  }

  openDmPasswordReset(ticketToken: string) {
    const ticket = this.requireTicket(ticketToken, "dm-password-reset");
    return { userId: ticket.userId, tenantId: ticket.tenantId };
  }

  completeDmPasswordReset(ticketToken: string, password: string) {
    const ticket = this.requireTicket(ticketToken, "dm-password-reset");
    if (!ticket.discordVerifiedAt) throw new AccountSetupError("Discord verification is required");
    this.setPassword(ticket.userId, password);
    this.setupStore.putTicket({ ...ticket, usedAt: this.now() });
    return { userId: ticket.userId, tenantId: ticket.tenantId, credentialState: "password-set" as const };
  }

  private setPassword(userId: string, password: string) {
    requirePassword(password);
    const salt = randomBytes(16).toString("base64url");
    const hash = scryptSync(password, salt, 32).toString("hex");
    this.platformStore.putUserCredential(userId, salt, hash);
  }

  private requireTicket(token: string, purpose: SetupPurposeV1) {
    const ticket = this.setupStore.getTicket(sha256(token));
    const now = this.now();
    if (!ticket || ticket.purpose !== purpose || ticket.usedAt || Date.parse(ticket.expiresAt) <= Date.parse(now)) {
      throw new AccountSetupError("This setup link is invalid, expired, or already used");
    }
    return ticket;
  }

  private availableUsername(candidate: string | undefined, userId: string) {
    const base = safeUsername(candidate) ?? `member-${sha256(userId).slice(0, 10)}`;
    const existing = this.platformStore.getUserProfileByUsername(base);
    if (!existing || existing.userId === userId) return base;
    return `${base.slice(0, 52)}-${sha256(userId).slice(0, 8)}`;
  }
}

function normalizeUsername(value: string) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/@spmt\.live$/, "");
  if (!/^[a-z0-9._-]{3,64}$/.test(normalized)) throw new AccountSetupError("username is invalid");
  return normalized;
}
function safeUsername(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return /^[a-z0-9._-]{3,64}$/.test(normalized) ? normalized : undefined;
}
function cleanDisplayName(value: string) {
  const normalized = value.trim().slice(0, 120);
  return normalized || "SpaceMountain member";
}
function requireId(value: string, name: string) {
  if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new AccountSetupError(`${name} is invalid`);
  return value;
}
function requireProviderUserId(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(normalized)) throw new AccountSetupError("A valid immutable providerUserId is required");
  return normalized;
}
function requireGrandfatherProvider(value: string): GrandfatherProviderV1 {
  if (value !== "discord" && value !== "twitch") throw new AccountSetupError("provider must be discord or twitch");
  return value;
}
function requirePassword(value: string) {
  if (typeof value !== "string" || value.length < 12 || value.length > 512) throw new AccountSetupError("Password must be at least 12 characters");
}
function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function addMinutes(iso: string, minutes: number) { return new Date(Date.parse(iso) + minutes * 60_000).toISOString(); }
