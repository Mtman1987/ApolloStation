import { DatabaseSync } from "node:sqlite";
import { routeSpmtSuiteAction, type ExecutionJobV1, type OutboundChatMessageV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import type { StreamWeaverBotActionContextV1, StreamWeaverBotActionRequestV1 } from "./bot-action-runtime.js";

interface Receipt {
  action: StreamWeaverBotActionRequestV1["action"];
  context: StreamWeaverBotActionContextV1;
  message: OutboundChatMessageV1;
  jobId?: string;
  completionReply?: boolean;
}

/** Persists the first reply and delayed completion separately; neither retry invokes or bills a job. */
export class StreamWeaverBotActionReplies {
  private readonly db: DatabaseSync;
  private running = false;
  constructor(databasePath: string, private readonly now: () => number = Date.now) {
    this.db = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS streamweaver_bot_action_replies (
        tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, body TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL,
        next_attempt INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, request_id)
      ) STRICT;`);
  }
  close() { this.db.close(); }
  get(context: StreamWeaverBotActionContextV1): Receipt | undefined {
    const row = this.db.prepare("SELECT body FROM streamweaver_bot_action_replies WHERE tenant_id=? AND request_id=?").get(context.tenantId, context.requestId);
    if (!row) return undefined;
    const receipt = JSON.parse(String(row.body)) as Receipt;
    if (JSON.stringify(receipt.context) !== JSON.stringify(context)) throw new Error("Chat action receipt identity mismatch");
    return receipt;
  }
  remember(receipt: Receipt) {
    this.db.prepare("INSERT OR IGNORE INTO streamweaver_bot_action_replies(tenant_id,request_id,body,done) VALUES(?,?,?,?)")
      .run(receipt.context.tenantId, receipt.context.requestId, JSON.stringify(receipt), receipt.jobId ? 0 : 1);
    return this.get(receipt.context)!;
  }
  acknowledge(context: StreamWeaverBotActionContextV1) {
    this.db.prepare("UPDATE streamweaver_bot_action_replies SET acknowledged=1 WHERE tenant_id=? AND request_id=?").run(context.tenantId, context.requestId);
  }
  async flush(client: Pick<SpmtClient, "getExecutionJob">, send: (message: OutboundChatMessageV1) => Promise<unknown>, allowed: (message: OutboundChatMessageV1) => boolean, limit = 100, publish?: SpmtClient["publishEvent"]) {
    if (this.running) return 0;
    this.running = true;
    let delivered = 0;
    try {
      const rows = this.db.prepare("SELECT body FROM streamweaver_bot_action_replies WHERE acknowledged=1 AND done=0 AND next_attempt<=? ORDER BY next_attempt,rowid LIMIT ?").all(this.now(), Math.max(1, Math.min(1000, limit)));
      for (const row of rows) {
        const receipt = JSON.parse(String(row.body)) as Receipt, { context, message } = receipt;
        this.db.prepare("UPDATE streamweaver_bot_action_replies SET next_attempt=? WHERE tenant_id=? AND request_id=?").run(this.now() + 5000, context.tenantId, context.requestId);
        if (!allowed(message) || context.simulation) continue;
        try {
          const job = await client.getExecutionJob(context.tenantId, receipt.jobId!);
          if (!matches(job, receipt)) {
            this.finish(context); // Never expose another actor's or private job's output.
            continue;
          }
          if (!["succeeded", "failed", "dead-letter", "cancelled"].includes(job.state)) continue;
          const text = job.state === "succeeded"
            ? (typeof job.result?.text === "string" ? job.result.text.trim().slice(0, 8000) : "") || `${receipt.action} completed.`
            : `${receipt.action} did not complete. Check activity for details.`;
          if (receipt.completionReply !== false) await send({ ...message, text, idempotencyKey: `${message.idempotencyKey}:completed` });
          if (publish && receipt.action === "sw.image.generate" && job.state === "succeeded") {
            const images = (Array.isArray(job.result?.resourceUrls) ? job.result.resourceUrls : []).slice(0, 4).flatMap(value => {
              if (typeof value !== "string" || value.length > 4000) return [];
              try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? [url.href] : []; } catch { return []; }
            });
            if (images.length) await publish(context.tenantId, "streamweaver.image.generated.v1", { visibility: "public", images, actor: context.actor.username }, `${message.idempotencyKey}:image-overlay`);
          }
          this.finish(context);
          delivered++;
        } catch { /* Keep the receipt for provider/API recovery with the same egress key. */ }
      }
      return delivered;
    } finally { this.running = false; }
  }
  private finish(context: StreamWeaverBotActionContextV1) {
    this.db.prepare("UPDATE streamweaver_bot_action_replies SET done=1 WHERE tenant_id=? AND request_id=?").run(context.tenantId, context.requestId);
  }
}

function matches(job: ExecutionJobV1, receipt: Receipt): boolean {
  const { context, action } = receipt, route = routeSpmtSuiteAction(action);
  const source = job.input.source as Record<string, unknown> | undefined, actor = job.input.actor as Record<string, unknown> | undefined;
  return job.id === receipt.jobId && job.tenantId === context.tenantId && job.ownerAppId === "streamweaver"
    && job.executionOwner === route.executionOwner && job.capabilityId === route.capabilityId
    && job.billedUserId === context.actor.userId && actor?.userId === context.actor.userId
    && job.input.action === action && source?.kind === "chat" && source.requestId === context.requestId
    && source.provider === context.source && source.channelId === context.channelId
    && source.connectionId === context.connectionId && source.simulation !== true
    && (action !== "sw.image.generate" || job.input.mediaVisibility === "public");
}
