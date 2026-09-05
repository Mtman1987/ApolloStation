import { dshDiscordRequestBody } from "./calendar-presentation.js";
import { createPublicKey, verify } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildDshApplicationModal, buildDshInquiryMessage, normalizeDshApplicationAnswers, parseDshApplicationType } from "./application-flow.js";
import { SqliteDshApplicationStore } from "./applications.js";
import type { DshLiveRuntimeConfigV1 } from "./live-worker.js";

export class DshDiscordApplicationInteractions {
  private readonly pending=new Set<Promise<void>>();
  async close(){await Promise.allSettled(this.pending);}
  constructor(private readonly options: { publicKey: string; publicOrigin: string; config: DshLiveRuntimeConfigV1; store: SqliteDshApplicationStore; respond?:(interaction:Record<string,any>)=>Promise<{type:number;data?:Record<string,any>}|undefined>; fetchImpl?:typeof fetch }) { if (!/^[a-f0-9]{64}$/i.test(options.publicKey)) throw new Error("DSH Discord interaction public key is invalid"); }
  async handle(request: IncomingMessage, response: ServerResponse, url: URL) {
    if (request.method !== "POST" || url.pathname !== "/api/discord-stream-hub/interactions") return false;
    const raw = await body(request, 1024 * 1024), timestamp = String(request.headers["x-signature-timestamp"] ?? ""), signature = String(request.headers["x-signature-ed25519"] ?? "");
    if (!timestamp || !/^[a-f0-9]{128}$/i.test(signature) || !verify(null, Buffer.concat([Buffer.from(timestamp), raw]), createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(this.options.publicKey, "hex")]), format: "der", type: "spki" }), Buffer.from(signature, "hex"))) return json(response, 401, { error: "invalid_signature" });
    const interaction = JSON.parse(raw.toString("utf8")) as Record<string, any>;
    const calendar=String(interaction.data?.custom_id??"").startsWith("calendar:"),defer=calendar&&(interaction.type===5||/^calendar:(previous|next):/.test(String(interaction.data?.custom_id)));
    const respond=async()=>await this.options.respond?.(interaction)??respondDshApplicationInteraction(this.options,interaction);
    if(defer){
      const month=interaction.type===3;
      if(!/^\d{5,30}$/.test(String(interaction.application_id??""))||! /^[A-Za-z0-9._-]{10,300}$/.test(String(interaction.token??"")))return json(response,200,ephemeral("Discord did not provide a valid response token."));
      json(response,200,{type:month?6:5,...(month?{}:{data:{flags:64}})});
      const task=(async()=>{const result=await respond().catch(error=>ephemeral(error instanceof Error?error.message:"Calendar update failed"));const payload=result.data??{},fetchImpl=this.options.fetchImpl??fetch;
        const body=await dshDiscordRequestBody(payload,fetchImpl),followup=month&&result.type!==7;
        const reply=await fetchImpl(`https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}${followup?"":"/messages/@original"}`,{method:followup?"POST":"PATCH",headers:body.headers,body:body.body,signal:AbortSignal.timeout(15000)});
        if(!reply.ok)throw new Error(`Discord interaction delivery failed (${reply.status})`);
      })();this.pending.add(task);void task.catch(()=>undefined).finally(()=>this.pending.delete(task));return true;
    }
    return json(response,200,await respond());
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
