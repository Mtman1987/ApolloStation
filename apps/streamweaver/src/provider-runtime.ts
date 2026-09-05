import {StreamWeaverResearchConversation,streamWeaverResearchIntent} from "./research-mode.js";
import {createHash} from "node:crypto";
import { assertDeviceAutomationPayload, DEVICE_AUTOMATION_ACTIONS } from "@spmt/contracts";
import { SpmtStreamWeaverTwitchGrantSource } from "./twitch-grants.js";
import { StreamWeaverTwitchCommandAdapter } from "./twitch-command-adapter.js";
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
import { StreamWeaverRuntimeSettingsStore } from "./runtime-settings.js";
import { SqliteStreamWeaverBicStore } from "./bic-store.js";
import { StreamWeaverBicRuntime, StreamWeaverBicCommandExecutor, StreamWeaverSocialActionExecutor } from "./donor-social-actions.js";

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
  allowAssistant?: boolean;
  providerGrants?: Pick<SpmtClient,"issueProviderGrant">;
  allowProviderWrites?: boolean;
  simulation?:boolean;
  providerFetch?: typeof fetch;
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
  private readonly runtimeSettings: StreamWeaverRuntimeSettingsStore;
  private readonly research:StreamWeaverResearchConversation;
  private readonly bic: SqliteStreamWeaverBicStore;
  private readonly installedFlows: StreamWeaverInstalledFlowConsumer;
  constructor(private readonly options: StreamWeaverProviderRuntimeOptionsV1) {
    this.settings = new StreamWeaverPersonaSettingsStore(options.databasePath, options.now);
    this.summons = new SqliteStreamWeaverSummonStore(options.databasePath);
    this.commandState = new SqliteStreamWeaverCommandState(options.databasePath);
    this.economy = new SqliteStreamWeaverEconomyStore(options.databasePath);
    const identities = new StreamWeaverSpmtIdentityResolver(options.client);
    const egress: StreamWeaverChatEgressV1 = options.egress;
    this.relayStore = new SqliteStreamWeaverBotRelayStore(options.databasePath, options.now);
    this.flows = new StreamWeaverFlowPackageStore(options.databasePath, options.now);
    this.runtimeSettings = new StreamWeaverRuntimeSettingsStore(options.databasePath);
    this.research=new StreamWeaverResearchConversation(options.databasePath,tenantId=>this.runtimeSettings.research(tenantId),options.nowMs);
    this.bic = new SqliteStreamWeaverBicStore(options.databasePath);
    const relay = new StreamWeaverBotRelayConsumer(this.relayStore, egress);
    this.messageObservers = [{ id: "streamweaver.relay-identities", observe: (message) => { this.relayStore.observe(message); } }];
    const botActions = options.botActions ? new StreamWeaverBotActionConsumer(options.botActions, egress) : undefined;
    const priorGate = { willHandle: (message: NormalizedChatMessageV1) => relay.willHandle(message) || Boolean(botActions?.willHandle(message)) };
    const services = new DefaultStreamWeaverDonorCommandServices({ ...(options.providerGrants?{twitch:new StreamWeaverTwitchCommandAdapter(new SpmtStreamWeaverTwitchGrantSource(options.providerGrants,tenantId=>this.runtimeSettings.twitchBroadcaster(tenantId),options.allowProviderWrites===true),options.providerFetch)}:{}), links:this.runtimeSettings, bic:new StreamWeaverBicCommandExecutor(new StreamWeaverBicRuntime({store:this.bic,client:options.client})), socialEffects:new StreamWeaverSocialActionExecutor(options.client), system:{execute:invocation=>invocation.canonicalTrigger==="!commands" ? `Installed commands: ${this.flows.listInstalledPackages(invocation.tenantId).flatMap(pkg=>pkg.commands.filter(c=>c.enabled).map(c=>c.trigger)).join(", ") || "none"}. Currency: !points, !givepoints, !gamble, !pleader.` : undefined} });
    const commands = new StreamWeaverDonorCommandConsumer({ services, identities, state: this.commandState, egress, enabled: (tenantId, donorId) => donorId === "commands-chat" || donorId === "commands-system" || this.flows.donorEnabled(tenantId, donorId), ...(options.nowMs ? { nowMs: options.nowMs } : {}) });
    const persona = new StreamWeaverChatGatewayConsumer(this.summons, this.settings, new SpmtStreamWeaverPersonaRuntime(options.client,this.research), egress, priorGate,this.research);
    const flows = this.installedFlows = new StreamWeaverInstalledFlowConsumer(this.flows, this.commandState, egress, options.botActions, commands, options.nowMs, {
      device:async ({delivery,deviceId,ownerUserId,action,payload,requestId})=>{
        if(!Object.hasOwn(DEVICE_AUTOMATION_ACTIONS,action))throw new Error("Unsupported device automation action");
        requestId=`sw-device:${createHash("sha256").update(requestId).digest("hex")}`;
        payload=assertDeviceAutomationPayload(action,payload);
        const tenantId=delivery.message.tenantId,capability=DEVICE_AUTOMATION_ACTIONS[action as keyof typeof DEVICE_AUTOMATION_ACTIONS];
        if(options.simulation){
          const key=`device:${requestId}`,prior=this.commandState.getReceipt(tenantId,key);if(prior)return {output:prior.text};
          const stateKey=`simulation-device:${deviceId}`,old=this.flows.variables(tenantId,stateKey),state={...old,...Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,String(v)])),action};
          for(const [name,value] of Object.entries(state))this.flows.setVariable(tenantId,stateKey,name,value);
          const output=JSON.stringify({simulation:true,deviceId,state});this.commandState.putReceipt({tenantId,deliveryId:key,command:action,text:output,createdAt:new Date().toISOString()});return {output};
        }
        if(options.allowProviderWrites!==true)throw new Error("Device execution is disabled here. Test the command in a Simulation Room.");
        const result=await options.client.createExecutionJob(tenantId,{ownerAppId:"streamweaver",capabilityId:"companion.device.command.v1",executionOwner:"companion",billedUserId:ownerUserId,meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"companion",meteringTarget:"companion",input:{command:{schemaVersion:1,tenantId,commandId:requestId,idempotencyKey:requestId,sourceAppId:"streamweaver",targetDeviceId:deviceId,capability,action,payload,requestedByUserId:ownerUserId,requestedAt:delivery.message.occurredAt,requiresConfirmation:false,confirmed:false}}},requestId);
        return {jobId:result.job.id};
      },
      getJob:(tenantId,jobId)=>options.client.getExecutionJob(tenantId,jobId),
      assistant:async ({delivery,prompt,requestId})=>{
        if(options.allowAssistant===false)return {status:"unavailable",reason:"External assistant execution is disabled in this environment."};
        const userId=delivery.message.actor.canonicalUserId;
        if(!userId)return {status:"unavailable",reason:"Link your chat account to SPMT before using assistant flows."};
        const persona=this.settings.get(delivery.message.tenantId),intent=streamWeaverResearchIntent(prompt),preferences=this.runtimeSettings.research(delivery.message.tenantId);
        return options.client.invokeCommunityAssistant(delivery.message.tenantId,{userId,message:prompt,...(intent.kind==="query"&&preferences.enabled?{research:{...preferences,query:intent.query}}:{}),surface:"stream",conversationId:`streamweaver:flow:${requestId}`,routingPreference:"automatic",remember:false,...(persona?{presentation:{personaId:persona.personaId,displayName:persona.displayName,instructions:persona.instructions,memoryPolicy:persona.memoryPolicy}}:{})},`streamweaver-assistant:${requestId}`);
      },
    });
    const economy = new MultiTenantStreamWeaverEconomyCommandConsumer(this.economy, options.client, identities, this.commandState, egress, options.nowMs, Math.random);
    this.consumers = [relay, ...(botActions ? [botActions] : []), ...(options.allowAssistant === false ? [] : [persona]), flows, commands, economy];
    this.replies = new StreamWeaverPersonaReplyReconciler(this.summons, options.client, egress, { ...(options.now ? { now: options.now } : {}), ...(options.retryDelayMs ? { retryDelayMs: options.retryDelayMs } : {}) });
  }
  consumerIds() { return this.consumers.map((consumer) => consumer.id); }
  setBotShare(tenantId: string, enabled: boolean) { this.relayStore.setBotShare(tenantId, enabled); }
  async reconcile(limit = 100) { const replies=await this.replies.runOnce(undefined, limit);const flows=await this.installedFlows.reconcile(limit);return {...replies,flows}; }
  settleFlows() { return this.installedFlows.settle(); }
  close() { this.research.close(); this.bic.close(); this.runtimeSettings.close(); this.flows.close(); this.relayStore.close(); this.economy.close(); this.commandState.close(); this.summons.close(); this.settings.close(); }
}
