import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";
import type { StreamWeaverCommandEgressV1, StreamWeaverCommandIdentityResolverV1, StreamWeaverCommandStateV1 } from "./command-router.js";
import { STREAMWEAVER_DONOR_COMMANDS, canonicalDonorCommandTrigger, type StreamWeaverDonorCommandV1 } from "./donor-command-catalog.js";

export interface StreamWeaverDonorCommandInvocationV1 {
  tenantId: string;
  deliveryId: string;
  command: StreamWeaverDonorCommandV1;
  canonicalTrigger: string;
  args: string[];
  rawText: string;
  actor: { userId?: string; providerUserId: string; username: string; displayName: string; isModerator: boolean; isBroadcaster: boolean };
  target?: { userId?: string; providerUserId: string; username: string };
  provider: NormalizedChatMessageV1["provider"];
  connectionId: string;
  channelId: string;
}

export interface StreamWeaverDonorCommandExecutionV1 { text?: string; handled?: boolean; }
export interface StreamWeaverDonorCommandServicesV1 {
  execute(invocation: StreamWeaverDonorCommandInvocationV1): Promise<StreamWeaverDonorCommandExecutionV1 | string | undefined> | StreamWeaverDonorCommandExecutionV1 | string | undefined;
}
export interface StreamWeaverDonorRuntimeOptionsV1 {
  services: StreamWeaverDonorCommandServicesV1;
  identities: StreamWeaverCommandIdentityResolverV1;
  state: StreamWeaverCommandStateV1;
  egress: StreamWeaverCommandEgressV1;
  nowMs?: () => number;
  random?: () => number;
  botNames?: string[];
}

type DonorInvocationCommonV1 = {
  delivery: NormalizedChatDeliveryV1;
  actorId: string | undefined;
  mention: NormalizedChatMessageV1["mentions"][number] | undefined;
  targetId: string | undefined;
  actorName: string;
};

const ECONOMY_TRIGGERS = new Set(["!points","!pleader","!givepoints","!stealpoints","!gamble","!gambel","!roll","!addpoints","!setpoints","!addtoall","!settoall","!resetallpoints"]);
const BUILTIN_SOCIAL: Record<string, (actor: string, target?: string) => string> = {
  "!boop": (actor,target) => target ? `${actor} boops ${target}!` : `${actor} sends a boop into chat!`,
  "!cuddle": (actor,target) => target ? `${actor} cuddles ${target}!` : `${actor} is looking for a cuddle!`,
  "!dance": (actor,target) => target ? `${actor} pulls ${target} onto the dance floor!` : `${actor} starts dancing!`,
  "!fistbump": (actor,target) => target ? `${actor} fist bumps ${target}!` : `${actor} offers chat a fist bump!`,
  "!headpat": (actor,target) => target ? `${actor} gives ${target} a headpat!` : `${actor} offers headpats!`,
  "!highfive": (actor,target) => target ? `${actor} high-fives ${target}!` : `${actor} throws up a high five!`,
  "!hug": (actor,target) => target ? `${actor} hugs ${target}!` : `${actor} sends chat a hug!`,
  "!love": (actor,target) => target ? `${actor} sends love to ${target}!` : `${actor} sends love to chat!`,
  "!tickle": (actor,target) => target ? `${actor} tickles ${target}!` : `${actor} unleashes tickles on chat!`,
};

/** Executes every frozen donor trigger outside the canonical economy consumer. */
export class StreamWeaverDonorCommandConsumer {
  readonly id = "streamweaver.donor-commands" as const;
  private readonly nowMs: () => number;
  private readonly random: () => number;
  private readonly botNames: string[];
  constructor(private readonly options: StreamWeaverDonorRuntimeOptionsV1) {
    this.nowMs = options.nowMs ?? Date.now;
    this.random = options.random ?? Math.random;
    this.botNames = (options.botNames ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean);
  }

  accepts(message: NormalizedChatMessageV1) {
    if (message.actor.isBot) return false;
    return this.matchDefinitions(message.text).some((entry) => !ECONOMY_TRIGGERS.has(canonicalDonorCommandTrigger(entry.trigger)));
  }

  async deliver(delivery: NormalizedChatDeliveryV1) {
    const existing = this.options.state.getReceipt(delivery.message.tenantId, delivery.deliveryId);
    if (existing) { if (existing.text) await this.send(delivery, existing.text); return; }
    const result = await this.route(delivery);
    if (!result) return;
    this.options.state.putReceipt({ tenantId: delivery.message.tenantId, deliveryId: delivery.deliveryId, command: result.command, text: result.text ?? "", createdAt: new Date(this.nowMs()).toISOString() });
    if (result.text) await this.send(delivery, result.text);
  }

  async route(delivery: NormalizedChatDeliveryV1): Promise<{ command: string; text?: string } | undefined> {
    const message = delivery.message;
    const matches = this.matchDefinitions(message.text).filter((entry) => !ECONOMY_TRIGGERS.has(canonicalDonorCommandTrigger(entry.trigger)));
    if (!matches.length) return undefined;
    const commands = distinctEffectDefinitions(matches);
    const command = commands[0];
    if (!command) return undefined;
    const canonicalTrigger = canonicalDonorCommandTrigger(command.trigger);
    const actorId = message.actor.canonicalUserId ?? await this.options.identities.resolve({ tenantId: message.tenantId, provider: message.provider, providerUserId: message.actor.providerUserId, username: message.actor.username, ...(message.actor.displayName ? { displayName: message.actor.displayName } : {}) });
    const mention = message.mentions[0];
    const targetId = mention?.canonicalUserId ?? (mention ? await this.options.identities.resolve({ tenantId: message.tenantId, provider: message.provider, providerUserId: mention.providerUserId, username: mention.username }) : undefined);
    const actorName = message.actor.displayName ?? message.actor.username;
    const cooldown = this.cooldown(command, message.tenantId, actorId ?? message.actor.providerUserId);
    if (cooldown > 0) return { command: canonicalTrigger, text: `@${actorName}, wait ${cooldown}s before using ${displayTrigger(command)} again.` };

    const common: DonorInvocationCommonV1 = { delivery, actorId, mention, targetId, actorName };
    const primary = this.invocation(command, common);
    const builtin = this.builtin(primary);
    const primaryResult = normalizeExecution(await this.options.services.execute(primary));
    let secondaryText: string | undefined;
    for (const secondary of commands.slice(1)) {
      const result = normalizeExecution(await this.options.services.execute(this.invocation(secondary, common)));
      secondaryText ??= result.text;
    }
    const text = primaryResult.text ?? builtin ?? secondaryText;
    if (primaryResult.handled === false && !text && commands.length === 1) return undefined;
    this.markCooldown(command, message.tenantId, actorId ?? message.actor.providerUserId);
    return { command: canonicalTrigger, ...(text ? { text } : {}) };
  }

  private invocation(command: StreamWeaverDonorCommandV1, common: DonorInvocationCommonV1): StreamWeaverDonorCommandInvocationV1 {
    const message = common.delivery.message;
    return {
      tenantId: message.tenantId,
      deliveryId: common.delivery.deliveryId,
      command,
      canonicalTrigger: canonicalDonorCommandTrigger(command.trigger),
      args: parseArgs(message.text, command),
      rawText: message.text,
      actor: {
        ...(common.actorId ? { userId: common.actorId } : {}), providerUserId: message.actor.providerUserId, username: message.actor.username, displayName: common.actorName,
        isModerator: message.actor.roles.includes("moderator") || message.actor.roles.includes("broadcaster"), isBroadcaster: message.actor.roles.includes("broadcaster"),
      },
      ...(common.mention ? { target: { ...(common.targetId ? { userId: common.targetId } : {}), providerUserId: common.mention.providerUserId, username: common.mention.username } } : {}),
      provider: message.provider, connectionId: message.connectionId, channelId: message.channelId,
    };
  }

  private builtin(invocation: StreamWeaverDonorCommandInvocationV1) {
    const actor = `@${invocation.actor.displayName}`;
    const target = invocation.target ? `@${invocation.target.username}` : undefined;
    const social = BUILTIN_SOCIAL[invocation.canonicalTrigger];
    if (social) return social(actor, target);
    switch (invocation.canonicalTrigger) {
      case "!coinflip": return `${actor} flipped ${this.random() < 0.5 ? "heads" : "tails"}.`;
      case "!time": return `Current UTC time: ${new Date(this.nowMs()).toISOString().replace("T", " ").slice(0, 19)} UTC`;
      case "!commands": return "Commands are available through StreamWeaver. Use the command directory for the full tenant-enabled list.";
      case "!lurk": return `${actor} is lurking. Thanks for hanging out!`;
      case "!unlurk": return `${actor} is back from lurking!`;
      case "!hydrate": return `💧 ${actor}, hydration check!`;
      case "!stretch": return `🧘 ${actor}, stretch check!`;
      default: return undefined;
    }
  }

  private matchDefinitions(text: string) {
    const trimmed = text.trim(); const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
    return STREAMWEAVER_DONOR_COMMANDS.filter((entry) => {
      if (entry.matcher === "bare") return trimmed.toLowerCase() === entry.trigger.toLowerCase() || first === `!${entry.trigger.toLowerCase()}`;
      if (entry.matcher === "regex") return donorRegexMatch(entry, trimmed, this.botNames);
      if (first === entry.trigger.toLowerCase()) return true;
      return entry.aliases?.some((alias) => alias.toLowerCase() === first) ?? false;
    });
  }
  private cooldown(command: StreamWeaverDonorCommandV1, tenantId: string, actorId: string) { if (!command.cooldownSeconds) return 0; const last=this.options.state.getCooldown(`donor:${tenantId}:${actorId}:${canonicalDonorCommandTrigger(command.trigger)}`); const remaining=command.cooldownSeconds*1000-(this.nowMs()-last); return remaining>0?Math.ceil(remaining/1000):0; }
  private markCooldown(command: StreamWeaverDonorCommandV1, tenantId: string, actorId: string) { if (command.cooldownSeconds) this.options.state.putCooldown(`donor:${tenantId}:${actorId}:${canonicalDonorCommandTrigger(command.trigger)}`,this.nowMs()); }
  private send(delivery: NormalizedChatDeliveryV1, text: string) { const outbound: OutboundChatMessageV1={schemaVersion:1,tenantId:delivery.message.tenantId,provider:delivery.message.provider,connectionId:delivery.message.connectionId,channelId:delivery.message.channelId,text,idempotencyKey:`streamweaver-donor-command:${delivery.deliveryId}`,replyToMessageId:delivery.message.messageId}; return this.options.egress.send(outbound); }
}

function normalizeExecution(value: StreamWeaverDonorCommandExecutionV1 | string | undefined): StreamWeaverDonorCommandExecutionV1 { if(typeof value==="string")return{handled:true,text:value};return value??{handled:false}; }
function distinctEffectDefinitions(matches: StreamWeaverDonorCommandV1[]) { const seen=new Set<string>(); const result:StreamWeaverDonorCommandV1[]=[]; for(const entry of matches){const key=`${canonicalDonorCommandTrigger(entry.trigger)}:${entry.family}`;if(seen.has(key))continue;seen.add(key);result.push(entry);} return result; }
function parseArgs(text:string,command:StreamWeaverDonorCommandV1){if(command.matcher==="regex")return[];const parts=text.trim().split(/\s+/);parts.shift();return parts;}
function displayTrigger(command:StreamWeaverDonorCommandV1){return command.matcher==="regex"?"that trigger":command.trigger.startsWith("!")?command.trigger:`!${command.trigger}`;}
function donorRegexMatch(entry:StreamWeaverDonorCommandV1,text:string,botNames:string[]){const id=entry.donorId;if(id==="secret-bird")return /@?bird/i.test(text);if(id==="secret-stickers")return /@?stickers/i.test(text);if(id==="secret-konami")return /@?UUDDLRLRAB/i.test(text);if(id.startsWith("persona-"))return botNames.some((name)=>text.toLowerCase().includes(name));return false;}
