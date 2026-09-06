import {executePokemonCommand} from "./pokemon-commands.js";
import {awardStreamWeaverProviderEvent} from "./provider-event-awards.js";
import { SqliteStreamWeaverShoutoutStore, STREAMWEAVER_KNOWN_BOTS } from "./shoutout-store.js";
import { StreamWeaverPresentationRuntime } from "./stream-presentation-runtime.js";
import { StreamWeaverAdminEconomy } from "./economy-admin.js";
import { StreamRewardRequestError } from "./reward-runtime.js";
import { StreamWeaverTwitchEventSub, type StreamWeaverTwitchEvent } from "./twitch-eventsub.js";
import { STREAMWEAVER_DONOR_COMMANDS } from "./donor-command-catalog.js";
import { StreamWeaverCommunityStore } from "./community-store.js";
import { StreamWeaverCommunityRuntime } from "./community-runtime.js";
import { StreamWeaverPokemonStore } from "./pokemon-store.js";
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
import { secureChoiceActionFromExecution, STREAMWEAVER_SECURE_CHOICE_DONOR_ID, StreamWeaverSecureChoiceStore } from "./secure-choice.js";

export interface StreamWeaverProviderConsumerV1 {
  id: string;
  accepts(message: NormalizedChatMessageV1): boolean;
  deliver(delivery: import("@spmt/contracts").NormalizedChatDeliveryV1): void | Promise<void>;
}

export interface StreamWeaverProviderRuntimeOptionsV1 {
  databasePath: string;
  client: SpmtClient;
  egress: { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }> };
  publicOrigin?:string;
  now?: () => string;
  nowMs?: () => number;
  retryDelayMs?: number;
  botActions?: StreamWeaverBotActionExecutorV1;
  allowAssistant?: boolean;
  providerGrants?: Pick<SpmtClient,"issueProviderGrant">;
  allowProviderWrites?: boolean;
  simulation?:boolean;
  providerFetch?: typeof fetch;
  connections?:Array<{tenantId:string;provider:string;connectionId:string;channelId:string;desired:boolean}>;
}

/** Owns StreamWeaver's app-private chat state while Chat Gateway owns sockets. */
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
  private readonly eventsub?:StreamWeaverTwitchEventSub;
  private readonly twitch?:StreamWeaverTwitchCommandAdapter;
  private lastWatchPoll=0;
  private readonly community:StreamWeaverCommunityStore;
  private readonly shoutoutStore:SqliteStreamWeaverShoutoutStore;
  private readonly presentation?:StreamWeaverPresentationRuntime;
  private readonly pokemon:StreamWeaverPokemonStore;
  private readonly secureChoices:StreamWeaverSecureChoiceStore;
  private readonly installedFlows: StreamWeaverInstalledFlowConsumer;
  constructor(private readonly options: StreamWeaverProviderRuntimeOptionsV1) {
    this.community=new StreamWeaverCommunityStore(options.databasePath);
    this.shoutoutStore=new SqliteStreamWeaverShoutoutStore(options.databasePath);
    this.pokemon=new StreamWeaverPokemonStore(options.databasePath);
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
    this.secureChoices = new StreamWeaverSecureChoiceStore(options.databasePath, options.now);
    const relay = new StreamWeaverBotRelayConsumer(this.relayStore, egress);
    this.messageObservers = [{ id: "streamweaver.relay-identities", observe: (message) => { this.relayStore.observe(message); } }];
    const botActions = options.botActions ? new StreamWeaverBotActionConsumer(options.botActions, egress) : undefined;
    const priorGate = { willHandle: (message: NormalizedChatMessageV1) => relay.willHandle(message) || Boolean(botActions?.willHandle(message)) };
    const secureChoiceExecutor={execute:(invocation:import("./donor-command-runtime.js").StreamWeaverDonorCommandInvocationV1)=>{
      if(invocation.command.donorId!==STREAMWEAVER_SECURE_CHOICE_DONOR_ID)return undefined;
      const execution=this.flows.execution<unknown>(invocation.tenantId,invocation.deliveryId),action=secureChoiceActionFromExecution(execution);
      if(!action)throw new Error("Secure choice configuration is missing from the current flow step");
      const delivery=(execution as {delivery?:import("@spmt/contracts").NormalizedChatDeliveryV1}|undefined)?.delivery;
      if(!delivery)throw new Error("Secure choice flow input is unavailable");
      return this.secureChoices.start({delivery,config:action.config,requestKey:`${invocation.deliveryId}:${action.actionId}`,publicOrigin:options.publicOrigin??process.env.STREAMWEAVER_PUBLIC_ORIGIN??options.client.baseUrl}).text;
    }};
    const grants=options.providerGrants?new SpmtStreamWeaverTwitchGrantSource(options.providerGrants,tenant=>this.runtimeSettings.twitchBroadcaster(tenant),options.allowProviderWrites===true):undefined;
    if(grants){this.twitch=new StreamWeaverTwitchCommandAdapter(grants,options.providerFetch);if(options.allowProviderWrites===true)this.eventsub=new StreamWeaverTwitchEventSub(options.databasePath,grants,options.providerFetch);}
    if(this.twitch&&options.allowProviderWrites===true)this.presentation=new StreamWeaverPresentationRuntime({store:this.community,shoutoutStore:this.shoutoutStore,twitch:this.twitch,client:options.client,personas:this.settings,connections:options.connections??[],egress:options.egress});
    this.messageObservers.push({id:"streamweaver.welcome",observe:message=>{if(message.provider==="twitch"&&!message.actor.isBot&&!STREAMWEAVER_KNOWN_BOTS.has(message.actor.username.toLowerCase()))this.community.welcome(message.tenantId,message.provider,message.actor.providerUserId,message.actor.displayName??message.actor.username,message.actor.username);}});
    const community=new StreamWeaverCommunityRuntime(this.community,this.economy,options.client,options.allowAssistant!==false,options.simulation!==true&&options.allowProviderWrites===true);
    const services = new DefaultStreamWeaverDonorCommandServices({
      watchtime:{execute:i=>community.watchtime(i)},community:{execute:i=>community.community(i)},redeems:{execute:i=>community.redeem(i)},translation:community,
      ...(this.twitch?{twitch:this.twitch}:{}),
      links:this.runtimeSettings,
      moderation:{execute:invocation=>{if(invocation.canonicalTrigger!=="!so")return undefined;if(!this.presentation)throw new Error("Live shoutouts are unavailable in this environment");const username=(invocation.target?.username??invocation.args[0]??"").replace(/^@/,"");if(!/^[a-zA-Z0-9_]{1,25}$/.test(username))throw new Error("Usage: !so @username");this.community.requestTask(invocation.tenantId,invocation.deliveryId,{action:"shoutout",username});return `Shoutout queued for @${username}.`;}},
      pokemon:{execute:invocation=>executePokemonCommand(this.pokemon,invocation)},

      bic:new StreamWeaverBicCommandExecutor(new StreamWeaverBicRuntime({store:this.bic,client:options.client})),
      socialEffects:new StreamWeaverSocialActionExecutor(options.client),
      persona:secureChoiceExecutor,
      system:{execute:invocation=>invocation.canonicalTrigger==="!commands" ? `Installed commands: ${this.flows.listInstalledPackages(invocation.tenantId).flatMap(pkg=>pkg.commands.filter(c=>c.enabled).map(c=>c.trigger)).join(", ") || "none"}. Currency: !points, !givepoints, !gamble, !pleader.` : community.system(invocation)}
    });
    const commands = new StreamWeaverDonorCommandConsumer({ services, identities, state: this.commandState, egress, enabled: (tenantId, donorId) => donorId === "commands-chat" || donorId === "commands-system" || this.flows.donorEnabled(tenantId, donorId), ...(options.nowMs ? { nowMs: options.nowMs } : {}) });
    const persona = new StreamWeaverChatGatewayConsumer(this.summons, this.settings, new SpmtStreamWeaverPersonaRuntime(options.client,this.research), egress, priorGate,this.research);
    const flows = this.installedFlows = new StreamWeaverInstalledFlowConsumer(this.flows, this.commandState, egress, options.botActions, commands, options.nowMs, {
      device:async ({delivery,deviceId,ownerUserId,action,payload,requestId})=>{
        if(!Object.hasOwn(DEVICE_AUTOMATION_ACTIONS,action))throw new Error("Unsupported device automation action");
        requestId=`sw-device:${createHash("sha256").update(requestId).digest("hex")}`;
        payload=assertDeviceAutomationPayload(action,payload);
        const tenantId=delivery.message.tenantId,capability=DEVICE_AUTOMATION_ACTIONS[action as keyof typeof DEVICE_AUTOMATION_ACTIONS];
        if(options.simulation){const key=`device:${requestId}`,prior=this.commandState.getReceipt(tenantId,key);if(prior)return {output:prior.text};const stateKey=`simulation-device:${deviceId}`,old=this.flows.variables(tenantId,stateKey),state={...old,...Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,String(v)])),action};for(const [name,value] of Object.entries(state))this.flows.setVariable(tenantId,stateKey,name,value);const output=JSON.stringify({simulation:true,deviceId,state});this.commandState.putReceipt({tenantId,deliveryId:key,command:action,text:output,createdAt:new Date().toISOString()});return {output};}
        if(options.allowProviderWrites!==true)throw new Error("Device execution is disabled here. Test the command in a Simulation Room.");
        const result=await options.client.createExecutionJob(tenantId,{ownerAppId:"streamweaver",capabilityId:"companion.device.command.v1",executionOwner:"companion",billedUserId:ownerUserId,meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"companion",meteringTarget:"companion",input:{command:{schemaVersion:1,tenantId,commandId:requestId,idempotencyKey:requestId,sourceAppId:"streamweaver",targetDeviceId:deviceId,capability,action,payload,requestedByUserId:ownerUserId,requestedAt:delivery.message.occurredAt,requiresConfirmation:false,confirmed:false}}},requestId);
        return {jobId:result.job.id};
      },
      getJob:(tenantId,jobId)=>options.client.getExecutionJob(tenantId,jobId),
      points:async({delivery,delta,ownerUserId,requestId})=>{const userId=delivery.message.actor.canonicalUserId;if(!userId)throw new Error("Link your account before using streamer currency flows");const wallet=await new StreamWeaverAdminEconomy(this.economy,delivery.message.tenantId,{listCanonicalUserIds:()=>[userId]}).addPoints(userId,delta,createHash("sha256").update(requestId).digest("hex"),{actorId:ownerUserId});return wallet.balance;},
      speech:async({delivery,text,voice,requestId})=>{
        if(options.allowAssistant===false||options.simulation||options.allowProviderWrites!==true)throw new Error("External speech is disabled in this environment");
        const userId=delivery.message.actor.canonicalUserId;if(!userId)throw new Error("Link your account before using speech");
        const result=await options.client.createExecutionJob(delivery.message.tenantId,{ownerAppId:"streamweaver",executionOwner:"stellar-core",capabilityId:"stellar.speech.synthesize.v1",billedUserId:userId,meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"sprite",meteringTarget:"hosted",input:{kind:"stellar.speech.request.v1",text,voice:voice||"deepgram:aura-2:athena",remember:false,mediaVisibility:"public"}},`flow-speech:${createHash("sha256").update(requestId).digest("hex")}`);return {jobId:result.job.id};
      },
      assistant:async ({delivery,prompt,requestId})=>{if(options.allowAssistant===false)return {status:"unavailable",reason:"External assistant execution is disabled in this environment."};const userId=delivery.message.actor.canonicalUserId;if(!userId)return {status:"unavailable",reason:"Link your chat account to SPMT before using assistant flows."};const persona=this.settings.get(delivery.message.tenantId),intent=streamWeaverResearchIntent(prompt),preferences=this.runtimeSettings.research(delivery.message.tenantId);return options.client.invokeCommunityAssistant(delivery.message.tenantId,{userId,message:prompt,...(intent.kind==="query"&&preferences.enabled?{research:{...preferences,query:intent.query}}:{}),surface:"stream",conversationId:`streamweaver:flow:${requestId}`,routingPreference:"automatic",remember:false,...(persona?{presentation:{personaId:persona.personaId,displayName:persona.displayName,instructions:persona.instructions,memoryPolicy:persona.memoryPolicy}}:{})},`streamweaver-assistant:${requestId}`);},
    });
    const economy = new MultiTenantStreamWeaverEconomyCommandConsumer(this.economy, options.client, identities, this.commandState, egress, options.nowMs, Math.random);
    const eventAwards:StreamWeaverProviderConsumerV1={id:"streamweaver.provider-awards",accepts:message=>message.provider==="youtube"&&Boolean(message.rich?.eventType),deliver:async({message})=>{
      if(options.allowProviderWrites!==true)return;
      const userId=message.actor.canonicalUserId??await identities.resolve({tenantId:message.tenantId,provider:message.provider,providerUserId:message.actor.providerUserId,username:message.actor.username,displayName:message.actor.displayName??message.actor.username});
      awardStreamWeaverProviderEvent(this.community,this.economy,{tenantId:message.tenantId,event:`youtube:${message.rich!.eventType}`,sourceId:JSON.stringify([message.provider,message.connectionId,message.channelId,message.messageId]),userId:userId??""});
    }};
    this.consumers = [eventAwards,relay, ...(botActions ? [botActions] : []), ...(options.allowAssistant === false ? [] : [persona]), flows, commands, economy];
    this.replies = new StreamWeaverPersonaReplyReconciler(this.summons, options.client, egress, { ...(options.now ? { now: options.now } : {}), ...(options.retryDelayMs ? { retryDelayMs: options.retryDelayMs } : {}) });
  }
  consumerIds() { return this.consumers.map((consumer) => consumer.id); }
  setBotShare(tenantId: string, enabled: boolean) { this.relayStore.setBotShare(tenantId, enabled); }
  async reconcile(limit = 100) { await this.reconcileProviderEvents(); await this.presentation?.runOnce(); await this.community.flush((tenant,type,payload,key)=>this.options.client.publishEvent(tenant,type,payload,key)); await this.pokemon.flush((tenant,type,payload,key)=>this.options.client.publishEvent(tenant,type,payload,key)); const replies=await this.replies.runOnce(undefined, limit);const flows=await this.installedFlows.reconcile(limit);const secureChoices=await this.secureChoices.flushOutbox(message=>this.options.egress.send(message),limit);return {...replies,flows,secureChoices}; }
  private async reconcileProviderEvents(){
    if(this.options.allowProviderWrites!==true)return;
    const tenants=this.community.configuredTenants();
    if(this.twitch&&Date.now()-this.lastWatchPoll>=60000){this.lastWatchPoll=Date.now();for(const tenant of tenants)try{const stream=await this.twitch.uptime(tenant);if(stream){this.community.saveSettings(tenant,{welcomeSession:`twitch:${stream.id}`});this.community.recordWatchtime(tenant,"twitch",await this.twitch.chatters(tenant));}}catch{/* Missing grants do not fabricate watchtime. */}}
    await this.eventsub?.reconcile(tenants.map(tenantId=>({tenantId,types:[...this.community.awards(tenantId).filter(a=>a.enabled&&a.event.startsWith("twitch:")).map(a=>a.event.slice(7)),...this.community.bindings(tenantId).filter(b=>b.enabled).map(b=>b.event),...this.community.redeems(tenantId).filter(r=>r.enabled&&r.rewardId).map(r=>`reward:${r.rewardId}`)]})).filter(t=>t.types.length),event=>this.deliverProviderEvent(event));
  }
  private async deliverProviderEvent(event:StreamWeaverTwitchEvent){
    const connection=this.options.connections?.find(c=>c.tenantId===event.tenantId&&c.provider==="twitch"&&c.desired);
    if(!connection)throw new Error("Configure a Twitch chat destination for provider events");
    const canonicalUserId=event.userId?await new StreamWeaverSpmtIdentityResolver(this.options.client).resolve({tenantId:event.tenantId,provider:"twitch",providerUserId:event.userId,username:event.username,displayName:event.displayName}):undefined;
    const source=event.redemptionId?`twitch-reward:${event.redemptionId}`:`eventsub:${event.id}`,eventName=event.rewardId?`reward:${event.rewardId}`:event.type;
    if(event.type!=="reward")awardStreamWeaverProviderEvent(this.community,this.economy,{tenantId:event.tenantId,event:`twitch:${event.type}`,sourceId:source,userId:canonicalUserId??"",units:event.units??1});
    const redeem=event.rewardId?this.community.redeems(event.tenantId).find(r=>r.rewardId===event.rewardId):undefined;
    let outcome=this.community.eventOutcome(event.tenantId,source);
    if(redeem&&!outcome){
      if(!canonicalUserId)outcome={accepted:false,text:"Reward declined: link your Twitch account to SPMT before redeeming."};
      else if(!redeem.enabled)outcome={accepted:false,text:"Reward declined: this reward is paused."};
      else {
        const runtime=new StreamWeaverCommunityRuntime(this.community,this.economy,this.options.client,this.options.allowAssistant!==false);
        const args=event.input.trim().split(/\s+/),currency=args[0]?.toLowerCase()==="spmt"?"spmt":"streamer";
        if(redeem.acceptance==="spmt"&&currency!=="spmt")outcome={accepted:false,text:"Reward declined: this reward requires an explicit SPMT payment. Use the reward desk to confirm the XP price."};
        else if(redeem.acceptance==="streamer"&&currency==="spmt")outcome={accepted:false,text:"Reward declined: the streamer accepts only their own points for this reward."};
        else {
          try {
          const result=await runtime.redeemReward({tenantId:event.tenantId,requestId:source,rewardId:redeem.id,userId:canonicalUserId,displayName:event.displayName,currency,...(args[1]?{maxSpmtCost:Number(args[1])}:{})});
          outcome={accepted:result.state==="complete",text:result.state==="complete"?result.text:`Reward declined: ${result.message}`};
          }catch(error){if(error instanceof StreamRewardRequestError)outcome={accepted:false,text:`Reward declined: ${error.message}`};else throw error;}
        }
      }
      if(outcome)this.community.saveEventOutcome(event.tenantId,source,outcome);
    }
    if(outcome&&!outcome.accepted){
      await this.options.egress.send({schemaVersion:1,tenantId:event.tenantId,provider:"twitch",connectionId:connection.connectionId,channelId:connection.channelId,text:outcome.text,idempotencyKey:`reward-result:${source}`});
      if(event.rewardId&&event.redemptionId)await this.twitch?.redemptionStatus(event.tenantId,event.rewardId,event.redemptionId,"CANCELED");
      return;
    }
    const binding=this.community.bindings(event.tenantId).find(b=>b.enabled&&b.event===eventName);
    const text=binding?.command.replaceAll("{user}",event.username).replaceAll("{input}",event.input);
    if(text){const message:NormalizedChatMessageV1={schemaVersion:1,tenantId:event.tenantId,provider:"twitch",connectionId:connection.connectionId,channelId:connection.channelId,messageId:source,text,occurredAt:event.occurredAt,actor:{providerUserId:event.userId||"anonymous",username:event.username||"anonymous",displayName:event.displayName,roles:["member"],isBot:false,...(canonicalUserId?{canonicalUserId}:{})},mentions:[]};await this.installedFlows.deliver({schemaVersion:1,deliveryId:source,consumerId:"streamweaver.installed-flows",attempts:1,message});}
    if(outcome){
      await this.options.egress.send({schemaVersion:1,tenantId:event.tenantId,provider:"twitch",connectionId:connection.connectionId,channelId:connection.channelId,text:outcome.text,idempotencyKey:`reward-result:${source}`});
      if(event.rewardId&&event.redemptionId)await this.twitch?.redemptionStatus(event.tenantId,event.rewardId,event.redemptionId,"FULFILLED");
    }
  }
  settleFlows() { return this.installedFlows.settle(); }
  close() { this.shoutoutStore.close(); this.eventsub?.close(); this.community.close(); this.pokemon.close(); this.secureChoices.close(); this.research.close(); this.bic.close(); this.runtimeSettings.close(); this.flows.close(); this.relayStore.close(); this.economy.close(); this.commandState.close(); this.summons.close(); this.settings.close(); }
}
