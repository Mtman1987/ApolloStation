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
import { SqliteStreamWeaverBotRelayStore, StreamWeaverBotRelayConsumer } from "./bot-relay.js";
import { StreamWeaverBotActionConsumer, type StreamWeaverBotActionExecutorV1 } from "./bot-action-runtime.js";
import { StreamWeaverFlowPackageStore } from "./flow-packages.js";
import { StreamWeaverInstalledFlowConsumer } from "./flow-runtime.js";

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
  botActions?: StreamWeaverBotActionExecutorV1;
}

/**
 * Owns StreamWeaver's app-private chat state while Chat Gateway owns sockets.
 * Every SPMT call uses the StreamWeaver service identity supplied by the host.
 */
export class StreamWeaverProviderRuntime {
  readonly consumers: StreamWeaverProviderConsumerV1[];
  readonly messageObservers: Array<{ id: string; observe(message: NormalizedChatMessageV1): void }>;
  private readonly settings: StreamWeaverPersonaSettingsStore;
  private readonly summons: SqliteStreamWeaverSummonStore;
  private readonly commandState: SqliteStreamWeaverCommandState;
  private readonly economy: SqliteStreamWeaverEconomyStore;
  private readonly replies: StreamWeaverPersonaReplyReconciler;
  private readonly relayStore: SqliteStreamWeaverBotRelayStore;
  private readonly flows: StreamWeaverFlowPackageStore;
  constructor(private readonly options: StreamWeaverProviderRuntimeOptionsV1) {
    this.settings = new StreamWeaverPersonaSettingsStore(options.databasePath, options.now);
    this.summons = new SqliteStreamWeaverSummonStore(options.databasePath);
    this.commandState = new SqliteStreamWeaverCommandState(options.databasePath);
    this.economy = new SqliteStreamWeaverEconomyStore(options.databasePath);
    const identities = new StreamWeaverSpmtIdentityResolver(options.client);
    const egress: StreamWeaverChatEgressV1 = options.egress;
    this.relayStore = new SqliteStreamWeaverBotRelayStore(options.databasePath, options.now);
    this.flows = new StreamWeaverFlowPackageStore(options.databasePath, options.now);
    const relay = new StreamWeaverBotRelayConsumer(this.relayStore, egress);
    this.messageObservers = [{ id: "streamweaver.relay-identities", observe: (message) => { this.relayStore.observe(message); } }];
    const botActions = options.botActions ? new StreamWeaverBotActionConsumer(options.botActions, egress) : undefined;
    const priorGate = { willHandle: (message: NormalizedChatMessageV1) => relay.willHandle(message) || Boolean(botActions?.willHandle(message)) };
    const persona = new StreamWeaverChatGatewayConsumer(this.summons, this.settings, new SpmtStreamWeaverPersonaRuntime(options.client), egress, priorGate);
    const flows = new StreamWeaverInstalledFlowConsumer(this.flows, this.commandState, egress, options.botActions);
    const commands = new StreamWeaverDonorCommandConsumer({ services: new DefaultStreamWeaverDonorCommandServices({}), identities, state: this.commandState, egress, enabled: (tenantId, donorId) => this.flows.donorEnabled(tenantId, donorId), ...(options.nowMs ? { nowMs: options.nowMs } : {}) });
    const economy = new MultiTenantStreamWeaverEconomyCommandConsumer(this.economy, options.client, identities, this.commandState, egress, options.nowMs, Math.random, (tenantId, trigger) => this.flows.commandEnabled(tenantId, trigger));
    this.consumers = [relay, ...(botActions ? [botActions] : []), persona, flows, commands, economy];
    this.replies = new StreamWeaverPersonaReplyReconciler(this.summons, options.client, egress, { ...(options.now ? { now: options.now } : {}), ...(options.retryDelayMs ? { retryDelayMs: options.retryDelayMs } : {}) });
  }
  consumerIds() { return this.consumers.map((consumer) => consumer.id); }
  setBotShare(tenantId: string, enabled: boolean) { this.relayStore.setBotShare(tenantId, enabled); }
  reconcile(limit = 100) { return this.replies.runOnce(undefined, limit); }
  close() { this.flows.close(); this.relayStore.close(); this.economy.close(); this.commandState.close(); this.summons.close(); this.settings.close(); }
}
