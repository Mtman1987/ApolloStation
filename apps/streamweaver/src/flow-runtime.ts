import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1, SpmtSuiteActionIdV1 } from "@spmt/contracts";
import { SPMT_SUITE_ACTION_CATALOG } from "@spmt/contracts";
import type { StreamWeaverBotActionExecutorV1, StreamWeaverBotActorRoleV1 } from "./bot-action-runtime.js";
import type { StreamWeaverCommandStateV1 } from "./command-router.js";
import { StreamWeaverFlowPackageStore, type StreamWeaverFlowActionV1 } from "./flow-packages.js";

export class StreamWeaverInstalledFlowConsumer {
  readonly id = "streamweaver.installed-flows" as const;
  constructor(private readonly packages: StreamWeaverFlowPackageStore, private readonly state: StreamWeaverCommandStateV1, private readonly egress: { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }> }, private readonly suiteActions?: StreamWeaverBotActionExecutorV1) {}
  accepts(message: NormalizedChatMessageV1) { return !message.actor.isBot && Boolean(this.match(message)); }
  async deliver(delivery: NormalizedChatDeliveryV1) {
    const prior = this.state.getReceipt(delivery.message.tenantId, delivery.deliveryId);
    if (prior) { if (prior.text) await this.send(delivery, prior.text); return; }
    const match = this.match(delivery.message); if (!match) return;
    const replies: string[] = [];
    for (const action of match.package.actions.filter((item) => item.enabled)) {
      const reply = await this.run(action, delivery);
      if (reply) replies.push(reply);
    }
    const text = replies.join("\n").slice(0, 8_000);
    this.state.putReceipt({ tenantId: delivery.message.tenantId, deliveryId: delivery.deliveryId, command: match.command.trigger, text, createdAt: new Date().toISOString() });
    if (text) await this.send(delivery, text);
  }
  private match(message: NormalizedChatMessageV1) {
    const first = message.text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    for (const item of this.packages.listInstalledPackages(message.tenantId)) for (const command of item.commands) {
      if (!command.enabled || command.runtime !== "flow") continue;
      if (command.matcher === "command" && (command.trigger.toLowerCase() === first || command.aliases.some((alias) => alias.toLowerCase() === first))) return { package: item, command };
      if (command.matcher === "bare" && (message.text.trim().toLowerCase() === command.trigger.toLowerCase() || first === `!${command.trigger.toLowerCase()}`)) return { package: item, command };
    }
    return undefined;
  }
  private async run(action: StreamWeaverFlowActionV1, delivery: NormalizedChatDeliveryV1) {
    if (action.type === "send-chat") return interpolate(String(action.config.text ?? ""), delivery.message);
    if (action.type === "wait") { const ms=Math.max(0,Math.min(60_000,Number(action.config.milliseconds??action.config.value??0)||0));if(ms)await new Promise((done)=>setTimeout(done,ms));return ""; }
    if (action.type === "run-action") {
      const id=String(action.config.action??"") as SpmtSuiteActionIdV1;
      const descriptor=SPMT_SUITE_ACTION_CATALOG.find((item)=>item.id===id);
      if (!this.suiteActions || !descriptor) return "This flow needs a registered SPMT suite action that is not available.";
      const role=actorRole(delivery.message);
      if(roleLevel(role)<roleLevel(descriptor.minimumRole))return `That ${descriptor.risk} action requires ${descriptor.minimumRole} access.`;
      const args=record(action.config.args)??{};
      const result=await this.suiteActions.execute({action:id,args:Object.fromEntries(Object.entries(args).map(([key,value])=>[key,interpolate(String(value),delivery.message)])),detection:"explicit"},{tenantId:delivery.message.tenantId,source:delivery.message.provider,channelId:delivery.message.channelId,requestId:`${delivery.deliveryId}:${action.id}`,actor:{...(delivery.message.actor.canonicalUserId?{userId:delivery.message.actor.canonicalUserId}:{}),username:delivery.message.actor.username,role}});
      return result.response;
    }
    return `Flow step ${action.type} is portable but needs its registered app worker before it can run here.`;
  }
  private send(delivery:NormalizedChatDeliveryV1,text:string){return this.egress.send({schemaVersion:1,tenantId:delivery.message.tenantId,provider:delivery.message.provider,connectionId:delivery.message.connectionId,channelId:delivery.message.channelId,text,idempotencyKey:`streamweaver-flow:${delivery.deliveryId}`,replyToMessageId:delivery.message.messageId});}
}

function interpolate(value:string,message:NormalizedChatMessageV1){return value.replaceAll("%userName%",message.actor.displayName??message.actor.username).replaceAll("%user%",message.actor.username).replaceAll("%message%",message.text).replaceAll("%rawInput%",message.text).replaceAll("%targetUser%",message.mentions[0]?.username??"");}
function actorRole(message:NormalizedChatMessageV1):StreamWeaverBotActorRoleV1{return message.actor.roles.includes("broadcaster")?"owner":message.actor.roles.includes("moderator")?"moderator":message.actor.roles.includes("member")?"member":"guest";}
function roleLevel(role:StreamWeaverBotActorRoleV1){return{guest:0,member:1,moderator:2,admin:3,owner:4}[role];}
function record(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
