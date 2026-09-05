import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AuthService } from "@spmt/auth-core";
import { AuthorityService } from "@spmt/authority-core";
import { SqliteAuthorityStore } from "@spmt/authority-sqlite";
import { PlatformOperations } from "@spmt/platform-ops";
import { PlatformApiAdapter } from "@spmt/api-adapter";
import { SpmtClient } from "@spmt/sdk";
import { SIMULATION_ROOM_INPUT_CAPABILITY, assertSimulationRoomInputV1, type ExecutionJobV1, type SimulationRoomEventV1, type SimulationRoomInputJobV1 } from "@spmt/contracts";
import { StreamWeaverProviderRuntime, StreamWeaverBotActionConsumer, StreamWeaverFlowPackageStore, legacyCommunityPackages, SqliteStreamWeaverEconomyStore, type StreamWeaverBotActionExecutorV1 } from "@spmt/streamweaver";
import { NebulaArcadeProviderRuntime, NEBULA_ARCADE_GAMES, SqliteNebulaGameInputStore, SqliteNebulaTabletopRuntime, SqliteNebulaTagStore, SqliteNebulaTagExperienceStore, buildNebulaTagOverlaySnapshot } from "@spmt/nebula-arcade";
import { DshBotActionAdapter, DshSuiteActionOperations, respondDshApplicationInteraction, SqliteDshLiveMonitor, SqliteDshDiscordMessageStore, SqliteDshCalendarStore, SqliteDshApplicationStore, type DshDiscordTransportV1, type DshBotActionIdV1 } from "@spmt/discord-stream-hub";
import { HearMeOutWebSuiteActionExecutor, SqliteHearMeOutRoomMediaRuntime } from "@spmt/hearmeout";
import { ChatGatewayRuntime, SqliteChatGatewayStore, type ChatGatewayConsumerV1, type ChatGatewayMessageObserverV1 } from "./index.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const snowflake = (value: string) => (BigInt(`0x${hash(value).slice(0, 14)}`) + 100000000000000000n).toString();
type Sink = (event: SimulationRoomEventV1, idempotencyKey: string) => Promise<unknown>;

/** Real app handlers with room-local databases and capture-only provider transports. */
export class SimulationRoomRuntime {
  constructor(private readonly options: { directory: string; streamweaverDatabasePath?: string; publicOrigin?: string; publish: Sink }) {}
  async execute(job: ExecutionJobV1) {
    const input = job.input as unknown as SimulationRoomInputJobV1;
    assertSimulationRoomInputV1(input);
    if (job.capabilityId !== SIMULATION_ROOM_INPUT_CAPABILITY || job.ownerAppId !== "chat-gateway" || job.executionOwner !== "chat-gateway" || job.requestedByType !== "user" || input.schemaVersion !== 1 || input.actor?.userId !== job.requestedById || job.billedUserId !== job.requestedById || !["owner", "member"].includes(input.actor?.role) || !Array.isArray(input.appIds)) throw new Error("Invalid authenticated simulation input");
    const { tenantId } = job, { roomId, provider, actor } = input;
    const directory = join(this.options.directory, hash(`${tenantId}\0${roomId}\0${input.epoch ?? "initial"}`));
    mkdirSync(directory, { recursive: true });
    const path = (name: string) => join(directory, `${name}.sqlite`);
    const receipts = new DatabaseSync(path("receipts"));
    receipts.exec("CREATE TABLE IF NOT EXISTS inputs (id TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS source_settings (name TEXT PRIMARY KEY, digest TEXT NOT NULL); CREATE TABLE IF NOT EXISTS participants (user_id TEXT PRIMARY KEY, username TEXT NOT NULL)");
    // Never replay a partially executed command after a worker crash: its effects
    // may already exist. The user can deliberately send a new input instead.
    const prior = receipts.prepare("SELECT state FROM inputs WHERE id=?").get(job.id) as { state: string } | undefined;
    if (prior) { receipts.close(); if (prior.state !== "done") throw new Error("This input was interrupted. Review its room output before sending it again."); return { duplicate: true }; }
    receipts.prepare("INSERT INTO inputs VALUES (?, 'running')").run(job.id);
    const stores: Array<{ close(): void }> = [];
    let sequence = 0, outputs = 0;
    const emit = async (appId: string, event: Omit<SimulationRoomEventV1, "roomId" | "schemaVersion" | "occurredAt">) => {
      await this.options.publish({ schemaVersion: 1, occurredAt: new Date().toISOString(), ...event, body: event.body || event.title, roomId, roomName: "Preview Studio", data: { ...event.data, tenantId, appId, inputId: job.id, epoch: input.epoch ?? "initial" } }, `studio:${job.id}:${sequence++}`);
    };
    try {
      await emit("chat-gateway", { lane: "chat", direction: "ingress", title: actor.username, body: input.message, provider, data: { actor, messageId: job.id } });
      const authorityStore = new SqliteAuthorityStore(path("authority")); stores.push(authorityStore);
      const authority = new AuthorityService({ store: authorityStore }), auth = new AuthService({ store: authorityStore });
      authority.ensureUser(actor.userId);
      receipts.prepare("INSERT OR REPLACE INTO participants VALUES(?,?)").run(actor.userId,actor.username);
      if (provider !== "kick") authority.linkProvider(actor.userId, provider, snowflake(actor.userId));
      const token = auth.issueHumanSession({ userId: actor.userId, tenantIds: [tenantId], scopes: ["*"] }).accessToken;
      const api = new PlatformApiAdapter(new PlatformOperations(auth, authority));
      const client = (appId: string) => new SpmtClient({ baseUrl: "https://simulation.invalid", appId, getAccessToken: () => token, fetchImpl: async (url, init) => {
        const parsed = new URL(String(url));
        if (parsed.origin !== "https://simulation.invalid") throw new Error("External requests are unavailable in this room");
        if (parsed.pathname === "/v1/identity/provider") {
          const user = authorityStore.getProviderLink(parsed.searchParams.get("provider") as "discord" | "twitch", parsed.searchParams.get("providerUserId") ?? "");
          return Response.json(user ? { userId: user.userId } : { message: "That test participant is not present" }, { status: user ? 200 : 404 });
        }
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        const result = api.handle({ method: init?.method ?? "GET", path: parsed.pathname + parsed.search, headers: Object.fromEntries(new Headers(init?.headers)), body });
        if (parsed.pathname === "/v1/events" && init?.method === "POST" && result.status < 300) await emit(appId, { lane: "app", direction: "preview", title: String(body.type), body: "", provider, data: { eventType: body.type, payload: body.payload } });
        return Response.json(result.body ?? {}, { status: result.status });
      } });
      const send = (appId: string) => async (message: { text: string; provider: "twitch" | "discord" | "kick"; idempotencyKey: string }) => {
        const providerMessageId = snowflake(message.idempotencyKey);
        await emit(appId, { lane: "chat", direction: "egress", title: appId, body: message.text, provider: message.provider, data: { providerMessageId, operation: "create", payload: { content: message.text } } });
        outputs++;
        return { providerMessageId };
      };
      const guildId = snowflake(`${tenantId}:${roomId}:guild`), channelId = snowflake(`${tenantId}:${roomId}:${provider}`), connectionId = "simulation";
      const discord = (appId: string): DshDiscordTransportV1 => {
        const capture = async (operation: string, destination: string, payload: Record<string, unknown>, messageId = snowflake(`${job.id}:${sequence}`)) => {
          await emit(appId, { lane: "chat", direction: "egress", title: appId, body: String(payload.content ?? ""), provider: "discord", channelId: destination, data: { operation, payload, providerMessageId: messageId } }); outputs++; return messageId;
        };
        return { listGuilds: async () => [{ id: guildId, name: "Simulation server" }], listGuildChannels: async () => [{ id: channelId, name: "simulation-chat", type: 0 }], createMessage: async (_t, c, p) => capture("create", c, p), editMessage: async (_t, c, m, p) => capture("edit", c, p, m), deleteMessage: async (_t, c, m) => { await capture("delete", c, {}, m); }, sendDirectMessage: async (_t, u, p) => capture("dm", u, p) };
      };
      const monitor = new SqliteDshLiveMonitor(path("dsh")), messages = new SqliteDshDiscordMessageStore(path("dsh")), calendar = new SqliteDshCalendarStore(path("dsh")), applications = new SqliteDshApplicationStore(path("dsh"));
      stores.push(monitor, messages, calendar, applications);
      const dshConfig = { schemaVersion: 1 as const, pollIntervalSeconds: 60, tenants: [{ tenantId, twitchProviderUserId: "simulation", discordProviderUserId: "simulation", discordGuildIds: [guildId], branding: { communityMemberName: "Mountaineer" }, members: [] }] };
      const dsh = new DshBotActionAdapter(new DshSuiteActionOperations({ config: dshConfig, monitor, messages, calendar, applications, discord: discord("discord-stream-hub"), applicationInteractionsReady: true }));
      const hmoRooms = new SqliteHearMeOutRoomMediaRuntime(path("hearmeout")); stores.push(hmoRooms);
      const hmoPrincipal = { tenantId, userId: actor.userId, displayName: actor.username, roles: ["member" as const] };
      hmoRooms.createRoom(hmoPrincipal, { roomId: `studio-${hash(actor.userId).slice(0, 12)}`, name: "Preview Studio", privacy: "public", operationId: `studio-room:${actor.userId}` });
      const hmo = new HearMeOutWebSuiteActionExecutor(hmoRooms, { resolve: async ({ query, lane }) => {
        let url: URL; try { url = new URL(query); } catch { throw new Error("Media search needs a connected provider. Use a direct media URL to test the room queue."); }
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use a public HTTPS media URL");
        return { itemId: hash(query), type: lane === "movie" ? "movie" : "music", title: query, source: "simulation-url", playbackUrl: url.href };
      } });
      const botActions: StreamWeaverBotActionExecutorV1 = { execute: async (request, context) => {
        const appId = request.action.startsWith("dsh.") ? "discord-stream-hub" : request.action.startsWith("hmo.") ? "hearmeout" : "streamweaver";
        if (!input.appIds.includes(appId)) return { response: `${appId} is not installed in this workspace.` };
        let result: Record<string, unknown>;
        try {
          if (request.action.startsWith("dsh.")) result = await dsh.execute({ tenantId, action: request.action as DshBotActionIdV1, actorUserId: actor.userId, actorRole: actor.role, args: { ...request.args, channel: request.args.channel || "simulation-chat", username: actor.username }, idempotencyKey: context.requestId });
          else if (request.action.startsWith("hmo.")) result = await hmo.execute({ schemaVersion: 1, action: request.action as Parameters<typeof hmo.execute>[0]["action"], actor, args: request.args, source: { kind: "chat", provider, channelId, requestId: context.requestId } }, { tenantId, idempotencyKey: context.requestId });
          else throw new Error("External image generation is unavailable in this simulation room.");
        } catch (error) { result = { text: error instanceof Error ? error.message : String(error), unavailable: true }; }
        await emit(appId, { lane: "app", direction: "preview", title: request.action, body: String(result.text ?? ""), provider, data: { action: request.action, result } });
        return { response: String(result.text ?? "Action completed."), result };
      } };
      const consumers: ChatGatewayConsumerV1[] = [], observers: ChatGatewayMessageObserverV1[] = [];
      if (!input.appIds.includes("streamweaver")) consumers.push(new StreamWeaverBotActionConsumer(botActions, {send:send("chat-gateway")}));
      if (input.appIds.includes("streamweaver")) {
        const flowPath = path("streamweaver");
        if (this.options.streamweaverDatabasePath) {
          const sourceEconomy = new SqliteStreamWeaverEconomyStore(this.options.streamweaverDatabasePath), testEconomy = new SqliteStreamWeaverEconomyStore(flowPath);
          try { const settings = sourceEconomy.getSettings(tenantId); if (settings) { const digest=hash(JSON.stringify(settings)), previous=receipts.prepare("SELECT digest FROM source_settings WHERE name='economy'").get() as {digest:string}|undefined; if(previous?.digest!==digest){testEconomy.putSettings(tenantId, settings);receipts.prepare("INSERT OR REPLACE INTO source_settings VALUES('economy',?)").run(digest);} } } finally { sourceEconomy.close(); testEconomy.close(); }
          const source = new StreamWeaverFlowPackageStore(this.options.streamweaverDatabasePath), target = new StreamWeaverFlowPackageStore(flowPath);
          try {
            for (const installed of target.listInstalls(tenantId)) target.uninstall(tenantId, installed.packageId);
            const builtins=new Set(legacyCommunityPackages().map(pkg=>pkg.packageId));
            for (const pkg of source.listInstalledPackages(tenantId)) { if(!builtins.has(pkg.packageId))target.saveDraft(tenantId, pkg, pkg.author); target.install(tenantId, pkg.packageId); }
          } finally { source.close(); target.close(); }
        }
        const runtime = new StreamWeaverProviderRuntime({ databasePath: flowPath, client: client("streamweaver"), egress: { send: send("streamweaver") }, botActions, allowAssistant: false });
        stores.push(runtime); consumers.push(...runtime.consumers); observers.push(...runtime.messageObservers);
      }
      if (input.appIds.includes("nebula-arcade")) {
        const dashboard = discord("nebula-arcade");
        const runtime = new NebulaArcadeProviderRuntime({
          publicOrigin: this.options.publicOrigin || "https://spmt.live",
          databasePath: path("nebula"), client: client("nebula-arcade"),
          config: { schemaVersion: 1, revision: "simulation-v1", tenants: [{ tenantId, pinUserId: actor.userId, channels: [{ provider, connectionId, channelId, stateChannelId: `studio-${provider}`, enabledGameIds: NEBULA_ARCADE_GAMES.map(game => game.id) }] }] },
          egress: { send: send("nebula-arcade") },
          discordDashboard: { publicOrigin: "https://simulation.invalid", egress: { upsertDiscordDashboard: async (message) => {
            const providerMessageId = message.previousMessageId ?? await dashboard.createMessage(tenantId, channelId, { ...message.payload });
            if (message.previousMessageId) await dashboard.editMessage(tenantId, channelId, message.previousMessageId, { ...message.payload });
            return { providerMessageId, transport: "bot" };
          } } },
        });
        stores.push(runtime); consumers.push(...runtime.consumers);
      }
      // Isolated ingress still uses the exact normalization, accepts(), and deliver()
      // contracts as live ingress. Provider network transports are never constructed.
      const chatStore = new SqliteChatGatewayStore(path("gateway")); stores.push(chatStore);
      const capture = send("chat-gateway");
      const gateway = new ChatGatewayRuntime(chatStore, consumers, (["twitch", "discord", "kick"] as const).map(provider => ({ provider, send: capture })), observers);
      if (input.interaction) {
        if (!input.appIds.includes("discord-stream-hub")) throw new Error("Discord Stream Hub is not installed");
        const interaction = input.interaction, result = respondDshApplicationInteraction({ config: dshConfig, store: applications, publicOrigin: this.options.publicOrigin || "https://spmt.live" }, { id: snowflake(job.id), type: interaction.customId.startsWith("application_submit:") ? 5 : 3, guild_id: guildId, member: { user: { id: snowflake(actor.userId), username: actor.username } }, data: { custom_id: interaction.customId, components: Object.entries(interaction.values ?? {}).map(([custom_id,value])=>({type:1,components:[{custom_id,value}]})) } });
        await emit("discord-stream-hub", { lane: "chat", direction: "egress", title: "Discord interaction", body: String(result.data?.content || result.data?.title || "Application inquiry"), provider: "discord", data: { operation: "create", providerMessageId: snowflake(job.id), payload: result.data ?? {}, interactionType: result.type } });
        receipts.prepare("UPDATE inputs SET state='done' WHERE id=?").run(job.id);
        return { outputs: 1 };
      }
      const mentions = [...input.message.matchAll(/(?:^|\s)@([a-zA-Z0-9_.-]{1,80})/g)].map(match => {
        const username=match[1]!, known=receipts.prepare("SELECT user_id FROM participants WHERE lower(username)=lower(?)").get(username) as {user_id:string}|undefined;
        return {token:`@${username}`,username,providerUserId:snowflake(known?.user_id || `mention:${username}`),...(known?{canonicalUserId:known.user_id}:{})};
      });
      const delivered = await gateway.ingest({ schemaVersion: 1, tenantId, provider, connectionId, channelId, sourceChannelId: channelId, messageId: job.id, text: input.message, mentions, occurredAt: job.createdAt, providerUserId: snowflake(actor.userId), canonicalUserId: actor.userId, username: actor.username, roles: actor.role === "owner" ? ["broadcaster", "moderator"] : ["member"] });
      if (input.appIds.includes("nebula-arcade")) {
        const tags = new SqliteNebulaTagStore(path("nebula")), experience = new SqliteNebulaTagExperienceStore(path("nebula"));
        try { const snapshot = buildNebulaTagOverlaySnapshot(tags.getState(tenantId).state, { viewerUserId: actor.userId }); await emit("nebula-arcade", { lane: "overlay", direction: "preview", title: "Nebula Arcade Tag overlay", body: "", provider, data: { renderer: "nebula-tag", snapshot, messages: experience.listOverlayMessages(tenantId, channelId, 0).slice(-50) } }); } finally { tags.close(); experience.close(); }
      }
      if (input.appIds.includes("nebula-arcade")) {
        const feed = new SqliteNebulaGameInputStore(path("nebula")), tabletop = new SqliteNebulaTabletopRuntime(path("nebula"));
        try { const inputs = feed.list(tenantId).slice(-50); while (inputs.length > 1 && JSON.stringify(inputs).length > 24000) inputs.shift(); await emit("nebula-arcade", { lane: "overlay", direction: "preview", title: "Arcade widgets", body: "", provider, data: { renderer: "nebula-arcade", inputs, tabletop: tabletop.snapshot(tenantId, channelId, actor.userId) } }); } finally { feed.close(); tabletop.close(); }
      }
      if (delivered.delivery.failed) throw new Error("An app could not process this input. Its successful outputs are retained in the room; check the failed route before retrying.");
      if (!outputs) await emit("chat-gateway", { lane: "app", direction: "preview", title: "Routing result", body: input.message.startsWith("!") ? "No enabled command produced a response. Check that its flow is installed and its trigger matches. Provider-only and assistant actions require their connected runtime." : "Message delivered. No app produced an output for this message.", provider });
      receipts.prepare("UPDATE inputs SET state='done' WHERE id=?").run(job.id);
      return { delivery: delivered.delivery, duplicate: delivered.duplicate, outputs };
    } finally { for (const resource of stores.reverse()) resource.close(); receipts.close(); }
  }
}

export class SimulationRoomWorker {
  private readonly startedAt = new Date().toISOString();
  constructor(private readonly client: SpmtClient, private readonly runtime: SimulationRoomRuntime, private readonly workerId: string) {}
  async runOnce() {
    await this.client.reportExecutionWorker({ executionOwner: "chat-gateway", workerId: this.workerId, executionTarget: "sprite", state: "ready", capabilityIds: [SIMULATION_ROOM_INPUT_CAPABILITY], providerHealthy: true, startedAt: this.startedAt, leaseMs: 60_000, metrics: { completedJobs: 0, failedJobs: 0, inputUnits: 0, outputUnits: 0 } });
    const job = await this.client.claimAnyExecutionJob(this.workerId, "sprite", { executionOwner: "chat-gateway", capabilityIds: [SIMULATION_ROOM_INPUT_CAPABILITY], leaseMs: 600_000 });
    if (!job?.leaseId) return;
    const lease = [job.tenantId, job.id, this.workerId, job.leaseId, job.fencingEpoch] as const;
    const heartbeat = setInterval(() => { void this.client.heartbeatExecutionJob(...lease, undefined, 600_000).catch(() => undefined); }, 30_000);
    try { await this.client.succeedExecutionJob(...lease, await this.runtime.execute(job)); }
    catch (error) { await this.client.failExecutionJob(...lease, "simulation_input_failed", error instanceof Error ? error.message : String(error), false); }
    finally { clearInterval(heartbeat); }
  }
}
