import { DatabaseSync } from "node:sqlite";
import { SpmtClient, buildXpIdempotencyKey } from "@spmt/sdk";

export const STREAMWEAVER_STEAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const STREAMWEAVER_MAX_CANONICAL_WAGER = 1_000_000;
export const STREAMWEAVER_MAX_CANONICAL_PAYOUT = 100_000_000;

export interface StreamWeaverGambleSettingsV1 {
  currencyName: string;
  defaultBet: number;
  minBet: number;
  maxBet: number;
  jackpotPercent: number;
  jackpotMultiplier: number;
  winPercent: number;
}

export const DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS: StreamWeaverGambleSettingsV1 = {
  currencyName: "Points",
  defaultBet: 1234,
  minBet: 0,
  maxBet: 0,
  jackpotPercent: 1,
  jackpotMultiplier: 1,
  winPercent: 28,
};

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
}

export class MemoryStreamWeaverEconomyStore implements StreamWeaverEconomyStoreV1 {
  private readonly cooldowns = new Map<string, number>();
  private readonly receipts = new Map<string, StreamWeaverEconomyReceiptV1>();
  private jackpotAt = 0;
  getCooldown(tenantId: string, userId: string) { return this.cooldowns.get(`${tenantId}:${userId}`) ?? 0; }
  putCooldown(tenantId: string, userId: string, timestamp: number) { this.cooldowns.set(`${tenantId}:${userId}`, timestamp); }
  getGlobalJackpotAt() { return this.jackpotAt; }
  putGlobalJackpotAt(timestamp: number) { this.jackpotAt = timestamp; }
  getReceipt(tenantId: string, operationId: string) { const value = this.receipts.get(`${tenantId}:${operationId}`); return value ? JSON.parse(JSON.stringify(value)) : undefined; }
  putReceipt(tenantId: string, receipt: StreamWeaverEconomyReceiptV1) { this.receipts.set(`${tenantId}:${receipt.operationId}`, JSON.parse(JSON.stringify(receipt))); }
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
    `);
  }
  close() { this.db.close(); }
  getCooldown(tenantId: string, userId: string) { return Number(this.read(`cooldown:${tenantId}:${userId}`)?.timestamp ?? 0); }
  putCooldown(tenantId: string, userId: string, timestamp: number) { this.write(`cooldown:${tenantId}:${userId}`, { timestamp }); }
  getGlobalJackpotAt() { return Number(this.read("global:jackpot")?.timestamp ?? 0); }
  putGlobalJackpotAt(timestamp: number) { this.write("global:jackpot", { timestamp }); }
  getReceipt(tenantId: string, operationId: string) { return this.read(`receipt:${tenantId}:${operationId}`) as StreamWeaverEconomyReceiptV1 | undefined; }
  putReceipt(tenantId: string, receipt: StreamWeaverEconomyReceiptV1) { this.write(`receipt:${tenantId}:${receipt.operationId}`, receipt); }
  private read(key: string) {
    const row = this.db.prepare("SELECT body FROM streamweaver_economy_state WHERE state_key=?").get(key) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as Record<string, unknown> : undefined;
  }
  private write(key: string, value: unknown) {
    this.db.prepare("INSERT INTO streamweaver_economy_state(state_key,body,updated_at) VALUES(?,?,?) ON CONFLICT(state_key) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at")
      .run(key, JSON.stringify(value), new Date().toISOString());
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
  client: SpmtClient;
  tenantId: string;
  store: StreamWeaverEconomyStoreV1;
  nowMs?: () => number;
  random?: () => number;
  settings?: Partial<StreamWeaverGambleSettingsV1>;
}

export class StreamWeaverEconomy {
  private readonly client: SpmtClient;
  private readonly tenantId: string;
  private readonly store: StreamWeaverEconomyStoreV1;
  private readonly nowMs: () => number;
  private readonly random: () => number;
  private readonly settings: StreamWeaverGambleSettingsV1;

  constructor(options: StreamWeaverEconomyOptionsV1) {
    this.client = options.client;
    this.tenantId = requireText(options.tenantId, "tenantId");
    this.store = options.store;
    this.nowMs = options.nowMs ?? Date.now;
    this.random = options.random ?? Math.random;
    this.settings = { ...DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS, ...(options.settings ?? {}) };
  }

  points(userId: string) { return this.client.getXpWallet(this.tenantId, requireText(userId, "userId")); }
  leaderboard(limit = 10) { return this.client.getXpLeaderboard(this.tenantId, limit); }

  async givePoints(input: { fromUserId: string; toUserId: string; fromDisplayName?: string; toDisplayName?: string; amount: number; operationId: string }) {
    const fromUserId = requireText(input.fromUserId, "fromUserId");
    const toUserId = requireText(input.toUserId, "toUserId");
    const operationId = requireText(input.operationId, "operationId");
    const prior = this.store.getReceipt(this.tenantId, operationId);
    if (prior) return { duplicate: true, ...prior.result };
    if (fromUserId === toUserId) return { success: false, duplicate: false, message: `@${input.fromDisplayName ?? fromUserId}, you can't give points to yourself!` };
    const amount = positiveAmount(input.amount);
    const wallet = await this.client.getXpWallet(this.tenantId, fromUserId);
    if (wallet.spendableXp < amount) return { success: false, duplicate: false, message: `@${input.fromDisplayName ?? fromUserId}, you only have ${wallet.spendableXp} points!` };
    const eventType = "streamweaver-givepoints";
    const key = buildXpIdempotencyKey({ sourceApp: "streamweaver", eventType, upstreamEventId: operationId, userId: `${fromUserId}:${toUserId}` });
    await this.client.transferXp(this.tenantId, fromUserId, toUserId, amount, eventType, key, { command: "!givepoints" });
    const result = { success: true, message: `@${input.fromDisplayName ?? fromUserId} gave ${amount} points to @${input.toDisplayName ?? toUserId}! 💝`, amount };
    this.receipt(operationId, "give", result);
    return { duplicate: false, ...result };
  }

  async stealPoints(input: { fromUserId: string; toUserId: string; fromDisplayName?: string; toDisplayName?: string; amount: number; operationId: string }) {
    const fromUserId = requireText(input.fromUserId, "fromUserId");
    const toUserId = requireText(input.toUserId, "toUserId");
    const operationId = requireText(input.operationId, "operationId");
    const prior = this.store.getReceipt(this.tenantId, operationId);
    if (prior) return { duplicate: true, ...prior.result };
    const fromName = input.fromDisplayName ?? fromUserId;
    const toName = input.toDisplayName ?? toUserId;
    if (fromUserId === toUserId) return { success: false, duplicate: false, message: `@${fromName}, you can't steal from yourself!` };
    const amount = positiveAmount(input.amount);
    if (amount > 1_000_000) return { success: false, duplicate: false, message: `@${fromName}, you can steal at most 1M points at a time!` };
    const now = this.nowMs();
    const lastSteal = this.store.getCooldown(this.tenantId, fromUserId);
    if (now - lastSteal < STREAMWEAVER_STEAL_COOLDOWN_MS) {
      const remaining = Math.ceil((STREAMWEAVER_STEAL_COOLDOWN_MS - (now - lastSteal)) / 60_000);
      return { success: false, duplicate: false, message: `@${fromName}, you're on cooldown! Wait ${remaining} more minutes.` };
    }
    const fromWallet = await this.client.getXpWallet(this.tenantId, fromUserId);
    if (fromWallet.spendableXp < amount) return { success: false, duplicate: false, message: `@${fromName}, you can only risk points you already have. You have ${formatCompactPointAmount(fromWallet.spendableXp)} points!` };
    const targetWallet = await this.client.getXpWallet(this.tenantId, toUserId);
    if (targetWallet.spendableXp < amount) return { success: false, duplicate: false, message: `@${fromName}, @${toName} only has ${formatCompactPointAmount(targetWallet.spendableXp)} points!` };

    const roll = this.random() * 100;
    const scenario = HEIST_SCENARIOS[Math.min(HEIST_SCENARIOS.length - 1, Math.floor(this.random() * HEIST_SCENARIOS.length))]!;
    let outcome: "success" | "partial" | "fail" | "critical-fail" | "catastrophic-fail";
    let pointsChanged = 0;
    let message: string;
    if (roll < 25) {
      outcome = "success"; pointsChanged = amount;
      await this.transferHeist(toUserId, fromUserId, amount, operationId, outcome);
      message = `@${fromName} ${scenario.success}! Stole ${formatCompactPointAmount(amount)} points from @${toName}! 💰`;
    } else if (roll < 55) {
      outcome = "partial"; pointsChanged = Math.floor(amount / 2);
      if (pointsChanged > 0) await this.transferHeist(toUserId, fromUserId, pointsChanged, operationId, outcome);
      message = `@${fromName} ${scenario.partial}! Got ${formatCompactPointAmount(pointsChanged)} points from @${toName}! 💸`;
    } else if (roll < 80) {
      outcome = "fail";
      message = `@${fromName} ${scenario.fail}! No points stolen. 😅`;
    } else if (roll < 95) {
      outcome = "critical-fail"; pointsChanged = Math.min(amount, fromWallet.spendableXp);
      if (pointsChanged > 0) await this.spendHeistPenalty(fromUserId, pointsChanged, operationId, outcome);
      message = `@${fromName} ${scenario.fail}! Lost ${formatCompactPointAmount(pointsChanged)} points in the attempt! 💥`;
    } else {
      outcome = "catastrophic-fail"; pointsChanged = Math.min(amount, fromWallet.spendableXp);
      if (pointsChanged > 0) await this.spendHeistPenalty(fromUserId, pointsChanged, operationId, outcome);
      message = `@${fromName} ${scenario.fail}! Lost ${formatCompactPointAmount(pointsChanged)} points in the catastrophic failure! 💀`;
    }
    this.store.putCooldown(this.tenantId, fromUserId, now);
    const result = { success: true, outcome, pointsChanged, message };
    this.receipt(operationId, "steal", result);
    return { duplicate: false, ...result };
  }

  async gamble(input: { userId: string; displayName?: string; bet?: string | number; operationId: string }) {
    const userId = requireText(input.userId, "userId");
    const operationId = requireText(input.operationId, "operationId");
    const prior = this.store.getReceipt(this.tenantId, operationId);
    if (prior) return { duplicate: true, ...prior.result };
    const wallet = await this.client.getXpWallet(this.tenantId, userId);
    const bet = parseBetAmount(input.bet, wallet.spendableXp, this.settings, this.random);
    if (bet <= 0) throw new Error("bet must be positive");
    if (bet > wallet.spendableXp) throw new Error(`you can't bet ${bet}; only ${wallet.spendableXp} is spendable`);
    if (bet > STREAMWEAVER_MAX_CANONICAL_WAGER) throw new Error(`canonical wager cap is ${STREAMWEAVER_MAX_CANONICAL_WAGER}`);
    const maxBet = effectiveMaxBet(wallet.spendableXp, this.settings);
    if (bet > maxBet) throw new Error(`maximum bet is ${maxBet}`);
    if (this.settings.minBet > 0 && bet < this.settings.minBet) throw new Error(`minimum bet is ${this.settings.minBet}`);

    const roll = Math.floor(this.random() * 100) + 1;
    const jackpotPercent = Math.max(1, this.settings.jackpotPercent);
    let winPercent = Math.max(1, this.settings.winPercent);
    if (winPercent < jackpotPercent) winPercent = jackpotPercent;
    if (winPercent >= 100) winPercent = 99;
    let outcome: "jackpot" | "win" | "loss";
    let change: number;
    if (roll <= jackpotPercent && this.claimGlobalJackpot()) {
      outcome = "jackpot";
      const profitPercent = Math.floor(150 + this.random() * 100);
      change = Math.floor((bet * profitPercent * Math.max(1, this.settings.jackpotMultiplier)) / 100);
    } else if (roll <= winPercent) {
      outcome = "win";
      const profitPercent = Math.floor(25 + this.random() * 51);
      change = Math.floor((bet * profitPercent) / 100);
    } else {
      outcome = "loss";
      change = -bet;
    }
    const payout = Math.max(0, bet + change);
    if (payout > STREAMWEAVER_MAX_CANONICAL_PAYOUT) throw new Error(`canonical payout cap is ${STREAMWEAVER_MAX_CANONICAL_PAYOUT}`);
    const eventType = "streamweaver-gamble";
    const key = buildXpIdempotencyKey({ sourceApp: "streamweaver", eventType, upstreamEventId: operationId, userId });
    const settlement = await this.client.settleXpGamble(this.tenantId, userId, bet, payout, eventType, key, { command: "!gamble", outcome, roll });
    const newTotal = settlement.wallet.spendableXp;
    const displayName = input.displayName ?? userId;
    const message = outcome === "loss"
      ? `@${displayName} lost ${formatCompactPointAmount(bet)} ${this.settings.currencyName}. New total: ${formatCompactPointAmount(newTotal)}.`
      : outcome === "jackpot"
        ? `🎰 JACKPOT! @${displayName} won ${formatCompactPointAmount(change)} ${this.settings.currencyName}! New total: ${formatCompactPointAmount(newTotal)}.`
        : `@${displayName} won ${formatCompactPointAmount(change)} ${this.settings.currencyName}! New total: ${formatCompactPointAmount(newTotal)}.`;
    const result = { success: true, outcome, roll, betAmount: bet, change, payout, newTotal, message, settlement };
    this.receipt(operationId, "gamble", result);
    return { duplicate: false, ...result };
  }

  async roll(input: { userId: string; displayName?: string; bet: number; operationId: string }) {
    const userId = requireText(input.userId, "userId");
    const operationId = requireText(input.operationId, "operationId");
    const prior = this.store.getReceipt(this.tenantId, operationId);
    if (prior) return { duplicate: true, ...prior.result };
    const wallet = await this.client.getXpWallet(this.tenantId, userId);
    const bet = positiveAmount(input.bet);
    if (bet > wallet.spendableXp) throw new Error("insufficient spendable XP");
    if (bet > STREAMWEAVER_MAX_CANONICAL_WAGER) throw new Error(`canonical wager cap is ${STREAMWEAVER_MAX_CANONICAL_WAGER}`);
    const die = Math.floor(this.random() * 6) + 1;
    const outcome = determineRollOutcome(die, bet);
    const payout = Math.max(0, bet + outcome.change);
    const eventType = "streamweaver-roll";
    const key = buildXpIdempotencyKey({ sourceApp: "streamweaver", eventType, upstreamEventId: operationId, userId });
    const settlement = await this.client.settleXpGamble(this.tenantId, userId, bet, payout, eventType, key, { command: "!roll", die, outcome: outcome.label });
    const result = { success: true, die, outcome: outcome.label, betAmount: bet, change: outcome.change, payout, newTotal: settlement.wallet.spendableXp, canDouble: die >= 4, settlement };
    this.receipt(operationId, "roll", result);
    return { duplicate: false, ...result };
  }

  private claimGlobalJackpot() {
    const now = this.nowMs();
    const previous = this.store.getGlobalJackpotAt();
    if (previous > 0 && now - previous < STREAMWEAVER_GLOBAL_JACKPOT_COOLDOWN_MS) return false;
    this.store.putGlobalJackpotAt(now);
    return true;
  }

  private async transferHeist(fromUserId: string, toUserId: string, amount: number, operationId: string, outcome: string) {
    const eventType = "streamweaver-stealpoints";
    const key = buildXpIdempotencyKey({ sourceApp: "streamweaver", eventType, upstreamEventId: `${operationId}:${outcome}`, userId: `${fromUserId}:${toUserId}` });
    await this.client.transferXp(this.tenantId, fromUserId, toUserId, amount, eventType, key, { command: "!stealpoints", outcome });
  }

  private async spendHeistPenalty(userId: string, amount: number, operationId: string, outcome: string) {
    const eventType = "streamweaver-stealpoints-penalty";
    const key = buildXpIdempotencyKey({ sourceApp: "streamweaver", eventType, upstreamEventId: `${operationId}:${outcome}`, userId });
    await this.client.spendXp(this.tenantId, userId, amount, eventType, key, { command: "!stealpoints", outcome });
  }

  private receipt(operationId: string, kind: StreamWeaverEconomyReceiptV1["kind"], result: Record<string, unknown>) {
    this.store.putReceipt(this.tenantId, { operationId, kind, result, createdAt: new Date(this.nowMs()).toISOString() });
  }
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
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("point amount exceeds safe canonical range");
    return amount;
  }
  const match = raw.match(/^(\d+(?:\.\d+)?)(k|m|b|t)?$/);
  if (!match) throw new Error("invalid point amount");
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
  const configured = settings.maxBet > 0 ? settings.maxBet : STREAMWEAVER_MAX_CANONICAL_WAGER;
  return Math.min(currentPoints, configured, STREAMWEAVER_MAX_CANONICAL_WAGER);
}
function positiveAmount(value: number) { const amount = Math.trunc(Number(value)); if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amount must be a positive safe integer"); return amount; }
function requireText(value: string, name: string) { if (!value || value.trim() !== value || value.length > 200) throw new Error(`${name} is invalid`); return value; }
function trimCompact(value: number) { return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.[0-9])0+$/, ""); }
