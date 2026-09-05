import { createHash } from "node:crypto";
import type { SpmtClient } from "@spmt/sdk";
import type { DshDiscordTransportV1 } from "./discord-live-publisher.js";

type SimulationClient = Pick<SpmtClient, "publishSimulationRoomEvent">;

/** Discord-compatible transport that keeps provider reads live and replaces every write with a tenant Simulation Room event. */
export class DshSimulationRoomDiscordTransport implements DshDiscordTransportV1 {
  private readonly channelGuilds = new Map<string, string>();
  constructor(
    private readonly reads: Pick<DshDiscordTransportV1, "listGuilds" | "listGuildChannels">,
    private readonly client: SimulationClient,
    private readonly options: { guildIds?: (tenantId: string) => readonly string[]; now?: () => string } = {},
  ) {}

  listGuilds(tenantId: string) { return this.reads.listGuilds(tenantId); }
  async listGuildChannels(tenantId: string, guildId: string) {
    const channels = await this.reads.listGuildChannels(tenantId, guildId);
    for (const channel of channels) if (channel.id) this.channelGuilds.set(`${tenantId}\0${channel.id}`, guildId);
    return channels;
  }

  async createMessage(tenantId: string, channelId: string, payload: Record<string, unknown>) {
    return this.publish(tenantId, channelId, "create", payload);
  }
  async editMessage(tenantId: string, channelId: string, messageId: string, payload: Record<string, unknown>) {
    return this.publish(tenantId, channelId, "edit", payload, messageId);
  }
  async deleteMessage(tenantId: string, channelId: string, messageId: string) {
    await this.publish(tenantId, channelId, "delete", {}, messageId);
  }
  async sendDirectMessage(tenantId: string, userId: string, payload: Record<string, unknown>) {
    const nonce = key(`${tenantId}:dm:${userId}:${JSON.stringify(payload)}`), messageId = shadowSnowflake(nonce), occurredAt = this.now();
    await this.client.publishSimulationRoomEvent(tenantId, {
      roomId: `discord:dm:${userId}`,
      lane: "chat",
      direction: "egress",
      title: "Discord direct-message shadow output",
      body: messageBody("direct message", payload),
      provider: "discord",
      connectionId: "discord-direct-message",
      channelId: userId,
      data: previewData("direct-message", undefined, payload, messageId),
      occurredAt,
    }, `dsh-shadow-dm:${nonce}`);
    return messageId;
  }

  private async publish(tenantId: string, channelId: string, operation: "create" | "edit" | "delete", payload: Record<string, unknown>, priorMessageId?: string) {
    const guildId = this.channelGuilds.get(`${tenantId}\0${channelId}`) ?? this.options.guildIds?.(tenantId)?.[0] ?? "discord-server";
    const nonce = key(`${tenantId}:${guildId}:${channelId}:${operation}:${priorMessageId ?? "new"}:${JSON.stringify(payload)}`), messageId = priorMessageId ?? shadowSnowflake(nonce), occurredAt = this.now();
    await this.client.publishSimulationRoomEvent(tenantId, {
      roomId: `discord:${guildId}:${channelId}`,
      lane: "chat",
      direction: "egress",
      title: `Discord ${operation} shadow output`,
      body: operation === "delete" ? `Would delete Discord message ${messageId}.` : messageBody(`${operation} message`, payload),
      provider: "discord",
      connectionId: `guild:${guildId}`,
      channelId,
      ...(operation === "edit" || operation === "delete" ? { replyToMessageId: messageId } : {}),
      data: previewData(operation, guildId, payload, messageId),
      occurredAt,
    }, `dsh-shadow:${nonce}`);
    return messageId;
  }

  private now() { return (this.options.now ?? (() => new Date().toISOString()))(); }
}

function previewData(operation: string, guildId: string | undefined, payload: Record<string, unknown>, messageId: string) {
  const serialized = JSON.stringify(payload);
  return { operation, ...(guildId ? { guildId } : {}), messageId, payload: serialized.length <= 24_000 ? payload : { truncated: true, byteLength: Buffer.byteLength(serialized) } };
}
function messageBody(label: string, payload: Record<string, unknown>) {
  const embed = Array.isArray(payload.embeds) && payload.embeds[0] && typeof payload.embeds[0] === "object" ? payload.embeds[0] as Record<string, unknown> : undefined;
  const content = typeof payload.content === "string" ? payload.content : "";
  return [label, content, embed?.title, embed?.description].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(" · ").slice(0, 8_000) || `${label} preview`;
}
function key(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 32); }
function shadowSnowflake(value: string) { return (BigInt(`0x${value.slice(0, 15)}`).toString().padStart(18, "0").slice(0, 18)); }
