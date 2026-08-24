import { DatabaseSync } from "node:sqlite";
import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";
import { StreamWeaverAdminEconomy } from "./economy-admin.js";
import { StreamWeaverEconomy, formatCompactPointAmount, parseStreamWeaverPointAmount } from "./economy.js";

export interface StreamWeaverCommandIdentityResolverV1 {
  resolve(input: { tenantId: string; provider: NormalizedChatMessageV1["provider"]; providerUserId: string; username: string; displayName?: string }): Promise<string | undefined> | string | undefined;
}
export interface StreamWeaverCommandEgressV1 { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>; }

export interface StreamWeaverCommandReceiptV1 { tenantId: string; deliveryId: string; command: string; text: string; createdAt: string; }
export interface StreamWeaverCommandStateV1 {
  getCooldown(key: string): number;
  putCooldown(key: string, timestamp: number): void;
  getReceipt(tenantId: string, deliveryId: string): StreamWeaverCommandReceiptV1 | undefined;
  putReceipt(receipt: StreamWeaverCommandReceiptV1): void;
}

export class MemoryStreamWeaverCommandState implements StreamWeaverCommandStateV1 {
  private readonly cooldowns = new Map<string, number>();
  private readonly receipts = new Map<string, StreamWeaverCommandReceiptV1>();
  getCooldown(key: string) { return this.cooldowns.get(key) ?? 0; }
  putCooldown(key: string, timestamp: number) { this.cooldowns.set(key, timestamp); }
  getReceipt(tenantId: string, deliveryId: string) { const value = this.receipts.get(`${tenantId}:${deliveryId}`); return value ? structuredClone(value) : undefined; }
  putReceipt(receipt: StreamWeaverCommandReceiptV1) { this.receipts.set(`${receipt.tenantId}:${receipt.deliveryId}`, structuredClone(receipt)); }
}

export class SqliteStreamWeaverCommandState implements StreamWeaverCommandStateV1 {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("StreamWeaver command database path is required");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streamweaver_command_state(
        state_key TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }
  close() { this.db.close(); }
  getCooldown(key: string) { return Number(this.read(`cooldown:${key}`)?.timestamp ?? 0); }
  putCooldown(key: string, timestamp: number) { this.write(`cooldown:${key}`, { timestamp }); }
  getReceipt(tenantId: string, deliveryId: string) { return this.read(`receipt:${tenantId}:${deliveryId}`) as StreamWeaverCommandReceiptV1 | undefined; }
  putReceipt(receipt: StreamWeaverCommandReceiptV1) { this.write(`receipt:${receipt.tenantId}:${receipt.deliveryId}`, receipt); }
  private read(key: string) { const row = this.db.prepare("SELECT body FROM streamweaver_command_state WHERE state_key=?").get(key) as { body: string } | undefined; return row ? JSON.parse(row.body) as Record<string, unknown> : undefined; }
  private write(key: string, value: unknown) { this.db.prepare("INSERT INTO streamweaver_command_state(state_key,body,updated_at) VALUES(?,?,?) ON CONFLICT(state_key) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at").run(key, JSON.stringify(value), new Date().toISOString()); }
}

export const STREAMWEAVER_ECONOMY_COMMANDS = [
  "points", "pleader", "givepoints", "stealpoints", "gamble", "gambel", "roll",
  "addpoints", "setpoints", "addtoall", "settoall", "resetallpoints",
] as const;

const USER_COOLDOWN_MS: Partial<Record<(typeof STREAMWEAVER_ECONOMY_COMMANDS)[number], number>> = {
  gamble: 10_000,
  gambel: 10_000,
  roll: 2_000,
};
const GLOBAL_COOLDOWN_MS: Partial<Record<(typeof STREAMWEAVER_ECONOMY_COMMANDS)[number], number>> = { pleader: 15_000 };

export class StreamWeaverEconomyCommandConsumer {
  readonly id = "streamweaver.economy" as const;
  constructor(
    private readonly economy: StreamWeaverEconomy,
    private readonly admin: StreamWeaverAdminEconomy,
    private readonly identities: StreamWeaverCommandIdentityResolverV1,
    private readonly state: StreamWeaverCommandStateV1,
    private readonly egress: StreamWeaverCommandEgressV1,
    private readonly nowMs: () => number = Date.now,
  ) {}

  accepts(message: NormalizedChatMessageV1) { return !message.actor.isBot && /^![a-z]/i.test(message.text.trim()); }

  async deliver(delivery: NormalizedChatDeliveryV1) {
    const existing = this.state.getReceipt(delivery.message.tenantId, delivery.deliveryId);
    if (existing) return this.send(delivery, existing.text);
    const planned = await this.route(delivery);
    if (!planned) return;
    const receipt: StreamWeaverCommandReceiptV1 = { tenantId: delivery.message.tenantId, deliveryId: delivery.deliveryId, command: planned.command, text: planned.text, createdAt: new Date(this.nowMs()).toISOString() };
    this.state.putReceipt(receipt);
    await this.send(delivery, planned.text);
  }

  async route(delivery: NormalizedChatDeliveryV1): Promise<{ command: string; text: string } | undefined> {
    const message = delivery.message;
    const parsed = parseCommand(message.text);
    if (!parsed || !STREAMWEAVER_ECONOMY_COMMANDS.includes(parsed.command as (typeof STREAMWEAVER_ECONOMY_COMMANDS)[number])) return undefined;
    const command = parsed.command as (typeof STREAMWEAVER_ECONOMY_COMMANDS)[number];
    const actorId = message.actor.canonicalUserId ?? await this.identities.resolve({ tenantId: message.tenantId, provider: message.provider, providerUserId: message.actor.providerUserId, username: message.actor.username, ...(message.actor.displayName ? { displayName: message.actor.displayName } : {}) });
    const actorName = message.actor.displayName ?? message.actor.username;
    if (!actorId) return { command, text: `@${actorName}, link your SpaceMountain identity before using points commands.` };

    const cooldown = this.cooldown(command, message.tenantId, actorId);
    if (cooldown > 0) return { command, text: `@${actorName}, wait ${cooldown}s before using !${command} again.` };

    try {
      let text: string;
      switch (command) {
        case "points": {
          const wallet = await this.economy.points(actorId);
          text = `@${actorName} has ${formatCompactPointAmount(wallet.spendableXp)} points!`;
          break;
        }
        case "pleader": {
          const entries = await this.economy.leaderboard(10);
          text = entries.length
            ? `🏆 Points: ${entries.map((entry) => `${entry.rank}. ${entry.userId} — ${formatCompactPointAmount(entry.spendableXp)}`).join(" | ")}`
            : "🏆 Points leaderboard is empty.";
          break;
        }
        case "givepoints": {
          const target = await this.target(message);
          const amount = integerToken(parsed.args[1]);
          if (!target || amount === undefined) return { command, text: `@${actorName}, usage: !givepoints @user amount` };
          const result = await this.economy.givePoints({ fromUserId: actorId, toUserId: target.userId, fromDisplayName: actorName, toDisplayName: target.displayName, amount, operationId: delivery.deliveryId });
          text = String(result.message ?? "Points transfer completed.");
          break;
        }
        case "stealpoints": {
          const target = await this.target(message);
          const amount = strictPositiveIntegerToken(parsed.args[1]);
          if (!target || amount === undefined) return { command, text: `@${actorName}, usage: !stealpoints @user amount` };
          const result = await this.economy.stealPoints({ fromUserId: actorId, toUserId: target.userId, fromDisplayName: actorName, toDisplayName: target.displayName, amount, operationId: delivery.deliveryId });
          text = String(result.message ?? "Heist completed.");
          break;
        }
        case "gamble":
        case "gambel": {
          const result = await this.economy.gamble({ userId: actorId, displayName: actorName, ...(parsed.args[0] ? { bet: parsed.args[0] } : {}), operationId: delivery.deliveryId });
          text = "message" in result && typeof result.message === "string" ? result.message : "Gamble settled.";
          break;
        }
        case "roll": {
          if (!parsed.args[0]) return { command, text: `@${actorName}, usage: !roll amount` };
          const wallet = await this.economy.points(actorId);
          const bet = resolveRollBet(parsed.args[0], wallet.spendableXp);
          const result = await this.economy.roll({ userId: actorId, displayName: actorName, bet, operationId: delivery.deliveryId });
          if ("die" in result && typeof result.die === "number" && "outcome" in result && typeof result.outcome === "string" && "change" in result && typeof result.change === "number" && "newTotal" in result && typeof result.newTotal === "number") {
            text = `🎲 @${actorName} rolled ${result.die}: ${result.outcome} (${result.change >= 0 ? "+" : ""}${formatCompactPointAmount(result.change)}). New total: ${formatCompactPointAmount(result.newTotal)}.`;
          } else {
            text = `🎲 @${actorName}, roll settlement already recorded.`;
          }
          break;
        }
        case "addpoints": {
          if (!isModerator(message)) return { command, text: `@${actorName}, only mods can use that!` };
          const target = await this.target(message); const amount = integerToken(parsed.args[1]);
          if (!target || amount === undefined) return { command, text: `@${actorName}, usage: !addPoints @user amount` };
          const wallet = await this.admin.addPoints(target.userId, amount, delivery.deliveryId, { moderatorUserId: actorId });
          text = `@${target.displayName} now has ${formatCompactPointAmount(wallet.spendableXp)} pts (${amount > 0 ? "+" : ""}${formatCompactPointAmount(amount)})`;
          break;
        }
        case "setpoints": {
          if (!isModerator(message)) return { command, text: `@${actorName}, only mods can use that!` };
          const target = await this.target(message); const amount = integerToken(parsed.args[1]);
          if (!target || amount === undefined) return { command, text: `@${actorName}, usage: !setPoints @user amount` };
          const wallet = await this.admin.setPoints(target.userId, amount, delivery.deliveryId, { moderatorUserId: actorId });
          text = `@${target.displayName} points set to ${formatCompactPointAmount(wallet.spendableXp)}`;
          break;
        }
        case "addtoall": {
          if (!isModerator(message)) return { command, text: `@${actorName}, only mods can use that!` };
          const amount = integerToken(parsed.args[0]);
          if (amount === undefined) return { command, text: `@${actorName}, usage: !addToAll amount` };
          const count = await this.admin.addToAll(amount, delivery.deliveryId, { moderatorUserId: actorId });
          text = `${amount > 0 ? "+" : ""}${formatCompactPointAmount(amount)} pts to ${count} users!`;
          break;
        }
        case "settoall": {
          if (!isModerator(message)) return { command, text: `@${actorName}, only mods can use that!` };
          const amount = integerToken(parsed.args[0]);
          if (amount === undefined) return { command, text: `@${actorName}, usage: !setToAll amount` };
          const count = await this.admin.setToAll(amount, delivery.deliveryId, { moderatorUserId: actorId });
          text = `Set ${count} users to ${formatCompactPointAmount(Math.max(0, amount))} pts`;
          break;
        }
        case "resetallpoints": {
          if (!isModerator(message)) return { command, text: `@${actorName}, only mods can use that!` };
          const count = await this.admin.resetAll(delivery.deliveryId, { moderatorUserId: actorId });
          text = `Reset points for ${count} users to 0`;
          break;
        }
      }
      this.markCooldown(command, message.tenantId, actorId);
      return { command, text };
    } catch (error) {
      return { command, text: `@${actorName}, ${error instanceof Error ? error.message : "points command failed"}` };
    }
  }

  private async target(message: NormalizedChatMessageV1) {
    const mention = message.mentions[0];
    if (!mention) return undefined;
    const userId = mention.canonicalUserId ?? await this.identities.resolve({ tenantId: message.tenantId, provider: message.provider, providerUserId: mention.providerUserId, username: mention.username });
    return userId ? { userId, displayName: mention.username } : undefined;
  }

  private cooldown(command: (typeof STREAMWEAVER_ECONOMY_COMMANDS)[number], tenantId: string, userId: string) {
    const now = this.nowMs();
    const userMs = USER_COOLDOWN_MS[command] ?? 0;
    if (userMs) {
      const last = this.state.getCooldown(`user:${tenantId}:${userId}:${canonicalCooldownCommand(command)}`);
      if (now - last < userMs) return Math.ceil((userMs - (now - last)) / 1000);
    }
    const globalMs = GLOBAL_COOLDOWN_MS[command] ?? 0;
    if (globalMs) {
      const last = this.state.getCooldown(`global:${tenantId}:${command}`);
      if (now - last < globalMs) return Math.ceil((globalMs - (now - last)) / 1000);
    }
    return 0;
  }

  private markCooldown(command: (typeof STREAMWEAVER_ECONOMY_COMMANDS)[number], tenantId: string, userId: string) {
    const now = this.nowMs();
    if (USER_COOLDOWN_MS[command]) this.state.putCooldown(`user:${tenantId}:${userId}:${canonicalCooldownCommand(command)}`, now);
    if (GLOBAL_COOLDOWN_MS[command]) this.state.putCooldown(`global:${tenantId}:${command}`, now);
  }

  private send(delivery: NormalizedChatDeliveryV1, text: string) {
    return this.egress.send({ schemaVersion: 1, tenantId: delivery.message.tenantId, provider: delivery.message.provider, connectionId: delivery.message.connectionId, channelId: delivery.message.channelId, text, idempotencyKey: `streamweaver-command:${delivery.deliveryId}`, replyToMessageId: delivery.message.messageId });
  }
}

function parseCommand(text: string) {
  const parts = text.trim().split(/\s+/);
  const raw = parts.shift();
  if (!raw?.startsWith("!")) return undefined;
  return { command: raw.slice(1).toLowerCase(), args: parts };
}
function isModerator(message: NormalizedChatMessageV1) { return message.actor.roles.includes("moderator") || message.actor.roles.includes("broadcaster"); }
function integerToken(value: string | undefined) { if (value === undefined || !/^-?\d+$/.test(value)) return undefined; const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : undefined; }
function strictPositiveIntegerToken(value: string | undefined) { if (value === undefined || !/^\d+$/.test(value)) return undefined; const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined; }
function canonicalCooldownCommand(command: string) { return command === "gambel" ? "gamble" : command; }
function resolveRollBet(token: string, current: number) {
  const upper = token.toUpperCase();
  if (upper === "ALL") return current;
  if (upper === "HALF") return Math.floor(current / 2);
  if (upper === "QUARTER") return Math.floor(current / 4);
  if (upper === "THIRD") return Math.floor(current / 3);
  if (upper === "RANDOM") return current > 0 ? Math.floor(Math.random() * current) + 1 : 0;
  return parseStreamWeaverPointAmount(token);
}
