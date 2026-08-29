import type { NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import {
  SpmtStreamWeaverPersonaRuntime,
  SqliteStreamWeaverSummonStore,
  StreamWeaverChatGatewayConsumer,
  StreamWeaverPersonaReplyReconciler,
  type StreamWeaverChatEgressV1,
} from "./chat-gateway-consumer.js";
import { MultiTenantStreamWeaverEconomyCommandConsumer, SqliteStreamWeaverCommandState } from "./command-router.js";
import { DefaultStreamWeaverDonorCommandServices } from "./donor-command-services.js";
import { StreamWeaverDonorCommandConsumer } from "./donor-command-runtime.js";
import { SqliteStreamWeaverEconomyStore } from "./economy.js";
import { StreamWeaverPersonaSettingsStore } from "./persona-settings.js";
import { StreamWeaverSpmtIdentityResolver } from "./provider-identity-resolver.js";

export interface StreamWeaverProviderConsumerV1 {
  id: string;
  accepts(message: NormalizedChatMessageV1): boolean;
  deliver(delivery: import("@spmt/contracts").NormalizedChatDeliveryV1): void | Promise<void>;
}

export interface StreamWeaverProviderRuntimeOptionsV1 {
  databasePath: string;
  client: SpmtClient;
  egress: { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }> };
  now?: () => string;
  nowMs?: () => number;
  retryDelayMs?: number;
}

/**
 * Owns StreamWeaver's app-private chat state while Chat Gateway owns sockets.
 * Every SPMT call uses the StreamWeaver service identity supplied by the host.
 */
export class StreamWeaverProviderRuntime {
  readonly consumers: StreamWeaverProviderConsumerV1[];
  private readonly settings: StreamWeaverPersonaSettingsStore;
  private readonly summons: SqliteStreamWeaverSummonStore;
  private readonly commandState: SqliteStreamWeaverCommandState;
  private readonly economy: SqliteStreamWeaverEconomyStore;
  private readonly replies: StreamWeaverPersonaReplyReconciler;
  constructor(private readonly options: StreamWeaverProviderRuntimeOptionsV1) {
    this.settings = new StreamWeaverPersonaSettingsStore(options.databasePath, options.now);
    this.summons = new SqliteStreamWeaverSummonStore(options.databasePath);
    this.commandState = new SqliteStreamWeaverCommandState(options.databasePath);
    this.economy = new SqliteStreamWeaverEconomyStore(options.databasePath);
    const identities = new StreamWeaverSpmtIdentityResolver(options.client);
    const egress: StreamWeaverChatEgressV1 = options.egress;
    const persona = new StreamWeaverChatGatewayConsumer(this.summons, this.settings, new SpmtStreamWeaverPersonaRuntime(options.client), egress);
    const commands = new StreamWeaverDonorCommandConsumer({ services: new DefaultStreamWeaverDonorCommandServices({}), identities, state: this.commandState, egress, ...(options.nowMs ? { nowMs: options.nowMs } : {}) });
    const economy = new MultiTenantStreamWeaverEconomyCommandConsumer(this.economy, options.client, identities, this.commandState, egress, options.nowMs);
    this.consumers = [persona, commands, economy];
    this.replies = new StreamWeaverPersonaReplyReconciler(this.summons, options.client, egress, { ...(options.now ? { now: options.now } : {}), ...(options.retryDelayMs ? { retryDelayMs: options.retryDelayMs } : {}) });
  }
  consumerIds() { return this.consumers.map((consumer) => consumer.id); }
  reconcile(limit = 100) { return this.replies.runOnce(undefined, limit); }
  close() { this.economy.close(); this.commandState.close(); this.summons.close(); this.settings.close(); }
}
