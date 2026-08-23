import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";
import type { ChatTagRuntime } from "./chat-tag-runtime.js";
import type { ChatTagExperienceOutcomeV1 } from "./chat-tag-experience.js";

export interface ChatTagGatewayPortV1 {
  send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>;
}

export interface ChatTagGatewayConsumerV1 {
  id: "nebula.chat-tag";
  accepts(message: NormalizedChatMessageV1): boolean;
  deliver(delivery: NormalizedChatDeliveryV1): Promise<void>;
}

type ChatTagIngressResultV1 = Awaited<ReturnType<ChatTagRuntime["ingest"]>> | ChatTagExperienceOutcomeV1;
export interface ChatTagIngressPortV1 { ingest(message: Parameters<ChatTagRuntime["ingest"]>[0]): Promise<ChatTagIngressResultV1>; }

export function createChatTagGatewayConsumer(runtime: ChatTagIngressPortV1, gateway: ChatTagGatewayPortV1, options: { acceptsTenant?: (tenantId: string) => boolean } = {}): ChatTagGatewayConsumerV1 {
  return {
    id: "nebula.chat-tag",
    accepts(message) { return !message.actor.isBot && (options.acceptsTenant ? options.acceptsTenant(message.tenantId) : true); },
    async deliver(delivery) {
      const message = delivery.message;
      const result = await runtime.ingest({
        schemaVersion: 1,
        provider: message.provider,
        tenantId: message.tenantId,
        channelId: message.sourceChannelId ?? message.channelId,
        messageId: message.connectionId + ":" + message.messageId,
        userId: actorKey(message),
        username: message.actor.displayName ?? message.actor.username,
        text: message.text,
        occurredAt: message.occurredAt,
        roles: message.actor.roles,
        mentions: message.mentions.map((mention) => ({ token: mention.token, userId: mention.canonicalUserId ?? providerActorKey(message.provider, mention.providerUserId), username: mention.username })),
      });
      if (result.kind === "ignored") return;
      if (result.kind === "reply" || result.kind === "executed") {
        if (result.route === "overlay") return;
        await sendReply(gateway, message, delivery.deliveryId, result.code, result.message);
        return;
      }
      if (result.kind === "command") throw new Error("Chat Tag runtime returned an unexecuted command");
      const reply = result.kind === "result"
        ? { code: result.result.code, message: result.result.message }
        : result;
      if (result.kind === "result" && result.result.kind === "record-activity") return;
      await sendReply(gateway, message, delivery.deliveryId, reply.code, reply.message);
    },
  };
}

async function sendReply(gateway: ChatTagGatewayPortV1, message: NormalizedChatMessageV1, deliveryId: string, code: string, text: string): Promise<void> {
  await gateway.send({ schemaVersion: 1, tenantId: message.tenantId, provider: message.provider, connectionId: message.connectionId, channelId: message.channelId, text, idempotencyKey: "chat-tag-reply:" + deliveryId + ":" + code, replyToMessageId: message.messageId });
}

function actorKey(message: NormalizedChatMessageV1): string {
  return message.actor.canonicalUserId ?? providerActorKey(message.provider, message.actor.providerUserId);
}

function providerActorKey(provider: NormalizedChatMessageV1["provider"], providerUserId: string): string {
  return "provider:" + provider + ":" + providerUserId;
}
