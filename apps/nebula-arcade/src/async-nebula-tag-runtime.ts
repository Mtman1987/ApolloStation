import { SpmtClient } from "@spmt/sdk";
import {
  DEFAULT_NEBULA_TAG_RULES,
  planNebulaTagMessage,
  planNebulaTagRotation,
  publishNebulaTagCommandResult,
  type NebulaTagCommandV1,
  type NebulaTagInboundMessageV1,
  type NebulaTagMessagePlanV1,
  type NebulaTagRotationPlanV1,
  type NebulaTagRulesV1,
} from "./nebula-tag.js";
import type {
  NebulaTagDeliveryReportV1,
  StoredNebulaTagCommandV1,
  StoredNebulaTagStateV1,
} from "./nebula-tag-runtime.js";
import type { AsyncNebulaTagRecordStore } from "./async-tag-record-store.js";

/**
 * Async counterpart to NebulaTagRuntime. Every state read and outbox mutation
 * is awaited, so callers cannot accidentally treat remote Turso I/O as sync.
 */
export class AsyncNebulaTagRuntime {
  constructor(
    private readonly store: AsyncNebulaTagRecordStore,
    private readonly spmt: SpmtClient,
    private readonly rules: NebulaTagRulesV1 = DEFAULT_NEBULA_TAG_RULES,
  ) {}

  getState(tenantId: string): Promise<StoredNebulaTagStateV1> {
    return this.store.getState(tenantId);
  }

  async execute(command: NebulaTagCommandV1): Promise<StoredNebulaTagCommandV1 & { delivery: NebulaTagDeliveryReportV1 }> {
    const applied = await this.store.applyCommand(command, this.rules);
    const delivery = await this.flushPending(command.tenantId);
    return { ...applied, delivery };
  }

  async ingest(message: NebulaTagInboundMessageV1): Promise<NebulaTagMessagePlanV1 | (StoredNebulaTagCommandV1 & { kind: "result"; delivery: NebulaTagDeliveryReportV1 })> {
    const current = await this.store.getState(message.tenantId);
    const plan = planNebulaTagMessage(current.state, message);
    if (plan.kind === "ignored") {
      if (!current.state.players[message.userId]) return plan;
      const applied = await this.execute({
        schemaVersion: 1,
        tenantId: message.tenantId,
        commandId: `${message.provider}:${message.messageId}:activity`,
        actorUserId: message.userId,
        occurredAt: message.occurredAt,
        channelId: message.channelId,
        ...(message.avatarUrl ? { avatarUrl: message.avatarUrl } : {}),
        kind: "record-activity",
      });
      return { kind: "result", ...applied };
    }
    if (plan.kind !== "command") return plan;
    const applied = await this.execute(plan.command);
    return { kind: "result", ...applied };
  }

  async reconcileRotation(input: {
    tenantId: string;
    channelId: string;
    now: string;
    liveUserIds?: string[];
    random?: () => number;
  }): Promise<NebulaTagRotationPlanV1 | (StoredNebulaTagCommandV1 & {
    kind: "result";
    rotation: NebulaTagRotationPlanV1;
    delivery: NebulaTagDeliveryReportV1;
  })> {
    const [current, rules] = await Promise.all([
      this.store.getState(input.tenantId),
      this.store.rotationRules(input.tenantId),
    ]);
    const rotation = planNebulaTagRotation(current.state, { ...input, rules });
    if (!rotation.command) return rotation;
    const applied = await this.execute(rotation.command);
    return { kind: "result", rotation, ...applied };
  }

  async flushPending(tenantId: string, limit = 100): Promise<NebulaTagDeliveryReportV1> {
    const pending = await this.store.listPendingDeliveries(tenantId, limit);
    const report: NebulaTagDeliveryReportV1 = { attempted: pending.length, delivered: 0, failed: 0 };
    for (const item of pending) {
      try {
        await publishNebulaTagCommandResult(this.spmt, item.result);
        await this.store.markDeliveryComplete(item.id);
        report.delivered += 1;
      } catch (error) {
        await this.store.markDeliveryFailed(item.id, error instanceof Error ? error.message : String(error));
        report.failed += 1;
      }
    }
    return report;
  }
}
