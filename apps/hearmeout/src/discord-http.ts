import {HEARMEOUT_SINGLE_PROGRAM_ID,type HearMeOutBroadcastProgram} from "./broadcast-program.js";
import type {HearMeOutSuiteMediaResolverV1} from "./suite-action-executor.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SpmtApiError, type SpmtClient } from "@spmt/sdk";
import { resolveProviderIdentity } from "@spmt/sdk/provider-identity";
import { setTimeout, clearTimeout } from "node:timers";
import type { HearMeOutActivityBinding } from "./activity-web.js";
import type { SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";
import { HearMeOutDiscordInteractionRouter, verifyHearMeOutDiscordInteraction, type HearMeOutDiscordInteractionResultV1 } from "./discord-interactions.js";

/** Only operator-bound guilds reach the existing room and suite-job owners. */
export class HearMeOutDiscordHttp {
  private readonly router: HearMeOutDiscordInteractionRouter;
  private readonly pending = new Set<Promise<void>>();
  private deliveryFailed = false;
  constructor(private readonly options: { binding: HearMeOutActivityBinding; publicKeyHex: string; rooms: SqliteHearMeOutRoomMediaRuntime; client: SpmtClient; singleProgram?: HearMeOutBroadcastProgram; media?: HearMeOutSuiteMediaResolverV1; readOnly?: boolean; fetchImpl?: typeof fetch; deferAfterMs?: number }) {
    if (!/^\d{5,30}$/.test(options.binding.clientId) || !options.binding.tenantId || !options.binding.guildIds?.length || options.binding.guildIds.some(id => !/^\d{5,30}$/.test(id))) throw new Error("HearMeOut Discord requires a community, application and allowed guilds");
    this.router = new HearMeOutDiscordInteractionRouter({
      singleProgram:options.singleProgram, publicKeyHex: options.publicKeyHex, rooms: options.rooms, readOnly: options.readOnly === true,
      tenants: { resolve: input => input.applicationId === options.binding.clientId && input.guildId && options.binding.guildIds!.includes(input.guildId) ? options.binding.tenantId : undefined },
      principals: { resolve: async input => {
        try {
          const identity = await resolveProviderIdentity(options.client, input.tenantId, "discord", input.discordUserId);
          return { userId: identity.userId, displayName: identity.profile.displayName, tenantRole: identity.tenantRole ?? null };
        } catch (error) { if (error instanceof SpmtApiError && error.status === 404) return undefined; throw error; }
      } },
      requestMedia: async input => {
        if(options.singleProgram){if(!options.media)throw Error("The media worker is unavailable");await options.singleProgram.request({requesterId:input.principal.userId,displayName:input.principal.displayName,query:input.query,operationId:"discord:"+input.interactionId},options.media);return{jobId:HEARMEOUT_SINGLE_PROGRAM_ID};}
        const created = await options.client.createSuiteActionJob(input.principal.tenantId, {
          schemaVersion: 1, action: "hmo.media.request", args: { query: input.query, lane: input.lane, roomId: input.roomId },
          actor: { userId: input.principal.userId, username: input.principal.displayName, role: input.principal.roles.includes("admin") ? "admin" : "member" },
          source: { kind: "hearmeout", provider: "discord", guildId: input.guildId, channelId: input.channelId, requestId: input.interactionId, roomId: input.roomId },
        }, `hearmeout-discord:${input.interactionId}`);
        return { jobId: created.job.id };
      },
    });
  }
  status() { return { configured: true, pendingResponses: this.pending.size, responseDeliveryFailed: this.deliveryFailed, readOnly: this.options.readOnly === true }; }
  async close() { await Promise.allSettled([...this.pending]); }
  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!["/api/discord/interactions", "/api/hearmeout/discord/interactions"].includes(url.pathname)) return false;
    if (request.method !== "POST") { send(response, 405, { error: "method_not_allowed" }); return true; }
    const signature = String(request.headers["x-signature-ed25519"] ?? ""), timestamp = String(request.headers["x-signature-timestamp"] ?? "");
    // Signed retries are accepted within Discord's response window. Expired
    // captured interactions cannot be replayed after normal operation pruning.
    if (!/^\d{1,12}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) { send(response, 401, { error: "invalid_signature" }); return true; }
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of request) { const bytes = Buffer.from(chunk); length += bytes.length; if (length > 64 * 1024) { send(response, 413, { error: "body_too_large" }); return true; } chunks.push(bytes); }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    if (!verifyHearMeOutDiscordInteraction(rawBody, signature, timestamp, this.options.publicKeyHex)) { send(response, 401, { error: "invalid_signature" }); return true; }
    let body: Record<string, any>;
    try { body = JSON.parse(rawBody); if (!body || typeof body !== "object" || Array.isArray(body)) throw Error(); }
    catch { send(response, 400, { error: "invalid_json" }); return true; }
    const result = this.router.handle({ rawBody, signature, timestamp }).catch((): HearMeOutDiscordInteractionResultV1 => ({ status: 200, body: { type: 4, data: { content: "HearMeOut could not complete this request. Retry after the service reconnects.", flags: 64, allowed_mentions: { parse: [] } } } }));
    // Non-mutating modals return immediately from the router. Identity and job
    // calls can defer; use the original interaction token only at Discord.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const immediate = await Promise.race([result, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), this.options.deferAfterMs ?? 1_200); })]);
    if (timer) clearTimeout(timer);
    if (immediate) { send(response, immediate.body.type ? 200 : immediate.status, immediate.body); return true; }
    if (body.application_id !== this.options.binding.clientId || typeof body.token !== "string" || !/^[A-Za-z0-9._-]{10,2048}$/.test(body.token)) {
      send(response, 200, { type: 4, data: { content: "This interaction cannot receive a delayed reply.", flags: 64 } }); return true;
    }
    send(response, 200, { type: 5, data: { flags: 64 } });
    const completion = result.then(async answer => {
      const data = answer.body.data as Record<string, unknown> | undefined;
      const reply = await (this.options.fetchImpl ?? fetch)(`https://discord.com/api/v10/webhooks/${this.options.binding.clientId}/${encodeURIComponent(body.token)}/messages/@original`, {
        method: "PATCH", headers: { "content-type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ ...(data ?? { content: "HearMeOut could not complete this interaction." }), allowed_mentions: { parse: [] } }),
      });
      if (!reply.ok) throw new Error("Discord response delivery failed");
      this.deliveryFailed = false;
    }).catch(() => { this.deliveryFailed = true; }).finally(() => { this.pending.delete(completion); });
    this.pending.add(completion);
    return true;
  }
}
function send(response: ServerResponse, status: number, body: Record<string, unknown>) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
