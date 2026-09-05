import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1, SpmtSuiteActionIdV1 } from "@spmt/contracts";
import { SPMT_SUITE_ACTION_CATALOG } from "@spmt/contracts";
import type { StreamWeaverBotActionExecutorV1, StreamWeaverBotActorRoleV1 } from "./bot-action-runtime.js";
import type { StreamWeaverCommandStateV1 } from "./command-router.js";
import { assertStreamWeaverFlowRunnable, StreamWeaverFlowPackageStore, type StreamWeaverFlowActionV1, type StreamWeaverFlowPackageV1 } from "./flow-packages.js";

export interface StreamWeaverNativeFlowExecutorV1 {
  execute(donorId: string, delivery: NormalizedChatDeliveryV1): Promise<string | undefined>;
}

export class StreamWeaverInstalledFlowConsumer {
  readonly id = "streamweaver.installed-flows" as const;
  constructor(private readonly packages: StreamWeaverFlowPackageStore, private readonly state: StreamWeaverCommandStateV1, private readonly egress: { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }> }, private readonly suiteActions?: StreamWeaverBotActionExecutorV1, private readonly nativeActions?: StreamWeaverNativeFlowExecutorV1, private readonly nowMs: () => number = Date.now) {}
  accepts(message: NormalizedChatMessageV1) { return !message.actor.isBot && Boolean(this.match(message)); }
  async deliver(delivery: NormalizedChatDeliveryV1) {
    const receiptId = `flow:${delivery.deliveryId}`;
    const prior = this.state.getReceipt(delivery.message.tenantId, receiptId);
    if (prior) return;
    const match = this.match(delivery.message); if (!match) return;
    const replies: string[] = [], variables: Record<string,string> = Object.create(null), steps: Array<Record<string,unknown>> = [];
    const cooldownKey = JSON.stringify(["flow",delivery.message.tenantId,delivery.message.provider,delivery.message.channelId,match.package.packageId,match.command.id,delivery.message.actor.canonicalUserId ?? delivery.message.actor.providerUserId]);
    const last = this.state.getCooldown(cooldownKey), remaining = Math.ceil((last + match.command.cooldownSeconds*1000 - this.nowMs())/1000);
    const run = { packageId:match.package.packageId, command:match.command.trigger, input:delivery.message.text, provider:delivery.message.provider, channelId:delivery.message.channelId, actor:delivery.message.actor.displayName ?? delivery.message.actor.username, occurredAt:new Date(this.nowMs()).toISOString(), steps };
    if (last && remaining > 0) { this.packages.recordRun(delivery.message.tenantId,delivery.deliveryId,{...run,state:"cooldown"}); await this.send(delivery,`Wait ${remaining}s before using ${match.command.trigger} again.`); return; }
    try {
      assertStreamWeaverFlowRunnable(match.package);
      const actions = match.command.actionIds.map(id => match.package.actions.find(action => action.id === id)!).filter(action => action.enabled);
      for (const action of actions) {
        const stepId = `${receiptId}:${action.id}`, previous = this.state.getReceipt(delivery.message.tenantId,stepId);
        const reply = previous && action.type !== "set-variable" ? previous.text : await this.run(action, delivery, false, variables);
        this.state.putReceipt({tenantId:delivery.message.tenantId,deliveryId:stepId,command:match.command.trigger,text:reply ?? "",createdAt:new Date(this.nowMs()).toISOString()});
        steps.push({actionId:action.id,type:action.type,state:"succeeded",output:reply ?? ""});
        if (reply) { replies.push(reply); await this.send(delivery,reply,action.id); }
      }
      this.state.putCooldown(cooldownKey,this.nowMs());
      this.packages.recordRun(delivery.message.tenantId,delivery.deliveryId,{...run,state:"succeeded"});
    } catch(error) {
      const message = error instanceof Error ? error.message : "Flow execution failed";
      this.packages.recordRun(delivery.message.tenantId,delivery.deliveryId,{...run,state:"failed",error:message});
      throw error;
    }
    const text = replies.join("\n").slice(0, 8_000);
    this.state.putReceipt({ tenantId: delivery.message.tenantId, deliveryId: receiptId, command: match.command.trigger, text, createdAt: new Date(this.nowMs()).toISOString() });
  }
  /** Runs one explicit bundle command without installing it or emitting provider egress. */
  async preview(item: StreamWeaverFlowPackageV1, commandId: string, delivery: NormalizedChatDeliveryV1) {
    const command = item.commands.find((candidate) => candidate.id === commandId);
    if (!command) throw new Error("Flow preview command does not exist");
    const variables: Record<string,string> = Object.create(null), outputs: Array<{ actionId: string; type: StreamWeaverFlowActionV1["type"]; text: string }> = [];
    for (const action of command.actionIds.map(id => item.actions.find(candidate => candidate.id === id)!)) {
      const text = await this.run(action, delivery, true, variables);
      if (text) outputs.push({ actionId: action.id, type: action.type, text });
    }
    return { command, outputs };
  }
  private match(message: NormalizedChatMessageV1) {
    const first = message.text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    for (const item of this.packages.listInstalledPackages(message.tenantId)) for (const command of item.commands) {
      if (!command.enabled || command.runtime !== "flow") continue;
      if (command.matcher === "command" && (command.trigger.toLowerCase() === first || command.aliases.some((alias) => alias.toLowerCase() === first))) return { package: item, command };
      if (command.matcher === "bare" && (message.text.trim().toLowerCase() === command.trigger.toLowerCase() || first === `!${command.trigger.toLowerCase()}`)) return { package: item, command };
      if (command.matcher === "regex" && regexMatch(command.trigger, message.text)) return { package: item, command };
    }
    return undefined;
  }
  private async run(action: StreamWeaverFlowActionV1, delivery: NormalizedChatDeliveryV1, preview = false, variables: Record<string,string> = Object.create(null)) {
    const render = (value: unknown) => interpolate(String(value ?? ""),delivery.message).replace(/\{\{([A-Za-z0-9_]+)\}\}/g,(_,key:string)=>variables[key] ?? "");
    if (action.type === "send-chat") return render(action.config.text);
    if (action.type === "set-variable") { const key = String(action.config.key ?? action.config.name ?? ""); if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))throw new Error("Choose a variable name using letters, numbers, and underscores"); variables[key]=render(action.config.value); return ""; }
    if (action.type === "send-discord") {
      const text=render(action.config.text ?? action.config.message);
      if(!text.trim())throw new Error("Discord message text is required");
      const connectionId=String(action.config.connectionId ?? (delivery.message.provider==="discord"?delivery.message.connectionId:"")),channelId=String(action.config.channelId ?? (delivery.message.provider==="discord"?delivery.message.channelId:""));
      if(!connectionId||!channelId)throw new Error("Choose a connected Discord destination for this step");
      if(preview)return text;
      await this.egress.send({schemaVersion:1,tenantId:delivery.message.tenantId,provider:"discord",connectionId,channelId,text,idempotencyKey:`streamweaver-flow-discord:${delivery.deliveryId}:${action.id}`});
      return "";
    }
    if (action.type === "wait") { const ms=Math.max(0,Math.min(60_000,Number(action.config.milliseconds??action.config.value??0)||0));if(ms&&!preview)await new Promise((done)=>setTimeout(done,ms));return preview&&ms?`Wait ${ms}ms`:""; }
    if (action.type === "run-action") {
      const id=String(action.config.action??"") as SpmtSuiteActionIdV1;
      const descriptor=SPMT_SUITE_ACTION_CATALOG.find((item)=>item.id===id);
      if (preview) return descriptor ? `Would run ${descriptor.id} (${descriptor.risk})` : "This flow references an unknown SPMT suite action.";
      if (!this.suiteActions || !descriptor) throw new Error("This flow needs a registered SPMT suite action that is not available.");
      const role=actorRole(delivery.message);
      if(roleLevel(role)<roleLevel(descriptor.minimumRole))return `That ${descriptor.risk} action requires ${descriptor.minimumRole} access.`;
      const args=record(action.config.args)??{};
      const result=await this.suiteActions.execute({action:id,args:Object.fromEntries(Object.entries(args).map(([key,value])=>[key,interpolate(String(value),delivery.message)])),detection:"explicit"},{tenantId:delivery.message.tenantId,source:delivery.message.provider,channelId:delivery.message.channelId,requestId:`${delivery.deliveryId}:${action.id}`,actor:{...(delivery.message.actor.canonicalUserId?{userId:delivery.message.actor.canonicalUserId}:{}),username:delivery.message.actor.username,role}});
      return result.response;
    }
    if (action.type === "run-native") {
      const donorId = String(action.config.donorId ?? "");
      if (!this.nativeActions || !donorId) return "This flow needs a native StreamWeaver capability that is not available.";
      return await this.nativeActions.execute(donorId, delivery) ?? "";
    }
    throw new Error(`Flow step ${action.type} needs a registered execution capability. Replace it with an available action before enabling this flow.`);
  }
  private send(delivery:NormalizedChatDeliveryV1,text:string,stepId="status"){return this.egress.send({schemaVersion:1,tenantId:delivery.message.tenantId,provider:delivery.message.provider,connectionId:delivery.message.connectionId,channelId:delivery.message.channelId,text,idempotencyKey:`streamweaver-flow:${delivery.deliveryId}:${stepId}`,replyToMessageId:delivery.message.messageId});}
}

function interpolate(value:string,message:NormalizedChatMessageV1){return value.replaceAll("%userName%",message.actor.displayName??message.actor.username).replaceAll("%user%",message.actor.username).replaceAll("%message%",message.text).replaceAll("%rawInput%",message.text).replaceAll("%args%",message.text.trim().split(/\s+/).slice(1).join(" ")).replaceAll("%targetUser%",message.mentions[0]?.username??"");}
function actorRole(message:NormalizedChatMessageV1):StreamWeaverBotActorRoleV1{return message.actor.roles.includes("broadcaster")?"owner":message.actor.roles.includes("moderator")?"moderator":message.actor.roles.includes("member")?"member":"guest";}
function roleLevel(role:StreamWeaverBotActorRoleV1){return{guest:0,member:1,moderator:2,admin:3,owner:4}[role];}
function record(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function regexMatch(pattern:string,value:string){try{const insensitive=pattern.startsWith("(?i)");return new RegExp(insensitive?pattern.slice(4):pattern,insensitive?"i":"").test(value);}catch{return false;}}
