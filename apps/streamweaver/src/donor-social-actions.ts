import type { SpmtClient } from "@spmt/sdk";
import type { StreamWeaverCapabilityExecutorV1 } from "./donor-command-services.js";
import type { StreamWeaverDonorCommandInvocationV1 } from "./donor-command-runtime.js";
import { STREAMWEAVER_DONOR_ACTION_FIRED } from "./donor-event-actions.js";
import type { SqliteStreamWeaverBicStore, StreamWeaverBicMutationV1 } from "./bic-store.js";
import { findBestStreamWeaverUsernameMatch, type StreamWeaverChatterV1 } from "./username-matcher.js";
import { SqliteStreamWeaverSocialReactionStore, type StreamWeaverSocialReactionRecord } from "./social-reaction-store.js";

export const STREAMWEAVER_SOCIAL_INTERACTION = "streamweaver.social.interaction.v1";
export const STREAMWEAVER_BIC_COUNTER_UPDATED = "streamweaver.bic.counter.updated.v1";
const STREAMWEAVER_OVERLAY_CUE_TYPE = "streamweaver.overlay.cue.requested.v1";

export interface StreamWeaverDonorSocialActionV1 {
  id: string;
  name: string;
  trigger?: string;
  kind: "interaction" | "economy-side-effect" | "bic" | "voice-bic";
}

export const STREAMWEAVER_DONOR_SOCIAL_ACTIONS = [
  { id:"athena-bic", name:"Athena Voice Bic", kind:"voice-bic" },
  { id:"bic-lighter-action", name:"Bic Lighter Tracker", trigger:"!bic", kind:"bic" },
  { id:"d10530cd-c7db-4e03-9bbf-eda02aa62055", name:"_boop", trigger:"!boop", kind:"interaction" },
  { id:"665ccb06-ae9a-4393-aaa2-159623b14e21", name:"_cuddle", trigger:"!cuddle", kind:"interaction" },
  { id:"567e5814-d170-44e2-901a-73e5f9cc6967", name:"_dance", trigger:"!dance", kind:"interaction" },
  { id:"29b4867a-a2e2-4f76-9c60-85e8e5186678", name:"_date", kind:"interaction" },
  { id:"4b1e9bba-bb77-4a4f-9dc8-62a2e34ff8bc", name:"_fistbump", trigger:"!fistbump", kind:"interaction" },
  { id:"9fff9c94-f215-4c29-924f-611bae299452", name:"_headpat", trigger:"!headpat", kind:"interaction" },
  { id:"d16bf11c-bf79-4555-815c-2af80afdbf70", name:"_highfive", trigger:"!highfive", kind:"interaction" },
  { id:"6a0dad65-2162-4821-b663-9b36dea7be3b", name:"_love", trigger:"!love", kind:"interaction" },
  { id:"streamweaver-social-hug", name:"_hug", trigger:"!hug", kind:"interaction" },
  { id:"4d8cf691-44d3-43eb-86fa-69d64578d2cb", name:"_roll", trigger:"!roll", kind:"economy-side-effect" },
  { id:"313f7815-6a4f-4077-83db-1258a56a3f16", name:"_tickle", trigger:"!tickle", kind:"interaction" },
] as const satisfies readonly StreamWeaverDonorSocialActionV1[];

export interface StreamWeaverBicChatterSourceV1 {
  list(input: { tenantId: string; provider: string; channelId: string }): Promise<readonly StreamWeaverChatterV1[]> | readonly StreamWeaverChatterV1[];
}
export interface StreamWeaverBicRuntimeOptionsV1 {
  store: SqliteStreamWeaverBicStore;
  client: Pick<SpmtClient, "publishEvent">;
  chatters?: StreamWeaverBicChatterSourceV1;
  resolveThiefDisplayName?: (tenantId: string, invocation?: StreamWeaverDonorCommandInvocationV1) => Promise<string> | string;
}

export class StreamWeaverBicRuntime {
  constructor(private readonly options: StreamWeaverBicRuntimeOptionsV1) {}

  async fromCommand(invocation: StreamWeaverDonorCommandInvocationV1): Promise<string> {
    const rawTarget = invocation.target?.username ?? invocation.args.join(" ").trim();
    if (!rawTarget) return "Usage: !bic @user";
    const target = safeUsername(rawTarget);
    const display = invocation.target?.username ?? target;
    const thief = await this.thief(invocation.tenantId, invocation);
    const result = await this.record({
      tenantId: invocation.tenantId,
      target,
      displayName: display,
      thiefDisplayName: thief,
      idempotencyKey: `bic:${invocation.deliveryId}`,
      donorActionId: "bic-lighter-action",
      donorActionName: "Bic Lighter Tracker",
      source: "chat-command",
    });
    return donorBicMessage(thief, result);
  }

  async fromVoice(input: { tenantId: string; invocationId: string; partialName: string; provider: string; channelId: string }): Promise<{ matched?: string; text?: string }> {
    if (!this.options.chatters) throw new Error("Bic voice username matching requires a chatter source");
    const chatters = await this.options.chatters.list({ tenantId: input.tenantId, provider: input.provider, channelId: input.channelId });
    const matched = findBestStreamWeaverUsernameMatch(input.partialName, chatters);
    if (!matched) return {};
    const target = safeUsername(matched.userLogin);
    const thief = await this.thief(input.tenantId);
    const result = await this.record({
      tenantId: input.tenantId,
      target,
      displayName: matched.displayName ?? matched.userLogin,
      thiefDisplayName: thief,
      idempotencyKey: `athena-bic:${safeId(input.invocationId, "invocationId")}`,
      donorActionId: "athena-bic",
      donorActionName: "Athena Voice Bic",
      source: "voice",
    });
    return { matched: target, text: donorBicMessage(thief, result) };
  }

  async record(input: { tenantId: string; target: string; displayName: string; thiefDisplayName: string; idempotencyKey: string; donorActionId: string; donorActionName: string; source: string }): Promise<StreamWeaverBicMutationV1> {
    const result = this.options.store.steal(input.tenantId, input.target, input.displayName, input.idempotencyKey);
    const payload = {
      schemaVersion: 1,
      total: result.total,
      lastUser: result.target,
      lastUserDisplayName: result.displayName,
      lastUserCount: result.userCount,
      thiefDisplayName: safeDisplay(input.thiefDisplayName),
      source: safeToken(input.source),
      duplicate: result.duplicate,
    };
    await this.options.client.publishEvent(input.tenantId, STREAMWEAVER_DONOR_ACTION_FIRED, {
      schemaVersion: 1,
      donorActionId: input.donorActionId,
      donorActionName: input.donorActionName,
      source: payload.source,
      bic: payload,
    }, `streamweaver-donor-action:${input.donorActionId}:${input.idempotencyKey}`);
    await this.options.client.publishEvent(input.tenantId, STREAMWEAVER_BIC_COUNTER_UPDATED, payload, `streamweaver-bic:${input.idempotencyKey}`);
    await this.options.client.publishEvent(input.tenantId, STREAMWEAVER_OVERLAY_CUE_TYPE, {
      schemaVersion: 1,
      renderer: "bic-counter",
      payload: { total: result.total, lastUser: result.target, lastUserCount: result.userCount },
      sourceEventId: input.idempotencyKey,
    }, `streamweaver-bic-overlay:${input.idempotencyKey}`);
    return result;
  }

  private async thief(tenantId: string, invocation?: StreamWeaverDonorCommandInvocationV1): Promise<string> {
    const configured = await this.options.resolveThiefDisplayName?.(tenantId, invocation);
    return safeDisplay(configured ?? invocation?.actor.displayName ?? "Streamer");
  }
}

/** Hooks the existing donor command runtime to the preserved starter-social action identities. */
export class StreamWeaverSocialActionExecutor implements StreamWeaverCapabilityExecutorV1 {
  constructor(private readonly client: Pick<SpmtClient, "publishEvent">, private readonly store?:SqliteStreamWeaverSocialReactionStore) {}
  async execute(invocation: StreamWeaverDonorCommandInvocationV1): Promise<string | undefined> {
    const action = STREAMWEAVER_DONOR_SOCIAL_ACTIONS.find((candidate) => "trigger" in candidate && candidate.trigger === invocation.canonicalTrigger && candidate.kind === "interaction");
    if (!action) return undefined;
    const actor=invocation.actor.displayName||invocation.actor.username,target=invocation.target?.username??"";
    const animationKey=socialAnimationKey(invocation.canonicalTrigger);
    const payload = {
      schemaVersion: 1,
      donorActionId: action.id,
      donorActionName: action.name,
      trigger: invocation.canonicalTrigger,
      deliveryId: invocation.deliveryId,
      animationKey,
      actor: { ...(invocation.actor.userId ? { userId: invocation.actor.userId } : {}), providerUserId: invocation.actor.providerUserId, username: invocation.actor.username, displayName: invocation.actor.displayName },
      ...(invocation.target ? { target: invocation.target } : {}),
      provider: invocation.provider,
      channelId: invocation.channelId,
    };
    await this.client.publishEvent(invocation.tenantId, STREAMWEAVER_DONOR_ACTION_FIRED, payload, `streamweaver-donor-action:${action.id}:${invocation.deliveryId}`);
    if(this.store)this.store.enqueue({tenantId:invocation.tenantId,deliveryId:invocation.deliveryId,trigger:invocation.canonicalTrigger,actor,target,animationKey});
    else await this.client.publishEvent(invocation.tenantId, STREAMWEAVER_SOCIAL_INTERACTION, {...payload,reaction:socialFallback(invocation.canonicalTrigger,actor,target,0),interactionText:socialInteractionText(invocation.canonicalTrigger,actor,target)}, `streamweaver-social:${action.id}:${invocation.deliveryId}`);
    return undefined;
  }
}

export class StreamWeaverSocialReactionReconciler {
  constructor(
    private readonly store:SqliteStreamWeaverSocialReactionStore,
    private readonly client:SpmtClient,
    private readonly owner:(tenantId:string)=>string|undefined,
  ){}
  async runOnce(limit=50){
    let observed=0,waiting=0,published=0,failed=0;
    for(const item of this.store.pending(limit)){
      observed++;
      const owner=this.owner(item.tenantId);
      if(!owner){
        await this.publish(item,socialFallback(item.trigger,item.actor,item.target,this.store.count(item.tenantId)));failed++;continue;
      }
      if(!item.jobId){
        const recent=this.store.recent(item.tenantId,30);
        const conversationId=`streamweaver:social:${item.deliveryId}`;
        const result=await this.client.invokeCommunityAssistant(item.tenantId,{
          userId:owner,surface:"stream",remember:false,routingPreference:"automatic",conversationId,
          presentation:{personaId:"social-alert",displayName:"Social alert",instructions:"Write one playful, friendly, public reaction to the supplied social interaction. Keep it under 140 characters. Never mention private context. Never reuse an exact previous line.",memoryPolicy:"off"},
          message:`Interaction: ${socialInteractionText(item.trigger,item.actor,item.target)}\nAnimation: ${item.animationKey}\nDo not repeat any of these recent lines: ${JSON.stringify(recent)}\nReturn only the new reaction.`,
        },`social-reaction:${item.deliveryId}:${item.attempts+1}`);
        if(result.status!=="accepted"){await this.publish(item,socialFallback(item.trigger,item.actor,item.target,this.store.count(item.tenantId)));failed++;continue;}
        this.store.setJob(item.tenantId,item.deliveryId,result.jobId,item.attempts+1);waiting++;continue;
      }
      const job=await this.client.getExecutionJob(item.tenantId,item.jobId);
      const conversationId=`streamweaver:social:${item.deliveryId}`;
      if(job.tenantId!==item.tenantId||job.billedUserId!==owner||job.ownerAppId!=="stellar-core"||job.input.conversationId!==conversationId){await this.publish(item,socialFallback(item.trigger,item.actor,item.target,this.store.count(item.tenantId)));failed++;continue;}
      if(!["succeeded","failed","cancelled","dead-letter"].includes(job.state)){waiting++;continue;}
      if(job.state!=="succeeded"){await this.publish(item,socialFallback(item.trigger,item.actor,item.target,this.store.count(item.tenantId)));failed++;continue;}
      const reaction=safeReaction(job.result?.text);
      const prior=this.store.recent(item.tenantId,40).map(value=>value.toLowerCase());
      if((!reaction||prior.includes(reaction.toLowerCase()))&&item.attempts<2){this.store.retry(item.tenantId,item.deliveryId);waiting++;continue;}
      await this.publish(item,reaction&&!prior.includes(reaction.toLowerCase())?reaction:socialFallback(item.trigger,item.actor,item.target,this.store.count(item.tenantId)));published++;
    }
    return{observed,waiting,published,failed};
  }
  private async publish(item:StreamWeaverSocialReactionRecord,reaction:string){
    this.store.complete(item.tenantId,item.deliveryId,reaction);
    const interactionText=socialInteractionText(item.trigger,item.actor,item.target);
    await this.client.publishEvent(item.tenantId,STREAMWEAVER_SOCIAL_INTERACTION,{
      schemaVersion:1,trigger:item.trigger,deliveryId:item.deliveryId,animationKey:item.animationKey,reaction,interactionText,
      actor:{displayName:item.actor,username:item.actor},...(item.target?{target:{username:item.target}}:{}),
    },`streamweaver-social:${item.deliveryId}:reaction`);
  }
}

function safeReaction(value:unknown){return String(value??"").replace(/[\r\n\u0000-\u001f]+/g," ").replace(/\s+/g," ").trim().slice(0,140);}
function socialAnimationKey(trigger:string){return trigger.replace(/^!/,"").replace(/[^a-z0-9-]/g,"")||"social";}
function socialInteractionText(trigger:string,actor:string,target:string){
  const verbs:Record<string,string>={"!boop":"boops","!cuddle":"cuddles","!dance":"dances with","!fistbump":"fist bumps","!headpat":"gives headpats to","!highfive":"high fives","!hug":"hugs","!love":"sends love to","!tickle":"tickles"};
  return `${actor} ${verbs[trigger]??"greets"} ${target||"chat"}!`;
}
function socialFallback(trigger:string,actor:string,target:string,index:number){
  const subject=target||"chat",key=socialAnimationKey(trigger),variants=[
    `Mission control confirms: ${actor} just deployed a ${key} toward ${subject}.`,
    `Zero gravity could not stop ${actor}'s ${key} from reaching ${subject}.`,
    `${subject}, brace for impact — ${actor} just launched a ${key} across the Lounge.`,
    `Social telemetry spike: ${actor} → ${subject}, classified as ${key}.`,
    `The Lounge sensors definitely caught that ${key}, ${actor}.`,
    `${actor} just turned a simple ${key} into a full orbital event for ${subject}.`,
  ];
  const base=variants[Math.abs(index)%variants.length]!;
  return index<variants.length?base:`${base} Flight ${index+1} logged.`;
}

export class StreamWeaverBicCommandExecutor implements StreamWeaverCapabilityExecutorV1 {
  constructor(private readonly bic: StreamWeaverBicRuntime) {}
  execute(invocation: StreamWeaverDonorCommandInvocationV1): Promise<string | undefined> {
    if (invocation.canonicalTrigger !== "!bic") return Promise.resolve(undefined);
    return this.bic.fromCommand(invocation);
  }
}

/** Economy can call this after a canonical !roll settlement without recreating a second gamble path. */
export async function recordStreamWeaverRollSocialAction(client: Pick<SpmtClient, "publishEvent">, input: { tenantId: string; settlementId: string; userId: string; roll: number; won: boolean }): Promise<void> {
  const action = STREAMWEAVER_DONOR_SOCIAL_ACTIONS.find((candidate) => candidate.id === "4d8cf691-44d3-43eb-86fa-69d64578d2cb");
  if (!action) throw new Error("Frozen _roll donor action is missing");
  await client.publishEvent(input.tenantId, STREAMWEAVER_DONOR_ACTION_FIRED, {
    schemaVersion: 1,
    donorActionId: action.id,
    donorActionName: action.name,
    trigger: "!roll",
    settlementId: safeId(input.settlementId, "settlementId"),
    userId: safeId(input.userId, "userId"),
    roll: boundedInt(input.roll, 0, 100),
    won: input.won,
  }, `streamweaver-donor-action:${action.id}:${input.settlementId}`);
}

function donorBicMessage(thief: string, result: StreamWeaverBicMutationV1): string { return `${safeDisplay(thief)} has stolen ${result.total} lighters, of those ${result.userCount} have been ${result.target}'s`; }
function safeUsername(value: unknown): string { const result = String(value ?? "").trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 80); if (!result) throw new Error("Bic target is required"); return result; }
function safeId(value: unknown, field: string): string { const result = String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 200); if (!result) throw new Error(`${field} is required`); return result; }
function safeToken(value: unknown): string { return String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 100) || "unknown"; }
function safeDisplay(value: unknown): string { return String(value ?? "").trim().replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 120) || "Streamer"; }
function boundedInt(value: unknown, min: number, max: number): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error("Integer value is outside the allowed range"); return result; }
