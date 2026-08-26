import { DatabaseSync } from "node:sqlite";
import { SpmtClient, buildXpIdempotencyKey } from "@spmt/sdk";

export const STREAMWEAVER_STEAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const STREAMWEAVER_MAX_LOCAL_WAGER = 1_000_000_000_000;
export const STREAMWEAVER_MAX_LOCAL_PAYOUT = 100_000_000_000_000;

export interface StreamWeaverGambleSettingsV1 {
  currencyName: string;
  currencyConfigured: boolean;
  defaultBet: number;
  minBet: number;
  maxBet: number;
  jackpotPercent: number;
  jackpotMultiplier: number;
  winPercent: number;
  spmtExchangeEnabled: boolean;
  baseLocalPerSpmt: number;
  referenceSupply: number;
  maxSpmtPerExchange: number;
}

export const DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS: StreamWeaverGambleSettingsV1 = {
  currencyName: "Credits",
  currencyConfigured: false,
  defaultBet: 1234,
  minBet: 0,
  maxBet: 0,
  jackpotPercent: 1,
  jackpotMultiplier: 1,
  winPercent: 28,
  spmtExchangeEnabled: false,
  baseLocalPerSpmt: 1000,
  referenceSupply: 1_000_000,
  maxSpmtPerExchange: 100,
};

export interface StreamWeaverCurrencyWalletV1 {
  tenantId: string;
  userId: string;
  balance: number;
  totalEarned: number;
}

export interface StreamWeaverCurrencyLeaderboardEntryV1 extends StreamWeaverCurrencyWalletV1 {
  rank: number;
}

export interface StreamWeaverCurrencyExchangeV1 {
  schemaVersion: 1;
  tenantId: string;
  operationId: string;
  userId: string;
  currencyName: string;
  localSpent: number;
  spmtAwarded: number;
  localPerSpmt: number;
  supplyAtQuote: number;
  status: "pending" | "complete";
  createdAt: string;
  completedAt?: string;
}

export type StreamWeaverEconomyReceiptV1 = {
  operationId: string;
  kind: "give" | "steal" | "gamble" | "roll";
  result: Record<string, unknown>;
  createdAt: string;
};

export interface StreamWeaverEconomyStoreV1 {
  getCooldown(tenantId: string, userId: string): number;
  putCooldown(tenantId: string, userId: string, timestamp: number): void;
  getGlobalJackpotAt(): number;
  putGlobalJackpotAt(timestamp: number): void;
  getReceipt(tenantId: string, operationId: string): StreamWeaverEconomyReceiptV1 | undefined;
  putReceipt(tenantId: string, receipt: StreamWeaverEconomyReceiptV1): void;
  getWallet(tenantId: string, userId: string): StreamWeaverCurrencyWalletV1;
  adjustBalance(tenantId: string, userId: string, delta: number, lifetimeEligible?: boolean): StreamWeaverCurrencyWalletV1;
  setBalance(tenantId: string, userId: string, target: number): StreamWeaverCurrencyWalletV1;
  transfer(tenantId: string, fromUserId: string, toUserId: string, amount: number): { from: StreamWeaverCurrencyWalletV1; to: StreamWeaverCurrencyWalletV1 };
  settleWager(tenantId: string, userId: string, wager: number, payout: number): StreamWeaverCurrencyWalletV1;
  listLeaderboard(tenantId: string, limit: number): StreamWeaverCurrencyLeaderboardEntryV1[];
  getCirculatingSupply(tenantId: string): number;
  getSettings(tenantId: string): StreamWeaverGambleSettingsV1 | undefined;
  putSettings(tenantId: string, settings: StreamWeaverGambleSettingsV1): StreamWeaverGambleSettingsV1;
  getExchange(tenantId: string, operationId: string): StreamWeaverCurrencyExchangeV1 | undefined;
  reserveExchange(input: StreamWeaverCurrencyExchangeV1): StreamWeaverCurrencyExchangeV1;
  completeExchange(tenantId: string, operationId: string, completedAt: string): StreamWeaverCurrencyExchangeV1;
}

export class MemoryStreamWeaverEconomyStore implements StreamWeaverEconomyStoreV1 {
  private readonly cooldowns = new Map<string, number>();
  private readonly receipts = new Map<string, StreamWeaverEconomyReceiptV1>();
  private readonly wallets = new Map<string, StreamWeaverCurrencyWalletV1>();
  private readonly settings = new Map<string, StreamWeaverGambleSettingsV1>();
  private readonly exchanges = new Map<string, StreamWeaverCurrencyExchangeV1>();
  private jackpotAt = 0;

  getCooldown(tenantId: string, userId: string) { return this.cooldowns.get(`${tenantId}:${userId}`) ?? 0; }
  putCooldown(tenantId: string, userId: string, timestamp: number) { this.cooldowns.set(`${tenantId}:${userId}`, timestamp); }
  getGlobalJackpotAt() { return this.jackpotAt; }
  putGlobalJackpotAt(timestamp: number) { this.jackpotAt = timestamp; }
  getReceipt(tenantId: string, operationId: string) { const value = this.receipts.get(`${tenantId}:${operationId}`); return value ? structuredClone(value) : undefined; }
  putReceipt(tenantId: string, receipt: StreamWeaverEconomyReceiptV1) { this.receipts.set(`${tenantId}:${receipt.operationId}`, structuredClone(receipt)); }
  getWallet(tenantId: string, userId: string) { return structuredClone(this.wallets.get(walletKey(tenantId, userId)) ?? emptyWallet(tenantId, userId)); }

  adjustBalance(tenantId: string, userId: string, delta: number, lifetimeEligible = false) {
    const current = this.getWallet(tenantId, userId);
    const nextBalance = safeNonNegative(current.balance + safeDelta(delta, "delta"), "balance");
    const next = { ...current, balance: nextBalance, totalEarned: current.totalEarned + (lifetimeEligible && delta > 0 ? delta : 0) };
    this.wallets.set(walletKey(tenantId, userId), structuredClone(next));
    return structuredClone(next);
  }

  setBalance(tenantId: string, userId: string, target: number) {
    const current = this.getWallet(tenantId, userId);
    const next = { ...current, balance: safeNonNegative(target, "target") };
    this.wallets.set(walletKey(tenantId, userId), structuredClone(next));
    return structuredClone(next);
  }

  transfer(tenantId: string, fromUserId: string, toUserId: string, amountInput: number) {
    const amount = positiveAmount(amountInput);
    const from = this.getWallet(tenantId, fromUserId);
    if (from.balance < amount) throw new Error("insufficient StreamWeaver currency");
    const nextFrom = this.adjustBalance(tenantId, fromUserId, -amount, false);
    const nextTo = this.adjustBalance(tenantId, toUserId, amount, false);
    return { from: nextFrom, to: nextTo };
  }

  settleWager(tenantId: string, userId: string, wagerInput: number, payoutInput: number) {
    const wager = positiveAmount(wagerInput);
    const payout = safeNonNegative(payoutInput, "payout");
    const wallet = this.getWallet(tenantId, userId);
    if (wallet.balance < wager) throw new Error("insufficient StreamWeaver currency");
    const delta = payout - wager;
    return this.adjustBalance(tenantId, userId, delta, delta > 0);
  }

  listLeaderboard(tenantId: string, limitInput: number) {
    const limit = boundedLimit(limitInput);
    return [...this.wallets.values()]
      .filter((wallet) => wallet.tenantId === tenantId)
      .sort((a, b) => b.balance - a.balance || a.userId.localeCompare(b.userId))
      .slice(0, limit)
      .map((wallet, index) => ({ ...structuredClone(wallet), rank: index + 1 }));
  }

  getCirculatingSupply(tenantId: string) {
    let total = 0;
    for (const wallet of this.wallets.values()) if (wallet.tenantId === tenantId) total += wallet.balance;
    for (const exchange of this.exchanges.values()) if (exchange.tenantId === tenantId && exchange.status === "pending") total += exchange.localSpent;
    return total;
  }

  getSettings(tenantId: string) { const value = this.settings.get(tenantId); return value ? structuredClone(value) : undefined; }
  putSettings(tenantId: string, settings: StreamWeaverGambleSettingsV1) { const value = normalizeSettings(settings); this.settings.set(tenantId, structuredClone(value)); return structuredClone(value); }
  getExchange(tenantId: string, operationId: string) { const value = this.exchanges.get(`${tenantId}:${operationId}`); return value ? structuredClone(value) : undefined; }

  reserveExchange(input: StreamWeaverCurrencyExchangeV1) {
    const key = `${input.tenantId}:${input.operationId}`;
    const existing = this.exchanges.get(key);
    if (existing) return structuredClone(existing);
    const wallet = this.getWallet(input.tenantId, input.userId);
    if (wallet.balance < input.localSpent) throw new Error("insufficient StreamWeaver currency for exchange");
    this.adjustBalance(input.tenantId, input.userId, -input.localSpent, false);
    this.exchanges.set(key, structuredClone(input));
    return structuredClone(input);
  }

  completeExchange(tenantId: string, operationId: string, completedAt: string) {
    const key = `${tenantId}:${operationId}`;
    const existing = this.exchanges.get(key);
    if (!existing) throw new Error("StreamWeaver exchange not found");
    const next = { ...existing, status: "complete" as const, completedAt: validTimestamp(completedAt, "completedAt") };
    this.exchanges.set(key, structuredClone(next));
    return structuredClone(next);
  }
}

export class SqliteStreamWeaverEconomyStore implements StreamWeaverEconomyStoreV1 {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("StreamWeaver economy database path is required");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streamweaver_economy_state(
        state_key TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_currency_wallet(
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
        total_earned INTEGER NOT NULL DEFAULT 0 CHECK(total_earned >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id,user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_currency_settings(
        tenant_id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_currency_exchange(
        tenant_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','complete')),
        local_spent INTEGER NOT NULL CHECK(local_spent > 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id,operation_id)
      ) STRICT;
    `);
  }
  close() { this.db.close(); }
  getCooldown(tenantId: string, userId: string) { return Number(this.read(`cooldown:${tenantId}:${userId}`)?.timestamp ?? 0); }
  putCooldown(tenantId: string, userId: string, timestamp: number) { this.write(`cooldown:${tenantId}:${userId}`, { timestamp }); }
  getGlobalJackpotAt() { return Number(this.read("global:jackpot")?.timestamp ?? 0); }
  putGlobalJackpotAt(timestamp: number) { this.write("global:jackpot", { timestamp }); }
  getReceipt(tenantId: string, operationId: string) { return this.read(`receipt:${tenantId}:${operationId}`) as StreamWeaverEconomyReceiptV1 | undefined; }
  putReceipt(tenantId: string, receipt: StreamWeaverEconomyReceiptV1) { this.write(`receipt:${tenantId}:${receipt.operationId}`, receipt); }

  getWallet(tenantIdInput: string, userIdInput: string) {
    const tenantId = requireText(tenantIdInput, "tenantId");
    const userId = requireText(userIdInput, "userId");
    const row = this.db.prepare("SELECT balance,total_earned FROM streamweaver_currency_wallet WHERE tenant_id=? AND user_id=?").get(tenantId, userId) as { balance: number; total_earned: number } | undefined;
    return row ? { tenantId, userId, balance: Number(row.balance), totalEarned: Number(row.total_earned) } : emptyWallet(tenantId, userId);
  }

  adjustBalance(tenantId: string, userId: string, deltaInput: number, lifetimeEligible = false) {
    const delta = safeDelta(deltaInput, "delta");
    return this.transaction(() => {
      const current = this.getWallet(tenantId, userId);
      const balance = safeNonNegative(current.balance + delta, "balance");
      const totalEarned = current.totalEarned + (lifetimeEligible && delta > 0 ? delta : 0);
      this.upsertWallet({ tenantId: current.tenantId, userId: current.userId, balance, totalEarned });
      return { ...current, balance, totalEarned };
    });
  }

  setBalance(tenantId: string, userId: string, targetInput: number) {
    const target = safeNonNegative(targetInput, "target");
    return this.transaction(() => {
      const current = this.getWallet(tenantId, userId);
      const next = { ...current, balance: target };
      this.upsertWallet(next);
      return next;
    });
  }

  transfer(tenantId: string, fromUserId: string, toUserId: string, amountInput: number) {
    const amount = positiveAmount(amountInput);
    return this.transaction(() => {
      const from = this.getWallet(tenantId, fromUserId);
      const to = this.getWallet(tenantId, toUserId);
      if (from.balance < amount) throw new Error("insufficient StreamWeaver currency");
      const nextFrom = { ...from, balance: from.balance - amount };
      const nextTo = { ...to, balance: to.balance + amount };
      this.upsertWallet(nextFrom);
      this.upsertWallet(nextTo);
      return { from: nextFrom, to: nextTo };
    });
  }

  settleWager(tenantId: string, userId: string, wagerInput: number, payoutInput: number) {
    const wager = positiveAmount(wagerInput);
    const payout = safeNonNegative(payoutInput, "payout");
    return this.transaction(() => {
      const current = this.getWallet(tenantId, userId);
      if (current.balance < wager) throw new Error("insufficient StreamWeaver currency");
      const delta = payout - wager;
      const next = { ...current, balance: current.balance + delta, totalEarned: current.totalEarned + Math.max(0, delta) };
      this.upsertWallet(next);
      return next;
    });
  }

  listLeaderboard(tenantIdInput: string, limitInput: number) {
    const tenantId = requireText(tenantIdInput, "tenantId");
    const limit = boundedLimit(limitInput);
    const rows = this.db.prepare("SELECT user_id,balance,total_earned FROM streamweaver_currency_wallet WHERE tenant_id=? ORDER BY balance DESC,user_id ASC LIMIT ?").all(tenantId, limit) as { user_id: string; balance: number; total_earned: number }[];
    return rows.map((row, index) => ({ schemaVersion: undefined, tenantId, userId: row.user_id, balance: Number(row.balance), totalEarned: Number(row.total_earned), rank: index + 1 })).map(({ schemaVersion: _ignored, ...entry }) => entry);
  }

  getCirculatingSupply(tenantIdInput: string) {
    const tenantId = requireText(tenantIdInput, "tenantId");
    const wallet = this.db.prepare("SELECT COALESCE(SUM(balance),0) AS total FROM streamweaver_currency_wallet WHERE tenant_id=?").get(tenantId) as { total: number };
    const pending = this.db.prepare("SELECT COALESCE(SUM(local_spent),0) AS total FROM streamweaver_currency_exchange WHERE tenant_id=? AND status='pending'").get(tenantId) as { total: number };
    return Number(wallet.total ?? 0) + Number(pending.total ?? 0);
  }

  getSettings(tenantIdInput: string) {
    const tenantId = requireText(tenantIdInput, "tenantId");
    const row = this.db.prepare("SELECT body FROM streamweaver_currency_settings WHERE tenant_id=?").get(tenantId) as { body: string } | undefined;
    return row ? normalizeSettings(JSON.parse(row.body) as StreamWeaverGambleSettingsV1) : undefined;
  }

  putSettings(tenantIdInput: string, settings: StreamWeaverGambleSettingsV1) {
    const tenantId = requireText(tenantIdInput, "tenantId");
    const value = normalizeSettings(settings);
    this.db.prepare("INSERT INTO streamweaver_currency_settings(tenant_id,body,updated_at) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at")
      .run(tenantId, JSON.stringify(value), new Date().toISOString());
    return value;
  }

  getExchange(tenantIdInput: string, operationIdInput: string) {
    const tenantId = requireText(tenantIdInput, "tenantId");
    const operationId = requireText(operationIdInput, "operationId");
    const row = this.db.prepare("SELECT body FROM streamweaver_currency_exchange WHERE tenant_id=? AND operation_id=?").get(tenantId, operationId) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as StreamWeaverCurrencyExchangeV1 : undefined;
  }

  reserveExchange(input: StreamWeaverCurrencyExchangeV1) {
    return this.transaction(() => {
      const existing = this.getExchange(input.tenantId, input.operationId);
      if (existing) return existing;
      const wallet = this.getWallet(input.tenantId, input.userId);
      if (wallet.balance < input.localSpent) throw new Error("insufficient StreamWeaver currency for exchange");
      this.upsertWallet({ ...wallet, balance: wallet.balance - input.localSpent });
      this.db.prepare("INSERT INTO streamweaver_currency_exchange(tenant_id,operation_id,user_id,body,status,local_spent,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(input.tenantId, input.operationId, input.userId, JSON.stringify(input), input.status, input.localSpent, input.createdAt);
      return input;
    });
  }

  completeExchange(tenantIdInput: string, operationIdInput: string, completedAtInput: string) {
    const tenantId = requireText(tenantIdInput, "tenantId");
    const operationId = requireText(operationIdInput, "operationId");
    const completedAt = validTimestamp(completedAtInput, "completedAt");
    return this.transaction(() => {
      const existing = this.getExchange(tenantId, operationId);
      if (!existing) throw new Error("StreamWeaver exchange not found");
      if (existing.status === "complete") return existing;
      const next = { ...existing, status: "complete" as const, completedAt };
      this.db.prepare("UPDATE streamweaver_currency_exchange SET body=?,status='complete',updated_at=? WHERE tenant_id=? AND operation_id=?")
        .run(JSON.stringify(next), completedAt, tenantId, operationId);
      return next;
    });
  }

  private upsertWallet(wallet: StreamWeaverCurrencyWalletV1) {
    this.db.prepare("INSERT INTO streamweaver_currency_wallet(tenant_id,user_id,balance,total_earned,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET balance=excluded.balance,total_earned=excluded.total_earned,updated_at=excluded.updated_at")
      .run(wallet.tenantId, wallet.userId, wallet.balance, wallet.totalEarned, new Date().toISOString());
  }
  private read(key: string) {
    const row = this.db.prepare("SELECT body FROM streamweaver_economy_state WHERE state_key=?").get(key) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as Record<string, unknown> : undefined;
  }
  private write(key: string, value: unknown) {
    this.db.prepare("INSERT INTO streamweaver_economy_state(state_key,body,updated_at) VALUES(?,?,?) ON CONFLICT(state_key) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at")
      .run(key, JSON.stringify(value), new Date().toISOString());
  }
  private transaction<T>(fn: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

const HEIST_SCENARIOS = [
  { success: "slipped past the security lasers and grabbed the loot", fail: "triggered the alarm and had to flee empty-handed", partial: "grabbed what they could before the guards arrived" },
  { success: "hacked the vault and transferred the credits", fail: "got caught in the firewall and lost their connection", partial: "managed to grab some data before getting disconnected" },
  { success: "teleported in, snatched the goods, and vanished", fail: "miscalculated the coordinates and ended up in the wrong sector", partial: "grabbed a handful before the teleporter malfunctioned" },
  { success: "sweet-talked the AI guardian and walked away with everything", fail: "got outsmarted by the AI and ejected from the station", partial: "charmed their way to a small share before being escorted out" },
  { success: "used a cloaking device and cleaned out the vault", fail: "the cloak failed and they were spotted immediately", partial: "the cloak flickered, forcing a quick grab-and-run" },
] as const;

export interface StreamWeaverEconomyOptionsV1 {
  client?: SpmtClient;
  tenantId: string;
  store: StreamWeaverEconomyStoreV1;
  nowMs?: () => number;
  random?: () => number;
  settings?: Partial<StreamWeaverGambleSettingsV1>;
}

export class StreamWeaverEconomy {
  private readonly client?: SpmtClient;
  private readonly tenantId: string;
  private readonly store: StreamWeaverEconomyStoreV1;
  private readonly nowMs: () => number;
  private readonly random: () => number;

  constructor(options: StreamWeaverEconomyOptionsV1) {
    this.client = options.client;
    this.tenantId = requireText(options.tenantId, "tenantId");
    this.store = options.store;
    this.nowMs = options.nowMs ?? Date.now;
    this.random = options.random ?? Math.random;
    if (options.settings) {
      const current = this.store.getSettings(this.tenantId) ?? DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS;
      const explicitName = typeof options.settings.currencyName === "string" && options.settings.currencyName.trim().length > 0;
      this.store.putSettings(this.tenantId, normalizeSettings({ ...current, ...options.settings, currencyConfigured: options.settings.currencyConfigured ?? (explicitName ? true : current.currencyConfigured) }));
    }
  }

  configureCurrency(input: { currencyName: string; spmtExchangeEnabled?: boolean; baseLocalPerSpmt?: number; referenceSupply?: number; maxSpmtPerExchange?: number; defaultBet?: number; minBet?: number; maxBet?: number; jackpotPercent?: number; jackpotMultiplier?: number; winPercent?: number }) {
    const current = this.store.getSettings(this.tenantId) ?? DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS;
    const next = normalizeSettings({ ...current, ...input, currencyName: validateStreamWeaverCurrencyName(input.currencyName), currencyConfigured: true });
    return this.store.putSettings(this.tenantId, next);
  }

  getCurrencySettings() { return normalizeSettings(this.store.getSettings(this.tenantId) ?? DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS); }
  currencyName() { return this.requireCurrencySettings().currencyName; }
  points(userId: string) { this.requireCurrencySettings(); return this.store.getWallet(this.tenantId, requireText(userId, "userId")); }
  leaderboard(limit = 10) { this.requireCurrencySettings(); return this.store.listLeaderboard(this.tenantId, limit); }

  async givePoints(input: { fromUserId: string; toUserId: string; fromDisplayName?: string; toDisplayName?: string; amount: number; operationId: string }) {
    const settings = this.requireCurrencySettings();
    const fromUserId = requireText(input.fromUserId, "fromUserId");
    const toUserId = requireText(input.toUserId, "toUserId");
    const operationId = requireText(input.operationId, "operationId");
    const prior = this.store.getReceipt(this.tenantId, operationId);
    if (prior) return { duplicate: true, ...prior.result };
    if (fromUserId === toUserId) return { success: false, duplicate: false, message: `@${input.fromDisplayName ?? fromUserId}, you can't give ${settings.currencyName} to yourself!` };
    const amount = positiveAmount(input.amount);
    const wallet = this.store.getWallet(this.tenantId, fromUserId);
    if (wallet.balance < amount) return { success: false, duplicate: false, message: `@${input.fromDisplayName ?? fromUserId}, you only have ${formatCompactPointAmount(wallet.balance)} ${settings.currencyName}!` };
    this.store.transfer(this.tenantId, fromUserId, toUserId, amount);
    const result = { success: true, message: `@${input.fromDisplayName ?? fromUserId} gave ${formatCompactPointAmount(amount)} ${settings.currencyName} to @${input.toDisplayName ?? toUserId}! 💝`, amount };
    this.receipt(operationId, "give", result);
    return { duplicate: false, ...result };
  }

  async stealPoints(input: { fromUserId: string; toUserId: string; fromDisplayName?: string; toDisplayName?: string; amount: number; operationId: string }) {
    const settings = this.requireCurrencySettings();
    const fromUserId = requireText(input.fromUserId, "fromUserId");
    const toUserId = requireText(input.toUserId, "toUserId");
    const operationId = requireText(input.operationId, "operationId");
    const prior = this.store.getReceipt(this.tenantId, operationId);
    if (prior) return { duplicate: true, ...prior.result };
    const fromName = input.fromDisplayName ?? fromUserId;
    const toName = input.toDisplayName ?? toUserId;
    if (fromUserId === toUserId) return { success: false, duplicate: false, message: `@${fromName}, you can't steal from yourself!` };
    const amount = positiveAmount(input.amount);
    if (amount > STREAMWEAVER_MAX_LOCAL_WAGER) return { success: false, duplicate: false, message: `@${fromName}, that ${settings.currencyName} amount is too large for one heist.` };
    const now = this.nowMs();
    const lastSteal = this.store.getCooldown(this.tenantId, fromUserId);
    if (lastSteal > 0 && now - lastSteal < STREAMWEAVER_STEAL_COOLDOWN_MS) {
      const remaining = Math.ceil((STREAMWEAVER_STEAL_COOLDOWN_MS - (now - lastSteal)) / 60_000);
      return { success: false, duplicate: false, message: `@${fromName}, you're on cooldown! Wait ${remaining} more minutes.` };
    }
    const fromWallet = this.store.getWallet(this.tenantId, fromUserId);
    if (fromWallet.balance < amount) return { success: false, duplicate: false, message: `@${fromName}, you can only risk ${settings.currencyName} you already have. You have ${formatCompactPointAmount(fromWallet.balance)}.` };
    const targetWallet = this.store.getWallet(this.tenantId, toUserId);
    if (targetWallet.balance < amount) return { success: false, duplicate: false, message: `@${fromName}, @${toName} only has ${formatCompactPointAmount(targetWallet.balance)} ${settings.currencyName}!` };

    const roll = this.random() * 100;
    const scenario = HEIST_SCENARIOS[Math.min(HEIST_SCENARIOS.length - 1, Math.floor(this.random() * HEIST_SCENARIOS.length))]!;
    let outcome: "success" | "partial" | "fail" | "critical-fail" | "catastrophic-fail";
    let pointsChanged = 0;
    let message: string;
    if (roll < 25) {
      outcome = "success"; pointsChanged = amount;
      this.store.transfer(this.tenantId, toUserId, fromUserId, amount);
      message = `@${fromName} ${scenario.success}! Stole ${formatCompactPointAmount(amount)} ${settings.currencyName} from @${toName}! 💰`;
    } else if (roll < 55) {
      outcome = "partial"; pointsChanged = Math.floor(amount / 2);
      if (pointsChanged > 0) this.store.transfer(this.tenantId, toUserId, fromUserId, pointsChanged);
      message = `@${fromName} ${scenario.partial}! Got ${formatCompactPointAmount(pointsChanged)} ${settings.currencyName} from @${toName}! 💸`;
    } else if (roll < 80) {
      outcome = "fail";
      message = `@${fromName} ${scenario.fail}! No ${settings.currencyName} stolen. 😅`;
    } else if (roll < 95) {
      outcome = "critical-fail"; pointsChanged = Math.min(amount, fromWallet.balance);
      if (pointsChanged > 0) this.store.adjustBalance(this.tenantId, fromUserId, -pointsChanged, false);
      message = `@${fromName} ${scenario.fail}! Lost ${formatCompactPointAmount(pointsChanged)} ${settings.currencyName} in the attempt! 💥`;
    } else {
      outcome = "catastrophic-fail"; pointsChanged = Math.min(amount, fromWallet.balance);
      if (pointsChanged > 0) this.store.adjustBalance(this.tenantId, fromUserId, -pointsChanged, false);
      message = `@${fromName} ${scenario.fail}! Lost ${formatCompactPointAmount(pointsChanged)} ${settings.currencyName} in the catastrophic failure! 💀`;
    }
    this.store.putCooldown(this.tenantId, fromUserId, now);
    const result = { success: true, outcome, pointsChanged, message };
    this.receipt(operationId, "steal", result);
    return { duplicate: false, ...result };
  }

  async gamble(input: { userId: string; displayName?: string; bet?: string | number; operationId: string }) {
    const settings = this.requireCurrencySettings();
    const userId = requireText(input.userId, "userId");
    const operationId = requireText(input.operationId, "operationId");
    const prior = this.store.getReceipt(this.tenantId, operationId);
    if (prior) return { duplicate: true, ...prior.result };
    const wallet = this.store.getWallet(this.tenantId, userId);
    const bet = parseBetAmount(input.bet, wallet.balance, settings, this.random);
    if (bet <= 0) throw new Error("bet must be positive");
    if (bet > wallet.balance) throw new Error(`you can't bet ${formatCompactPointAmount(bet)} ${settings.currencyName}; only ${formatCompactPointAmount(wallet.balance)} is available`);
    if (bet > STREAMWEAVER_MAX_LOCAL_WAGER) throw new Error(`local wager cap is ${STREAMWEAVER_MAX_LOCAL_WAGER}`);
    const maxBet = effectiveMaxBet(wallet.balance, settings);
    if (bet > maxBet) throw new Error(`maximum bet is ${formatCompactPointAmount(maxBet)} ${settings.currencyName}`);
    if (settings.minBet > 0 && bet < settings.minBet) throw new Error(`minimum bet is ${formatCompactPointAmount(settings.minBet)} ${settings.currencyName}`);

    const roll = Math.floor(this.random() * 100) + 1;
    const jackpotPercent = Math.max(1, settings.jackpotPercent);
    let winPercent = Math.max(1, settings.winPercent);
    if (winPercent < jackpotPercent) winPercent = jackpotPercent;
    if (winPercent >= 100) winPercent = 99;
    let outcome: "jackpot" | "win" | "loss";
    let change: number;
    if (roll <= jackpotPercent && this.claimGlobalJackpot()) {
      outcome = "jackpot";
      const profitPercent = Math.floor(150 + this.random() * 100);
      change = Math.floor((bet * profitPercent * Math.max(1, settings.jackpotMultiplier)) / 100);
    } else if (roll <= winPercent) {
      outcome = "win";
      const profitPercent = Math.floor(25 + this.random() * 51);
      change = Math.floor((bet * profitPercent) / 100);
    } else {
      outcome = "loss";
      change = -bet;
    }
    const payout = Math.max(0, bet + change);
    if (payout > STREAMWEAVER_MAX_LOCAL_PAYOUT) throw new Error(`local payout cap is ${STREAMWEAVER_MAX_LOCAL_PAYOUT}`);
    const settled = this.store.settleWager(this.tenantId, userId, bet, payout);
    const newTotal = settled.balance;
    const displayName = input.displayName ?? userId;
    const message = outcome === "loss"
      ? `@${displayName} lost ${formatCompactPointAmount(bet)} ${settings.currencyName}. New total: ${formatCompactPointAmount(newTotal)}.`
      : outcome === "jackpot"
        ? `🎰 JACKPOT! @${displayName} won ${formatCompactPointAmount(change)} ${settings.currencyName}! New total: ${formatCompactPointAmount(newTotal)}.`
        : `@${displayName} won ${formatCompactPointAmount(change)} ${settings.currencyName}! New total: ${formatCompactPointAmount(newTotal)}.`;
    const result = { success: true, outcome, roll, betAmount: bet, change, payout, newTotal, message };
    this.receipt(operationId, "gamble", result);
    return { duplicate: false, ...result };
  }

  async roll(input: { userId: string; displayName?: string; bet: number; operationId: string }) {
    this.requireCurrencySettings();
    const userId = requireText(input.userId, "userId");
    const operationId = requireText(input.operationId, "operationId");
    const prior = this.store.getReceipt(this.tenantId, operationId);
    if (prior) return { duplicate: true, ...prior.result };
    const wallet = this.store.getWallet(this.tenantId, userId);
    const bet = positiveAmount(input.bet);
    if (bet > wallet.balance) throw new Error("insufficient StreamWeaver currency");
    if (bet > STREAMWEAVER_MAX_LOCAL_WAGER) throw new Error(`local wager cap is ${STREAMWEAVER_MAX_LOCAL_WAGER}`);
    const die = Math.floor(this.random() * 6) + 1;
    const outcome = determineRollOutcome(die, bet);
    const payout = Math.max(0, bet + outcome.change);
    const settled = this.store.settleWager(this.tenantId, userId, bet, payout);
    const result = { success: true, die, outcome: outcome.label, betAmount: bet, change: outcome.change, payout, newTotal: settled.balance, canDouble: die >= 4 };
    this.receipt(operationId, "roll", result);
    return { duplicate: false, ...result };
  }

  quoteLocalToSpmt(localAmountInput: number) {
    const settings = this.requireCurrencySettings();
    if (!settings.spmtExchangeEnabled) throw new Error("SPMT exchange is not enabled for this StreamWeaver tenant");
    const localAmount = positiveAmount(localAmountInput);
    const supply = this.store.getCirculatingSupply(this.tenantId);
    const rate = calculateStreamWeaverExchangeRate(supply, settings);
    const uncappedSpmt = Math.floor(localAmount / rate.localPerSpmt);
    const spmtAmount = Math.min(uncappedSpmt, settings.maxSpmtPerExchange);
    if (spmtAmount < 1) throw new Error(`at the current supply, at least ${formatCompactPointAmount(rate.localPerSpmt)} ${settings.currencyName} is required for 1 SPMT XP`);
    const localSpent = spmtAmount * rate.localPerSpmt;
    return { ...rate, currencyName: settings.currencyName, requestedLocal: localAmount, localSpent, localRemainder: localAmount - localSpent, spmtAmount };
  }

  async exchangeLocalForSpmt(input: { userId: string; localAmount: number; operationId: string }) {
    const settings = this.requireCurrencySettings();
    if (!settings.spmtExchangeEnabled) throw new Error("SPMT exchange is not enabled for this StreamWeaver tenant");
    if (!this.client) throw new Error("SPMT client is required for currency exchange");
    const userId = requireText(input.userId, "userId");
    const operationId = requireText(input.operationId, "operationId");
    let exchange = this.store.getExchange(this.tenantId, operationId);
    if (!exchange) {
      const quote = this.quoteLocalToSpmt(input.localAmount);
      exchange = this.store.reserveExchange({
        schemaVersion: 1,
        tenantId: this.tenantId,
        operationId,
        userId,
        currencyName: settings.currencyName,
        localSpent: quote.localSpent,
        spmtAwarded: quote.spmtAmount,
        localPerSpmt: quote.localPerSpmt,
        supplyAtQuote: quote.circulatingSupply,
        status: "pending",
        createdAt: new Date(this.nowMs()).toISOString(),
      });
    }
    if (exchange.userId !== userId) throw new Error("exchange operation belongs to another user");
    if (exchange.status === "complete") return { success: true, duplicate: true, pending: false, exchange, wallet: this.store.getWallet(this.tenantId, userId) };
    const eventType = "streamweaver-local-exchange";
    const key = buildXpIdempotencyKey({ sourceApp: "streamweaver", eventType, upstreamEventId: operationId, userId });
    try {
      await this.client.awardXp(this.tenantId, userId, exchange.spmtAwarded, eventType, key, {
        eventType,
        metadata: {
          source: "streamweaver-local-currency",
          currencyName: exchange.currencyName,
          localSpent: exchange.localSpent,
          localPerSpmt: exchange.localPerSpmt,
          supplyAtQuote: exchange.supplyAtQuote,
        },
      });
    } catch (error) {
      return { success: false, duplicate: false, pending: true, exchange, message: error instanceof Error ? error.message : "SPMT exchange is pending retry" };
    }
    const complete = this.store.completeExchange(this.tenantId, operationId, new Date(this.nowMs()).toISOString());
    return { success: true, duplicate: false, pending: false, exchange: complete, wallet: this.store.getWallet(this.tenantId, userId) };
  }

  private requireCurrencySettings() {
    const settings = this.getCurrencySettings();
    if (!settings.currencyConfigured) throw new Error("StreamWeaver owner must choose a custom currency name before economy commands can be used");
    return settings;
  }

  private claimGlobalJackpot() {
    const now = this.nowMs();
    const previous = this.store.getGlobalJackpotAt();
    if (previous > 0 && now - previous < STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS) return false;
    this.store.putGlobalJackpotAt(now);
    return true;
  }

  private receipt(operationId: string, kind: StreamWeaverEconomyReceiptV1["kind"], result: Record<string, unknown>) {
    this.store.putReceipt(this.tenantId, { operationId, kind, result, createdAt: new Date(this.nowMs()).toISOString() });
  }
}

export function calculateStreamWeaverExchangeRate(circulatingSupplyInput: number, settingsInput: StreamWeaverGambleSettingsV1) {
  const settings = normalizeSettings(settingsInput);
  const circulatingSupply = safeNonNegative(circulatingSupplyInput, "circulatingSupply");
  const effectiveSupply = Math.max(settings.referenceSupply, circulatingSupply);
  const localPerSpmt = Math.max(1, Math.ceil((settings.baseLocalPerSpmt * effectiveSupply) / settings.referenceSupply));
  const canonicalValueCap = Math.floor(settings.referenceSupply / settings.baseLocalPerSpmt);
  return { circulatingSupply, referenceSupply: settings.referenceSupply, baseLocalPerSpmt: settings.baseLocalPerSpmt, localPerSpmt, canonicalValueCap };
}

export function validateStreamWeaverCurrencyName(value: string) {
  const name = String(value ?? "").trim();
  if (name.length < 2 || name.length > 32) throw new Error("currency name must be 2 through 32 characters");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&._-]*$/u.test(name)) throw new Error("currency name contains unsupported characters");
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const reserved = new Set(["xp", "spmt", "spmts", "experience", "spacemountain", "spacemountainlive"]);
  if (tokens.some((token) => reserved.has(token))) throw new Error("currency name cannot use SPMT or XP identity terms");
  return name;
}

export function determineRollOutcome(roll: number, betAmount: number) {
  switch (roll) {
    case 1: return { label: "Total loss!", change: -betAmount };
    case 2: return { label: "Partial loss", change: -Math.floor(betAmount / 2) };
    case 3: return { label: "Break even", change: 0 };
    case 4: return { label: "Small win!", change: Math.floor(betAmount / 4) };
    case 5: return { label: "Nice win!", change: Math.floor(betAmount / 2) };
    case 6: return { label: "Big win!", change: betAmount };
    default: return { label: "Error", change: 0 };
  }
}

export function parseStreamWeaverPointAmount(value: string | number): number {
  if (typeof value === "number") return positiveAmount(value);
  const raw = value.trim().toLowerCase().replaceAll(",", "");
  const scientific = raw.match(/^(\d+)\^(\d+)$/);
  if (scientific) {
    const base = Number(scientific[1]); const exponent = Number(scientific[2]);
    const amount = base ** exponent;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("currency amount exceeds safe range");
    return amount;
  }
  const match = raw.match(/^(\d+(?:\.\d+)?)(k|m|b|t)?$/);
  if (!match) throw new Error("invalid currency amount");
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "b" ? 1_000_000_000 : match[2] === "t" ? 1_000_000_000_000 : 1;
  return positiveAmount(Math.floor(Number(match[1]) * multiplier));
}

export function formatCompactPointAmount(value: number) {
  const amount = Math.trunc(value);
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}${trimCompact(abs / 1_000_000_000_000)}T`;
  if (abs >= 1_000_000_000) return `${sign}${trimCompact(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}${trimCompact(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${trimCompact(abs / 1_000)}K`;
  return String(amount);
}

function normalizeSettings(input: Partial<StreamWeaverGambleSettingsV1>) {
  const merged = { ...DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS, ...input };
  const currencyName = merged.currencyConfigured ? validateStreamWeaverCurrencyName(merged.currencyName) : String(merged.currencyName || DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS.currencyName).trim();
  const defaultBet = positiveAmount(merged.defaultBet);
  const minBet = safeNonNegative(merged.minBet, "minBet");
  const maxBet = safeNonNegative(merged.maxBet, "maxBet");
  const jackpotPercent = boundedPercent(merged.jackpotPercent, "jackpotPercent");
  const jackpotMultiplier = Math.max(1, safeNonNegative(merged.jackpotMultiplier, "jackpotMultiplier"));
  const winPercent = boundedPercent(merged.winPercent, "winPercent");
  const baseLocalPerSpmt = positiveAmount(merged.baseLocalPerSpmt);
  const referenceSupply = positiveAmount(merged.referenceSupply);
  const maxSpmtPerExchange = positiveAmount(merged.maxSpmtPerExchange);
  return { ...merged, currencyName, currencyConfigured: Boolean(merged.currencyConfigured), defaultBet, minBet, maxBet, jackpotPercent, jackpotMultiplier, winPercent, spmtExchangeEnabled: Boolean(merged.spmtExchangeEnabled), baseLocalPerSpmt, referenceSupply, maxSpmtPerExchange } satisfies StreamWeaverGambleSettingsV1;
}
function parseBetAmount(input: string | number | undefined, currentPoints: number, settings: StreamWeaverGambleSettingsV1, random: () => number) {
  if (input === undefined || String(input).trim() === "") return positiveAmount(settings.defaultBet);
  if (typeof input === "number") return positiveAmount(input);
  const upper = input.trim().toUpperCase();
  const maxBet = effectiveMaxBet(currentPoints, settings);
  if (upper === "ALL") return maxBet;
  if (upper === "HALF") return Math.min(Math.floor(currentPoints / 2), maxBet);
  if (upper === "QUARTER") return Math.min(Math.floor(currentPoints / 4), maxBet);
  if (upper === "THIRD") return Math.min(Math.floor(currentPoints / 3), maxBet);
  if (upper === "RANDOM") return maxBet > 0 ? Math.floor(random() * maxBet) + 1 : 0;
  return parseStreamWeaverPointAmount(input);
}
function effectiveMaxBet(currentPoints: number, settings: StreamWeaverGambleSettingsV1) {
  const configured = settings.maxBet > 0 ? settings.maxBet : STREAMWEAVER_MAX_LOCAL_WAGER;
  return Math.min(currentPoints, configured, STREAMWEAVER_MAX_LOCAL_WAGER);
}
function emptyWallet(tenantIdInput: string, userIdInput: string): StreamWeaverCurrencyWalletV1 { return { tenantId: requireText(tenantIdInput, "tenantId"), userId: requireText(userIdInput, "userId"), balance: 0, totalEarned: 0 }; }
function walletKey(tenantId: string, userId: string) { return `${requireText(tenantId, "tenantId")}:${requireText(userId, "userId")}`; }
function boundedLimit(value: number) { const parsed = Math.trunc(Number(value)); if (!Number.isSafeInteger(parsed)) throw new Error("limit is invalid"); return Math.max(1, Math.min(100, parsed)); }
function boundedPercent(value: number, name: string) { const parsed = Math.trunc(Number(value)); if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) throw new Error(`${name} must be from 0 through 100`); return parsed; }
function positiveAmount(value: number) { const amount = Math.trunc(Number(value)); if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amount must be a positive safe integer"); return amount; }
function safeNonNegative(value: number, name: string) { const amount = Math.trunc(Number(value)); if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`${name} must be a non-negative safe integer`); return amount; }
function safeDelta(value: number, name: string) { const amount = Math.trunc(Number(value)); if (!Number.isSafeInteger(amount)) throw new Error(`${name} must be a safe integer`); return amount; }
function requireText(value: string, name: string) { if (!value || value.trim() !== value || value.length > 200 || /[\r\n\0]/.test(value)) throw new Error(`${name} is invalid`); return value; }
function validTimestamp(value: string, name: string) { if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp`); return new Date(Date.parse(value)).toISOString(); }
function trimCompact(value: number) { return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.[0-9])0+$/, ""); }
