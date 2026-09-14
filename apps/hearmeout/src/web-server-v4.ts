export * from "./web-server-v3.js";

import type { SpmtOperationModeV1 } from "@spmt/contracts";
import { preparedHearMeOutEnvironment } from "./prepared-media.js";
import { HearMeOutPersonaConversationCoordinator } from "./persona-conversation.js";
import { LiveHearMeOutPersonaPorts } from "./live-persona-adapter.js";
import { HttpHearMeOutVoiceBridgeWorker } from "./legacy-worker-adapter.js";
import { ResilientHearMeOutVoiceBridgeWorker } from "./voice-bridge-resilience.js";
import { createHearMeOutWebServer } from "./web-server-v3.js";

/**
 * Production bootstrap with live-donor parity wiring. The v3 HTTP/runtime
 * implementation remains authoritative; this bootstrap only supplies the
 * already-working donor persona transport instead of the sandbox fallback.
 */
export async function startHearMeOutWebServerFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const spmtOrigin = environment.SPMT_ORIGIN ?? "";
  const databasePath = environment.HEARMEOUT_ROOM_DATABASE_PATH ?? "";
  const operationMode: SpmtOperationModeV1 = environment.SPMT_OUTBOUND_MODE === "disabled" ? "read-only" : "active";
  if (!databasePath) throw new Error("HEARMEOUT_ROOM_DATABASE_PATH is required");

  const bridgeOrigin = environment.HEARMEOUT_VOICE_BRIDGE_ORIGIN;
  const bridgeAuthorization = environment.HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION;
  if (Boolean(bridgeOrigin) !== Boolean(bridgeAuthorization)) throw new Error("HearMeOut voice bridge origin and authorization must be configured together");

  const controlled = operationMode === "active" || environment.HEARMEOUT_CONTROLLED_BRIDGE === "1";
  const allowedTenantId = environment.HEARMEOUT_VOICE_BRIDGE_TENANT_ID;
  const worker = controlled && bridgeOrigin && bridgeAuthorization
    ? new HttpHearMeOutVoiceBridgeWorker({ workerOrigin: bridgeOrigin, getAuthorization: () => bridgeAuthorization, ...(allowedTenantId ? { allowedTenantIds: [allowedTenantId] } : {}) })
    : undefined;
  const voiceBridgeWorker = worker ? new ResilientHearMeOutVoiceBridgeWorker(worker) : undefined;

  const personaTenantId = allowedTenantId ?? environment.HEARMEOUT_ACTIVITY_TENANT_ID;
  const personaConversation = controlled && bridgeOrigin && bridgeAuthorization && personaTenantId
    ? new HearMeOutPersonaConversationCoordinator(new LiveHearMeOutPersonaPorts({
        tenantId: personaTenantId,
        workerOrigin: bridgeOrigin,
        getWorkerAuthorization: () => bridgeAuthorization,
        donorOrigin: environment.HEARMEOUT_LIVE_DONOR_ORIGIN ?? "https://hearmeout-main.fly.dev",
      }))
    : undefined;

  const preparedMedia = preparedHearMeOutEnvironment(environment);
  const host = createHearMeOutWebServer({
    spmtOrigin,
    databasePath,
    operationMode,
    ...(environment.HEARMEOUT_SINGLE_BROADCAST === "1" ? { singleBroadcast: { tenantId: environment.HEARMEOUT_ACTIVITY_TENANT_ID ?? "", executionUserId: environment.HEARMEOUT_BROADCAST_EXECUTION_USER_ID ?? "" } } : {}),
    ...(environment.HEARMEOUT_ACTIVITY_TENANT_ID && environment.DISCORD_CLIENT_ID ? { activity: { tenantId: environment.HEARMEOUT_ACTIVITY_TENANT_ID, clientId: environment.DISCORD_CLIENT_ID, guildIds: (environment.HEARMEOUT_DISCORD_GUILD_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean) } } : {}),
    ...(environment.DISCORD_PUBLIC_KEY ? { discordPublicKeyHex: environment.DISCORD_PUBLIC_KEY } : {}),
    ...(environment.HEARMEOUT_BROADCAST_CACHE_PATH ? { broadcast: { cachePath: environment.HEARMEOUT_BROADCAST_CACHE_PATH, ffmpegBinary: environment.HEARMEOUT_FFMPEG_BINARY ?? "/usr/bin/ffmpeg", ffprobeBinary: environment.HEARMEOUT_FFPROBE_BINARY ?? "/usr/bin/ffprobe", ...(preparedMedia ? { preparedMedia } : {}) } } : {}),
    port: Number(environment.PORT ?? 3200),
    host: environment.HOST ?? "127.0.0.1",
    buildSha: environment.BUILD_SHA ?? "dev",
    ...(environment.HEARMEOUT_WORKER_CREDENTIAL ? { credential: environment.HEARMEOUT_WORKER_CREDENTIAL } : {}),
    ...(voiceBridgeWorker ? { voiceBridgeWorker } : {}),
    ...(personaConversation ? { personaConversation } : {}),
    rtc: {
      ...(environment.HEARMEOUT_RTC_MAX_PARTICIPANTS ? { maxParticipants: Number(environment.HEARMEOUT_RTC_MAX_PARTICIPANTS) } : {}),
      ...(environment.LIVEKIT_URL && environment.LIVEKIT_API_KEY && environment.LIVEKIT_API_SECRET ? { livekit: { url: environment.LIVEKIT_URL, apiKey: environment.LIVEKIT_API_KEY, apiSecret: environment.LIVEKIT_API_SECRET } } : {}),
    },
  });
  await host.listen();
  return host;
}
