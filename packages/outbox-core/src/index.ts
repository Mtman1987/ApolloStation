import { AuthorityService, type OutboxRecordV1 } from "@spmt/authority-core";

export interface OutboxDeliveryResultV1 { delivered: number; retried: number; dead: number; }
export interface OutboxDispatcherOptions {
  authority: AuthorityService;
  deliver: (record: OutboxRecordV1) => Promise<void>;
  workerId: string;
  leaseSeconds?: number;
  retrySeconds?: number;
  maxAttempts?: number;
  batchSize?: number;
}

export class OutboxDispatcher {
  private readonly authority: AuthorityService;
  private readonly deliver: (record: OutboxRecordV1) => Promise<void>;
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly retrySeconds: number;
  private readonly maxAttempts: number;
  private readonly batchSize: number;

  constructor(options: OutboxDispatcherOptions) {
    this.authority = options.authority;
    this.deliver = options.deliver;
    this.workerId = options.workerId;
    this.leaseSeconds = options.leaseSeconds ?? 30;
    this.retrySeconds = options.retrySeconds ?? 15;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.batchSize = options.batchSize ?? 50;
  }

  async runOnce(): Promise<OutboxDeliveryResultV1> {
    const claimed = this.authority.claimOutbox(this.workerId, this.leaseSeconds, this.batchSize);
    let delivered = 0;
    let retried = 0;
    let dead = 0;
    for (const record of claimed) {
      try {
        await this.deliver(record);
        this.authority.completeOutbox(record.id, this.workerId);
        delivered += 1;
      } catch (error) {
        const failed = this.authority.failOutbox(record.id, this.workerId, error instanceof Error ? error.message : "delivery failed", this.retrySeconds, this.maxAttempts);
        if (failed.state === "dead") dead += 1;
        else retried += 1;
      }
    }
    return { delivered, retried, dead };
  }
}
