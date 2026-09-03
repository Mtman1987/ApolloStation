export type DshNukeModeV1 = "bot" | "all" | "until";
export type DshModeratorRoleV1 = "guest" | "member" | "moderator" | "admin" | "owner";

export interface DshDiscordHistoryMessageV1 {
  id: string;
  authorId?: string;
  authorIsBot?: boolean;
}

export interface DshDiscordChannelV1 {
  id: string;
  guildId: string;
  name?: string;
}

export interface DshDiscordModerationPortV1 {
  channel(tenantId: string, channelId: string): Promise<DshDiscordChannelV1>;
  botIdentity(tenantId: string): Promise<{ id: string }>;
  message(tenantId: string, channelId: string, messageId: string): Promise<DshDiscordHistoryMessageV1 | undefined>;
  messages(tenantId: string, channelId: string, input: { limit: 100; before?: string }): Promise<DshDiscordHistoryMessageV1[]>;
  bulkDelete(tenantId: string, channelId: string, messageIds: string[]): Promise<void>;
  deleteMessage(tenantId: string, channelId: string, messageId: string): Promise<void>;
}

export interface DshNukeRequestV1 {
  schemaVersion: 1;
  tenantId: string;
  guildId: string;
  channelId: string;
  mode: DshNukeModeV1;
  actorRole: DshModeratorRoleV1;
  untilMessageId?: string;
}

export interface DshNukeResultV1 {
  schemaVersion: 1;
  success: boolean;
  deleted: number;
  failed: number;
  pages: number;
  reachedTarget: boolean;
  log: string[];
}

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const BULK_DELETE_MAX_AGE_MS = 13.8 * 24 * 60 * 60 * 1_000;

/**
 * App-owned moderation service. The port is backed by short-lived SPMT Discord
 * grants in production, so no Discord token is stored in DSH.
 */
export class DshChannelModerationService {
  constructor(
    private readonly discord: DshDiscordModerationPortV1,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async nuke(input: DshNukeRequestV1): Promise<DshNukeResultV1> {
    const request = validateRequest(input);
    if (request.actorRole !== "admin" && request.actorRole !== "owner") {
      throw new Error("DSH admin or owner role is required for channel deletion");
    }

    const channel = await this.discord.channel(request.tenantId, request.channelId);
    if (channel.guildId !== request.guildId) throw new Error("The Discord channel is outside the configured tenant guild");
    if (request.mode === "until" && !await this.discord.message(request.tenantId, request.channelId, request.untilMessageId!)) {
      throw new Error("The stop message was not found in this Discord channel");
    }

    const botId = (await this.discord.botIdentity(request.tenantId)).id;
    if (!snowflake(botId)) throw new Error("Discord bot identity is invalid");
    let before: string | undefined;
    let deleted = 0;
    let failed = 0;
    let pages = 0;
    let reachedTarget = request.mode !== "until";
    const log = [`Cleaning #${channel.name || channel.id} in ${request.mode} mode.`];

    while (pages < 10_000) {
      const messages = await this.discord.messages(request.tenantId, request.channelId, { limit: 100, ...(before ? { before } : {}) });
      if (!messages.length) break;
      pages += 1;
      before = messages.at(-1)!.id;

      let candidates = messages;
      if (request.mode === "until") {
        const stop = messages.findIndex((message) => message.id === request.untilMessageId);
        if (stop >= 0) {
          candidates = messages.slice(0, stop);
          reachedTarget = true;
        }
      }
      if (request.mode === "bot") candidates = candidates.filter((message) => message.authorId === botId);

      const result = await this.deleteSelected(request.tenantId, request.channelId, candidates.map((message) => message.id));
      deleted += result.deleted;
      failed += result.failed;
      log.push(`Page ${pages}: deleted ${result.deleted}${result.failed ? `, failed ${result.failed}` : ""}.`, ...result.log.slice(0, 8));
      if (request.mode === "until" && reachedTarget) break;
      if (messages.length < 100) break;
    }

    if (request.mode === "until" && !reachedTarget) log.push("The validated stop message was not encountered during pagination.");
    log.push(`Finished: ${deleted} deleted${failed ? `, ${failed} failed` : ""}.`);
    return { schemaVersion: 1, success: failed === 0, deleted, failed, pages, reachedTarget, log };
  }

  private async deleteSelected(tenantId: string, channelId: string, ids: string[]) {
    const recent = ids.filter((id) => bulkEligible(id, this.now()));
    const old = ids.filter((id) => !bulkEligible(id, this.now()));
    let deleted = 0;
    let failed = 0;
    const log: string[] = [];

    for (let offset = 0; offset < recent.length; offset += 100) {
      const chunk = recent.slice(offset, offset + 100);
      if (chunk.length > 1) {
        try {
          await this.discord.bulkDelete(tenantId, channelId, chunk);
          deleted += chunk.length;
          continue;
        } catch (error) {
          log.push(`Bulk delete failed; retrying individually. ${safeError(error)}`);
        }
      }
      for (const id of chunk) {
        try { await this.discord.deleteMessage(tenantId, channelId, id); deleted += 1; }
        catch (error) { failed += 1; log.push(safeError(error)); }
      }
    }
    for (const id of old) {
      try { await this.discord.deleteMessage(tenantId, channelId, id); deleted += 1; }
      catch (error) { failed += 1; log.push(safeError(error)); }
    }
    return { deleted, failed, log };
  }
}

export function dshDiscordSnowflakeTimestamp(id: string): number {
  if (!snowflake(id)) return 0;
  try { return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS); }
  catch { return 0; }
}

export function bulkEligible(id: string, now = Date.now()): boolean {
  const createdAt = dshDiscordSnowflakeTimestamp(id);
  return createdAt > 0 && now - createdAt < BULK_DELETE_MAX_AGE_MS;
}

function validateRequest(input: DshNukeRequestV1): DshNukeRequestV1 {
  if (input.schemaVersion !== 1) throw new Error("DSH nuke schemaVersion is invalid");
  if (!snowflake(input.guildId) || !snowflake(input.channelId)) throw new Error("A valid Discord guild and channel are required");
  if (!(["bot", "all", "until"] as string[]).includes(input.mode)) throw new Error("DSH nuke mode is invalid");
  if (input.mode === "until" && !snowflake(input.untilMessageId)) throw new Error("A valid stop message is required for until mode");
  return { ...input, tenantId: clean(input.tenantId), guildId: input.guildId.trim(), channelId: input.channelId.trim(), ...(input.untilMessageId ? { untilMessageId: input.untilMessageId.trim() } : {}) };
}
function snowflake(value: unknown): value is string { return typeof value === "string" && /^\d{16,22}$/.test(value.trim()); }
function clean(value: string) { const result = String(value ?? "").trim(); if (!result || result.length > 200 || /[\r\n\0]/.test(result)) throw new Error("DSH tenant identity is invalid"); return result; }
function safeError(value: unknown) { return (value instanceof Error ? value.message : String(value)).replace(/(?:token|secret|authorization|password)\s*[:=]?\s*\S+/gi, "$1=[redacted]").slice(0, 240); }
