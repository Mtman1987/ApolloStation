import type { NormalizedChatDeliveryV1, NormalizedChatMessageV1, OutboundChatMessageV1 } from "@spmt/contracts";
import type { NebulaTagRuntime } from "./nebula-tag-runtime.js";
import type { NebulaTagExperienceOutcomeV1 } from "./nebula-tag-experience.js";

export interface NebulaTagGatewayPortV1 {
  send(message: OutboundChatMessageV1): Promise<{ providerMessageId: string }>;
}

export interface NebulaTagGatewayConsumerV1 {
  id: "nebula.arcade.provider-ingress";
  accepts(message: NormalizedChatMessageV1): boolean;
  deliver(delivery: NormalizedChatDeliveryV1): Promise<void>;
}

type NebulaTagIngressResultV1 = Awaited<ReturnType<NebulaTagRuntime["ingest"]>> | NebulaTagExperienceOutcomeV1;
export interface NebulaTagIngressPortV1 { ingest(message: Parameters<NebulaTagRuntime["ingest"]>[0]): Promise<NebulaTagIngressResultV1>; }

export function createNebulaTagGatewayConsumer(runtime: NebulaTagIngressPortV1, gateway: NebulaTagGatewayPortV1, options: { acceptsTenant?: (tenantId: string) => boolean } = {}): NebulaTagGatewayConsumerV1 {
  return {
    id: "nebula.arcade.provider-ingress",
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
      if (result.kind === "command") throw new Error("Nebula Arcade tag runtime returned an unexecuted command");
      const reply = result.kind === "result"
        ? { code: result.result.code, message: result.result.message }
        : result;
      if (result.kind === "result" && result.result.kind === "record-activity") return;
      await sendReply(gateway, message, delivery.deliveryId, reply.code, reply.message);
    },
  };
}

async function sendReply(gateway: NebulaTagGatewayPortV1, message: NormalizedChatMessageV1, deliveryId: string, code: string, text: string): Promise<void> {
  await gateway.send({ schemaVersion: 1, tenantId: message.tenantId, provider: message.provider, connectionId: message.connectionId, channelId: message.channelId, text, idempotencyKey: "nebula-arcade-reply:" + deliveryId + ":" + code, replyToMessageId: message.messageId });
}

function actorKey(message: NormalizedChatMessageV1): string {
  return message.actor.canonicalUserId ?? providerActorKey(message.provider, message.actor.providerUserId);
}

function providerActorKey(provider: NormalizedChatMessageV1["provider"], providerUserId: string): string {
  return "provider:" + provider + ":" + providerUserId;
}
