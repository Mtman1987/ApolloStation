import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";
import { beginLoungeCommandMenu, consumeLoungeCommandMenuChoice, directLoungeCommandCategory } from "./lounge-command-menu.js";
import { getLoungeMediaLayout, overrideLoungeMediaLayout, voteLoungeMediaLayout, type LoungeMediaLayoutMode } from "./lounge-media-layout.js";
import { prepareStellaLoungeReply } from "./stella-lounge-replies.js";

/** Tenants that run the 24-hour SpaceMountain Lounge channel. Ported from StreamWeaver chat-dispatcher. */
export function streamWeaverLoungeTenants(value = process.env.STREAMWEAVER_LOUNGE_TENANTS ?? "spacemountainlive"): Set<string> {
  return new Set(value.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
}
export function isStreamWeaverLoungeTenant(tenantId: string, tenants = streamWeaverLoungeTenants()): boolean { return tenants.has(tenantId.toLowerCase()); }

export interface StreamWeaverLoungeEgressV1 { send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>; }

const LOUNGE_PATTERN = /^(?:!commands(?:\s+[1-8])?|[1-8]|!votebump|!bump|!bump(?:media|stream)|!(?:media|hmo|stream|live)\s+big|!layout\s+auto)$/i;

type Reply = { text: string; as: "bot" | "broadcaster" };

/** Pure Lounge chat command handler; returns replies to send (empty when the message is not a Lounge command). */
export async function handleStreamWeaverLoungeCommand(message: Pick<NormalizedChatMessageV1, "text" | "provider" | "tenantId" | "channelId" | "actor">): Promise<Reply[]> {
  const text = message.text.trim();
  const isMod = message.actor.roles.includes("moderator") || message.actor.roles.includes("broadcaster");
  const username = message.actor.username;
  const platform = message.provider === "discord" ? "discord" : "twitch";
  const context = { platform, tenantId: message.tenantId, channelId: message.channelId, username, isMod } as const;
  const voter = message.actor.canonicalUserId ?? message.actor.providerUserId ?? username;
  const bot = (t: string): Reply[] => [{ text: t, as: "bot" }];

  if (/^!commands$/i.test(text)) return [{ text: beginLoungeCommandMenu(context), as: "broadcaster" }];
  const direct = directLoungeCommandCategory(text, isMod);
  if (direct) return direct.map((t) => ({ text: t, as: "broadcaster" as const }));
  if (/^[1-8]$/.test(text)) return (consumeLoungeCommandMenuChoice(text, context) ?? []).map((t) => ({ text: t, as: "broadcaster" as const }));

  const vote = async (target: LoungeMediaLayoutMode, label: string) => {
    const result = await voteLoungeMediaLayout(target, voter);
    if (!result.accepted) return bot("🔒 The Lounge layout is locked by a moderator. Mods can use !layout auto to reopen voting.");
    if (result.changed) return bot(`🚀 Vote passed — ${target === "media" ? "HearMeOut is now on the main stage and the current Spotlight is in the media box" : "the current Spotlight is back on the main stage and HearMeOut is in the media box"}.`);
    return bot(`🗳️ @${username} voted to bump ${label}. ${result.votes[target]}/${result.votes.required} votes.`);
  };
  if (/^!votebump$/i.test(text)) { const target = (await getLoungeMediaLayout()).mode === "media" ? "stream" : "media"; return vote(target, target === "media" ? "HearMeOut" : "the current Spotlight"); }
  const bumpVote = text.match(/^!bump(media|stream)$/i);
  if (bumpVote) { const target = bumpVote[1]!.toLowerCase() === "media" ? "media" : "stream"; return vote(target, target); }
  if (/^!bump$/i.test(text)) {
    if (!isMod) return bot(`@${username}, only the broadcaster or a moderator can use !bump.`);
    const target = (await getLoungeMediaLayout()).mode === "media" ? "stream" : "media";
    await overrideLoungeMediaLayout(target, username); await overrideLoungeMediaLayout("auto", username);
    return bot(target === "media" ? "✅ HearMeOut bumped to the main stage; the current Spotlight moved to the media box." : "✅ The current Spotlight bumped back to the main stage; HearMeOut moved to the media box.");
  }
  const override = text.match(/^!(media|hmo|stream|live)\s+big$|^!layout\s+auto$/i);
  if (override) {
    if (!isMod) return bot(`@${username}, only the broadcaster or a moderator can override the Lounge layout.`);
    const target = /^!layout/i.test(text) ? "auto" : /^(?:media|hmo)$/i.test(override[1] ?? "") ? "media" : "stream";
    await overrideLoungeMediaLayout(target, username);
    return bot(`✅ ${target === "auto" ? "Lounge layout voting is open again." : target === "media" ? "HearMeOut is locked to the main stage; the current Spotlight is in the media box." : "The current Spotlight is locked to the main stage; HearMeOut is in the media box."}`);
  }
  return [];
}

/** Chat-gateway consumer for Lounge tenants. Runs ahead of the generic donor !commands reply. */
export class StreamWeaverLoungeChatConsumer {
  readonly id = "streamweaver.lounge" as const;
  constructor(private readonly egress: StreamWeaverLoungeEgressV1, private readonly tenants = streamWeaverLoungeTenants()) {}
  /** True when this consumer owns the message, so other consumers should skip it. */
  willHandle(message: NormalizedChatMessageV1): boolean { return !message.actor.isBot && isStreamWeaverLoungeTenant(message.tenantId, this.tenants) && LOUNGE_PATTERN.test(message.text.trim()); }
  accepts(message: NormalizedChatMessageV1): boolean { return this.willHandle(message); }
  async deliver(delivery: NormalizedChatDeliveryV1): Promise<void> {
    const m = delivery.message;
    let replies: Reply[];
    try { replies = await handleStreamWeaverLoungeCommand(m); } catch (error) { replies = [{ text: `❌ Lounge command failed: ${error instanceof Error ? error.message : String(error)}`, as: "bot" }]; }
    let index = 0;
    for (const reply of replies) {
      const prepared = prepareStellaLoungeReply(reply.text, reply.as);
      await this.egress.send({ schemaVersion: 1, tenantId: m.tenantId, provider: m.provider, connectionId: m.connectionId, channelId: m.channelId, text: prepared.message, idempotencyKey: `streamweaver-lounge:${delivery.deliveryId}:${index++}`, replyToMessageId: m.messageId });
    }
  }
}
