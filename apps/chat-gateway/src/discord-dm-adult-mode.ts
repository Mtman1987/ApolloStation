import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { SpmtClient } from "@spmt/sdk";
import { resolveProviderIdentity } from "@spmt/sdk/provider-identity";
import type { ChatGatewayRuntime, ProviderChatEnvelopeV1 } from "./index.js";

type DmMessage = ProviderChatEnvelopeV1;
type IdentityResolver = typeof resolveProviderIdentity;
type AssistantClient = Pick<SpmtClient, "invokeCommunityAssistant" | "getExecutionJob">;

export class DiscordDmAdultModeStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS discord_dm_preferences(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,adult_mode INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,user_id)) STRICT");
  }
  adultMode(tenantId: string, userId: string): boolean {
    const row = this.db.prepare("SELECT adult_mode AS value FROM discord_dm_preferences WHERE tenant_id=? AND user_id=?").get(tenantId,userId) as {value?:number}|undefined;
    return row?.value === 1;
  }
  setAdultMode(tenantId: string, userId: string, enabled: boolean): void {
    this.db.prepare("INSERT INTO discord_dm_preferences(tenant_id,user_id,adult_mode,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET adult_mode=excluded.adult_mode,updated_at=excluded.updated_at").run(tenantId,userId,enabled?1:0,new Date().toISOString());
  }
  close(): void { this.db.close(); }
}

/** Routes only owner-linked Discord DMs through Apollo's hosted Stellar assistant API. */
export class DiscordDmAdultModeAssistant {
  private readonly settings: DiscordDmAdultModeStore;
  constructor(private readonly options: {
    client: AssistantClient;
    gateway: Pick<ChatGatewayRuntime, "send">;
    databasePath: string;
    resolveIdentity?: IdentityResolver;
    waitMs?: number;
    pollMs?: number;
  }) {
    this.settings = new DiscordDmAdultModeStore(options.databasePath);
  }
  close(): void { this.settings.close(); }

  async handle(message: DmMessage): Promise<void> {
    if (message.provider !== "discord" || message.guildId || message.isBot || !message.text.trim()) return;
    let identity;
    try {
      identity = await (this.options.resolveIdentity ?? resolveProviderIdentity)(this.options.client as SpmtClient,message.tenantId,"discord",message.providerUserId);
    } catch {
      return; // Unlinked DMs are ignored; no passive identity is created.
    }
    if (identity.tenantRole !== "owner") return;

    const action = adultModeCommand(message.text);
    const enabled = this.settings.adultMode(message.tenantId,identity.userId);
    if (action) {
      const next = action === "status" ? enabled : action === "on" ? true : action === "off" ? false : !enabled;
      if (action !== "status") this.settings.setAdultMode(message.tenantId,identity.userId,next);
      await this.reply(message, action === "status"
        ? `Adult Mode is ${enabled ? "ON" : "OFF"}.`
        : `Adult Mode is now ${next ? "ON" : "OFF"}.`);
      return;
    }

    const presentation = {
      personaId: "discord-private-assistant",
      displayName: "Athena",
      instructions: [
        "You are the owner's private Discord DM assistant.",
        "Answer the latest message directly and naturally. Do not mention internal model names, Qwen, local inference, or provider routing.",
        enabled
          ? "Adult Mode is enabled: use a candid, mature conversational tone where appropriate, while following applicable safety rules."
          : "Adult Mode is disabled: keep the conversation within the standard assistant tone and boundaries.",
      ].join("\n"),
      memoryPolicy: "conversation" as const,
    };
    const requestKey = `discord-dm:${createHash("sha256").update(message.tenantId + ":" + identity.userId + ":" + message.messageId).digest("hex").slice(0,32)}`;
    const accepted = await this.options.client.invokeCommunityAssistant(message.tenantId, {
      userId: identity.userId,
      message: `Private Discord message from ${message.displayName || message.username}:\n${message.text}`,
      surface: "app",
      conversationId: `discord-private:${identity.userId}`,
      routingPreference: "automatic",
      remember: true,
      presentation,
    },requestKey);
    if (accepted.status !== "accepted") return;

    const deadline = Date.now() + (this.options.waitMs ?? 90_000);
    while (Date.now() < deadline) {
      const job = await this.options.client.getExecutionJob(message.tenantId,accepted.jobId);
      if (job.billedUserId !== identity.userId) throw new Error("Discord DM assistant job ownership mismatch");
      if (job.state === "succeeded") {
        const answer = String(job.result?.text ?? "").trim();
        if (answer) await this.reply(message,answer.slice(0,1900));
        return;
      }
      if (["failed","cancelled","dead-letter"].includes(job.state)) return;
      await new Promise(resolve => setTimeout(resolve,this.options.pollMs ?? 1_000));
    }
  }

  private async reply(message: DmMessage,text: string): Promise<void> {
    await this.options.gateway.send({
      schemaVersion: 1,
      tenantId: message.tenantId,
      provider: "discord",
      connectionId: message.connectionId,
      channelId: message.channelId,
      text: text.slice(0,1900),
      idempotencyKey: `dm-${createHash("sha256").update(message.tenantId + ":" + message.messageId + ":" + text).digest("hex").slice(0,24)}`,
      replyToMessageId: message.messageId,
    });
  }
}

type AdultModeAction = "on" | "off" | "toggle" | "status";
function adultModeCommand(input: string): AdultModeAction | undefined {
  const value = input.trim().toLowerCase().replace(/[’]/g,"'").replace(/\s+/g," ")
    .replace(/^@?spmt(?:\s+|\s*[:,.-]\s*)/,"").replace(/^!+/,"").trim();
  const match = /^(?:adult|adult mode|mature|mature mode)(?:\s+(on|off|toggle|status))?[.!?]*$/.exec(value);
  return match ? (match[1] as AdultModeAction | undefined) ?? "toggle" : undefined;
}
