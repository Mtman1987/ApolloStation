import { createPublicKey, verify } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildDshApplicationModal, buildDshInquiryMessage, normalizeDshApplicationAnswers, parseDshApplicationType } from "./application-flow.js";
import { SqliteDshApplicationStore } from "./applications.js";
import type { DshLiveRuntimeConfigV1 } from "./live-worker.js";

export class DshDiscordApplicationInteractions {
  constructor(private readonly options: { publicKey: string; publicOrigin: string; config: DshLiveRuntimeConfigV1; store: SqliteDshApplicationStore }) { if (!/^[a-f0-9]{64}$/i.test(options.publicKey)) throw new Error("DSH Discord interaction public key is invalid"); }
  async handle(request: IncomingMessage, response: ServerResponse, url: URL) {
    if (request.method !== "POST" || url.pathname !== "/api/discord-stream-hub/interactions") return false;
    const raw = await body(request, 1024 * 1024), timestamp = String(request.headers["x-signature-timestamp"] ?? ""), signature = String(request.headers["x-signature-ed25519"] ?? "");
    if (!timestamp || !/^[a-f0-9]{128}$/i.test(signature) || !verify(null, Buffer.concat([Buffer.from(timestamp), raw]), createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(this.options.publicKey, "hex")]), format: "der", type: "spki" }), Buffer.from(signature, "hex"))) return json(response, 401, { error: "invalid_signature" });
    const interaction = JSON.parse(raw.toString("utf8")) as Record<string, any>;
    return json(response, 200, respondDshApplicationInteraction(this.options, interaction));
  }
}
/** Shared Discord interaction behavior; the HTTP entry point verifies signatures first. */
export function respondDshApplicationInteraction(options: { publicOrigin: string; config: DshLiveRuntimeConfigV1; store: SqliteDshApplicationStore }, interaction: Record<string, any>): { type: number; data?: Record<string, any> } {
    if (interaction.type === 1) return ({ type: 1 });
    const customId = String(interaction.data?.custom_id ?? ""), [action, rawType, embeddedGuildId] = customId.split(":"), type = parseDshApplicationType(rawType), guildId = String(interaction.guild_id ?? embeddedGuildId ?? "");
    if (!type || !/^\d{5,30}$/.test(guildId) || embeddedGuildId !== guildId) return (ephemeral("This application action is invalid or belongs to another server."));
    const tenant = options.config.tenants.find((item) => (item.discordGuildIds?.length ? item.discordGuildIds.includes(guildId) : options.config.tenants.length === 1));
    if (!tenant) return (ephemeral("This Discord server is not connected to an SPMT tenant."));
    if (interaction.type === 3 && action === "application_inquiry") return ({ type: 4, data: { flags: 64, ...buildDshInquiryMessage(type, guildId, options.publicOrigin) } });
    if (interaction.type === 3 && action === "application_start") return ({ type: 9, data: buildDshApplicationModal(type, guildId) });
    if (interaction.type === 5 && action === "application_submit") {
      const answers: Record<string, unknown> = {}; for (const row of interaction.data?.components ?? []) for (const component of row.components ?? []) if (component.custom_id) answers[String(component.custom_id)] = component.value;
      const user = interaction.member?.user ?? interaction.user ?? {}, normalized = normalizeDshApplicationAnswers(type, answers);
      const saved = options.store.submit({ tenantId: tenant.tenantId, guildId, interactionId: String(interaction.id ?? ""), type, applicantDiscordId: String(user.id ?? ""), applicantUsername: String(user.global_name ?? user.username ?? user.id ?? "Discord member"), answers: normalized });
      return (ephemeral(saved.duplicate ? "Your application was already received." : "Application received. The SPMT owner can now review it privately in Discord Stream Hub."));
    }
    return (ephemeral("This application action is not available."));
}

function ephemeral(content: string) { return { type: 4, data: { flags: 64, content, allowed_mentions: { parse: [] } } }; }
function json(response: ServerResponse, status: number, value: unknown) { const encoded = Buffer.from(JSON.stringify(value)); response.writeHead(status, { "content-type": "application/json", "content-length": String(encoded.byteLength), "cache-control": "no-store" }); response.end(encoded); return true; }
function body(request: IncomingMessage, max: number) { return new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; let size = 0; request.on("data", (chunk: Buffer | string) => { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += part.length; if (size > max) { reject(new Error("Discord interaction is too large")); request.destroy(); return; } chunks.push(part); }); request.on("end", () => resolve(Buffer.concat(chunks))); request.on("error", reject); }); }
