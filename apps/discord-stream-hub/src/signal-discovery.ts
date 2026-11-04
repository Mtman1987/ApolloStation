import { SpmtClient } from "@spmt/sdk";

export const LOST_SIGNAL_MESSAGE_REQUESTED = "dsh.discord.lost-signal-message.requested.v1";

export interface DiscordMessageCandidateV1 { messageId: string; channelId: string; authorUserId: string; createdAt: string; }

export function chooseLostSignalMessage(candidates: readonly DiscordMessageCandidateV1[], random: () => number = Math.random) {
  const eligible = candidates.filter((item) => item.messageId && item.channelId && item.authorUserId && Number.isFinite(Date.parse(item.createdAt)));
  if (!eligible.length) return undefined;
  return eligible[Math.min(eligible.length - 1, Math.floor(Math.max(0, Math.min(.999999, random())) * eligible.length))];
}

export async function requestRandomLostSignalMessage(client: SpmtClient, tenantId: string, userId: string, candidates: readonly DiscordMessageCandidateV1[], signalUrl: string, random: () => number = Math.random) {
  const target = chooseLostSignalMessage(candidates, random);
  if (!target) return { requested: false as const, reason: "no-eligible-message" };
  const parsed = new URL(signalUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("signalUrl must be a credential-free HTTPS URL");
  await client.publishEvent(tenantId, LOST_SIGNAL_MESSAGE_REQUESTED, {
    schemaVersion: 1,
    userId,
    targetMessageId: target.messageId,
    targetChannelId: target.channelId,
    presentation: "hidden-link",
    signalUrl: parsed.toString(),
  }, `lost-signal-message:${userId}:${target.messageId}`);
  return { requested: true as const, target };
}
