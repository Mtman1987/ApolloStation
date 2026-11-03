import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { SpmtClient } from "@spmt/sdk";
import { mtFixItCoderPrompt, mtFixItIncidentFromOperationsLog } from "@spmt/platform-ops";
import type { DshDiscordTransportV1 } from "./discord-live-publisher.js";
import type { DshMessageObservation } from "./member-activity.js";

/** DSH compatibility intake. Coder owns diagnosis; this adapter never approves or deploys. */
export class DshMtFixItIntake {
  private readonly db: DatabaseSync;
  constructor(
    private readonly client: SpmtClient,
    private readonly discord: DshDiscordTransportV1,
    databasePath: string,
    private readonly ownerDiscordUserId = String(process.env.DSH_MTFIXIT_OWNER_DISCORD_ID ?? "").trim(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.db = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS dsh_mtfixit_reports(
        tenant TEXT NOT NULL,event_id TEXT NOT NULL,job_id TEXT NOT NULL,channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,reporter TEXT NOT NULL,description TEXT NOT NULL,
        owner_notified INTEGER NOT NULL DEFAULT 0,reply_sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,PRIMARY KEY(tenant,event_id)
      ) STRICT;`);
  }
  close() { this.db.close(); }

  async handle(tenantId: string, eventId: string, message: DshMessageObservation): Promise<{ handled: boolean; jobId?: string }> {
    const raw = String(message.text ?? "").trim();
    const match = raw.match(/^!mtfixit(?:\s+([\s\S]+))?$/i);
    if (!match) return { handled: false };
    const description = redactReport(String(match[1] ?? "").trim());
    if (description.length < 8) {
      await this.reply(tenantId, message, "Usage: !mtfixit describe the problem in a few words.");
      return { handled: true };
    }
    if (description.length > 2_000) throw new Error("MtFixIt reports must be 2,000 characters or fewer.");
    const key = createHash("sha256").update(JSON.stringify([tenantId,eventId,message.messageId])).digest("hex");
    let saved = this.db.prepare("SELECT * FROM dsh_mtfixit_reports WHERE tenant=? AND event_id=?").get(tenantId,eventId) as any;
    if (!saved) {
      const published = await this.client.publishOperationsLog(tenantId, {
        level: "error", kind: "mtfixit.report", summary: description.slice(0,300),
        detail: description, labels: ["source:discord","workflow:mtfixit","intake:donor-compatibility"],
        occurredAt: message.occurredAt,
      }, `dsh-mtfixit-log:${key}`, eventId);
      const incident = mtFixItIncidentFromOperationsLog(published.log);
      const prompt = mtFixItCoderPrompt({ incident, attempt: 1, evidence: [
        `Reporter: ${message.actor.username} (${message.actor.providerUserId})`,
        `Discord guild: ${message.guildId ?? "unknown"}`,
        `Discord channel: ${message.channelId}`,
        `Discord message: ${message.messageId}`,
        `Reported problem: ${description}`,
      ] });
      const created = await this.client.createCoderJob(tenantId,"discord-stream-hub",prompt,[published.log.id],`dsh-mtfixit-job:${key}`);
      this.db.prepare("INSERT OR IGNORE INTO dsh_mtfixit_reports(tenant,event_id,job_id,channel_id,message_id,reporter,description,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(tenantId,eventId,created.job.id,message.channelId,message.messageId,message.actor.username,description,this.now());
      saved = this.db.prepare("SELECT * FROM dsh_mtfixit_reports WHERE tenant=? AND event_id=?").get(tenantId,eventId);
    }
    const jobId = String(saved.job_id);
    if (this.ownerDiscordUserId && Number(saved.owner_notified) === 0) {
      await this.discord.sendDirectMessage(tenantId,this.ownerDiscordUserId,{
        content: `**MtFixIt report received**\nReporter: ${saved.reporter}\nReport: ${saved.description}\nCoder job: ${jobId}\n\nReview the job in Mission Control. This intake does not approve or deploy changes.`,
        allowed_mentions: { parse: [] },
      });
      this.db.prepare("UPDATE dsh_mtfixit_reports SET owner_notified=1 WHERE tenant=? AND event_id=?").run(tenantId,eventId);
    }
    if (Number(saved.reply_sent) === 0) {
      const note = this.ownerDiscordUserId ? "The owner has been notified for review." : "Owner DM is not configured yet; the job is saved for Mission Control review.";
      await this.reply(tenantId,message,"@" + message.actor.username + ", your report is recorded as " + jobId + ". " + note);
      this.db.prepare("UPDATE dsh_mtfixit_reports SET reply_sent=1 WHERE tenant=? AND event_id=?").run(tenantId,eventId);
    }
    return { handled: true, jobId };
  }

  private async reply(tenantId: string, message: DshMessageObservation, content: string) {
    await this.discord.createMessage(tenantId,message.channelId,{
      content, message_reference: { message_id: message.messageId },
      allowed_mentions: { parse: [] },
    });
  }
}

function redactReport(value: string) {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi,"Bearer [REDACTED]")
    .replace(/\b(?:sk-|github_pat_)[A-Za-z0-9_-]{12,}\b/g,"[REDACTED]")
    .replace(/(["']?(?:access_token|refresh_token|client_secret|password|authorization|api[_-]?key|token|secret)["']?\s*[:=]\s*["']?)[^\s,"']+/gi,"$1[REDACTED]")
    .replace(/[\r\n\0]/g," ").trim();
}
