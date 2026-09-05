import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { createDiscordStreamHubWebServer } from "../apps/discord-stream-hub/dist/web-server.js";
import { discordStreamHubCatalogRegistration } from "../apps/discord-stream-hub/dist/index.js";
import { createStreamWeaverWebServer } from "../apps/streamweaver/dist/web-server.js";
import { streamweaverCatalogRegistration } from "../apps/streamweaver/dist/index.js";

async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "spmt-app-controls-"));
  const dshDatabase = join(directory, "dsh.sqlite"), streamDatabase = join(directory, "streamweaver.sqlite"), configPath = join(directory, "dsh-config.json");
  const guildId = "123456789012345678", streamweaverCredential = "streamweaver-test-worker-credential-123456789";
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, pollIntervalSeconds: 60, tenants: [{ tenantId: "placeholder", twitchProviderUserId: "twitch-owner", discordProviderUserId: "discord-bot", discordGuildIds: [guildId], branding: { communityMemberName: "Crew" }, members: [] }] }));
  const spmt = createSpmtService({ databasePath: join(directory, "spmt.sqlite"), webhookKey: Buffer.alloc(32, 4), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.example", runtimeMode: "sandbox", sandboxOwnerUsername: "mtman1987", streamweaverProviderRuntimeEnabled: true, streamweaverWorkerCredential: streamweaverCredential, sandboxApps: [discordStreamHubCatalogRegistration("https://spmt.example/apps/discord-stream-hub"), streamweaverCatalogRegistration("https://spmt.example/apps/streamweaver")] });
  let dsh, streamweaver;
  try {
    await spmt.listen(); const spmtAddress = spmt.server.address(); assert.ok(spmtAddress && typeof spmtAddress !== "string"); const spmtBase = `http://127.0.0.1:${spmtAddress.port}`;
    await fetch(`${spmtBase}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "M.T.", username: "mtman1987", password: "sandbox-owner-password" }) });
    const login = await fetch(`${spmtBase}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "mtman1987", password: "sandbox-owner-password" }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0]; assert.ok(cookie);
    const session = await (await fetch(`${spmtBase}/v1/session`, { headers: { cookie } })).json(); const tenantId = session.tenantIds[0];
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, pollIntervalSeconds: 60, tenants: [{ tenantId, twitchProviderUserId: "twitch-owner", discordProviderUserId: "discord-bot", discordGuildIds: [guildId], branding: { communityMemberName: "Crew" }, members: [] }] }));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"), publicKeyHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
    dsh = createDiscordStreamHubWebServer({ spmtOrigin: spmtBase, host: "127.0.0.1", port: 0, databasePath: dshDatabase, runtimeConfigPath: configPath, publicOrigin: "https://spmt.example", discordPublicKey: publicKeyHex, discordClientId: "222222222222222222" });
    streamweaver = createStreamWeaverWebServer({ spmtOrigin: spmtBase, host: "127.0.0.1", port: 0, databasePath: streamDatabase, credential: streamweaverCredential, operationMode: "read-only", connectionsJson: JSON.stringify([{ schemaVersion: 1, tenantId, provider: "twitch", connectionId: "main", channelId: "mtman1987", providerAccountId: "twitch-owner", desired: true }]) });
    await dsh.listen(); await streamweaver.listen(); const dshAddress = dsh.server.address(), streamAddress = streamweaver.server.address(); assert.ok(dshAddress && typeof dshAddress !== "string" && streamAddress && typeof streamAddress !== "string");
    await run({ cookie, tenantId, guildId, spmtBase, dshBase: `http://127.0.0.1:${dshAddress.port}`, streamBase: `http://127.0.0.1:${streamAddress.port}`, privateKey });
  } finally { if (streamweaver) await streamweaver.close(); if (dsh) await dsh.close(); await spmt.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("DSH makes calendar, channel delivery, application publishing, and private review discoverable", async () => {
  await fixture(async ({ cookie, guildId, dshBase, privateKey }) => {
    const page = await (await fetch(dshBase)).text();
    assert.match(page, /Admin Calendar/); assert.match(page, /Post Application Embed/); assert.match(page, /Application review/); assert.match(page, /Discord Delivery Settings/); assert.match(page, /Add DSH bot/); assert.match(page, /@media\(max-width:720px\)/);
    const control = await (await fetch(`${dshBase}/api/discord-stream-hub/control?guildId=${guildId}`, { headers: { cookie } })).json();
    assert.equal(control.role, "owner"); assert.equal(control.storageReady, true); assert.equal(control.applicationInteractionsReady, true); assert.deepEqual(control.calendar, []);
    const crossTenantGuild = await fetch(`${dshBase}/api/discord-stream-hub/control?guildId=999999999999999999`, { headers: { cookie } });
    assert.equal(crossTenantGuild.status, 400);
    const origin = new URL(dshBase).origin;
    const mission = await fetch(`${dshBase}/api/discord-stream-hub/control/calendar/mission`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ serverId: guildId, missionName: "Community night", missionDescription: "A fully wired test mission", missionDate: "2026-09-12", missionTime: "20:00" }) });
    assert.equal(mission.status, 201);
    const refreshed = await (await fetch(`${dshBase}/api/discord-stream-hub/control?guildId=${guildId}`, { headers: { cookie } })).json(); assert.equal(refreshed.calendar[0].eventName, "Community night");

    const answers = ["experience", "availability", "judgment", "safety", "motivation"].map((custom_id) => ({ type: 1, components: [{ type: 4, custom_id, value: `Detailed ${custom_id} response for review` }] }));
    const payload = Buffer.from(JSON.stringify({ id: "987654321098765432", type: 5, guild_id: guildId, member: { user: { id: "111111111111111111", username: "applicant" } }, data: { custom_id: `application_submit:mod:${guildId}`, components: answers } }));
    const timestamp = String(Math.floor(Date.now() / 1000)), signature = sign(null, Buffer.concat([Buffer.from(timestamp), payload]), privateKey).toString("hex");
    const interaction = await fetch(`${dshBase}/api/discord-stream-hub/interactions`, { method: "POST", headers: { "content-type": "application/json", "x-signature-timestamp": timestamp, "x-signature-ed25519": signature }, body: payload });
    assert.equal(interaction.status, 200); assert.match(JSON.stringify(await interaction.json()), /Application received/);
    const review = await (await fetch(`${dshBase}/api/discord-stream-hub/control`, { headers: { cookie } })).json(); assert.equal(review.applications[0].applicantUsername, "applicant"); assert.equal(review.applications[0].status, "pending");
    const decision = await fetch(`${dshBase}/api/discord-stream-hub/control/applications/decide`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ applicationId: review.applications[0].id, decision: "approved", note: "Welcome aboard." }) });
    assert.equal(decision.status, 200); assert.equal((await decision.json()).application.status, "approved");
  });
});

test("StreamWeaver exposes a wired Voice Commander, searchable bot catalog, integrations, persona and economy", async () => {
  await fixture(async ({ cookie, tenantId, spmtBase, streamBase }) => {
    const page = await (await fetch(streamBase)).text();
    assert.match(page, /Setup Guide/); assert.match(page, /Community Flows/); assert.match(page, /Build one flow with AI/); assert.match(page, /Your account is genuinely blank/); assert.match(page, /Voice Commander/); assert.match(page, /Explicit microphone/); assert.match(page, /Live input · provider replies go to shadow rooms/); assert.match(page, /Simulation Rooms/); assert.match(page, /Manage linked accounts/); assert.match(page, /@media\(max-width:720px\)/);
    const browserSource = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
    assert.ok(browserSource); assert.doesNotThrow(() => new Function(browserSource));
    assert.equal((browserSource.match(/textContent!==value/g) ?? []).length, 2, "StreamWeaver decorators must converge instead of retriggering themselves forever");
    assert.doesNotMatch(browserSource, /state\.textContent=readiness/);
    assert.doesNotMatch(browserSource, /if\(button\)button\.textContent='Preview \/ run read action'/);
    const control = await (await fetch(`${streamBase}/api/streamweaver/control`, { headers: { cookie } })).json();
    assert.equal(control.role, "owner"); assert.equal(control.operationMode, "read-only"); assert.equal(control.connections[0].provider, "twitch"); assert.equal(control.botRuntime.publicCommands, "connected"); assert.equal(control.botRuntime.suiteActions, "partial"); assert.ok(control.botActions.length >= 20); assert.equal(control.botActions.find((action) => action.id === "sw.image.generate").availability, "connected"); assert.ok(control.botActions.some((action) => action.policy === "simulated")); assert.ok(control.botActions.every((action) => action.policy !== "blocked"));
    const origin = new URL(streamBase).origin;
    const blankFlows = await (await fetch(`${streamBase}/api/streamweaver/control/flows`, { headers: { cookie } })).json();
    assert.deepEqual(blankFlows.installed, []); assert.equal(blankFlows.community.length, 50); assert.ok(blankFlows.community.every((item) => item.author.id === "mtman1987" && item.installUnit === "flow" && item.commands.length >= 1 && item.actions.length >= 1));
    const install = await fetch(`${streamBase}/api/streamweaver/control/flows/install`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ packageId: "mtman1987.coinflip" }) });
    assert.equal(install.status, 200);
    const oneFlow = await (await fetch(`${streamBase}/api/streamweaver/control/flows`, { headers: { cookie } })).json();
    assert.deepEqual(oneFlow.installed.map((item) => item.packageId), ["mtman1987.coinflip"]);
    const exported = await fetch(`${streamBase}/api/streamweaver/control/flows/mtman1987.coinflip/export`, { headers: { cookie } });
    assert.equal(exported.status, 200); assert.match(exported.headers.get("content-disposition") ?? "", /\.streamweaver\.json/); assert.equal((await exported.json()).commands.length, 1);
    const preview = await fetch(`${streamBase}/api/streamweaver/control/flows/preview`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ packageId: "mtman1987.coinflip" }) });
    assert.equal(preview.status, 200); const previewBody=await preview.json(); assert.match(previewBody.roomId,/streamweaver:flow-builder/); assert.equal(previewBody.command.role,"primary"); assert.ok(previewBody.outputs.length>0);
    const secondPreview = await fetch(`${streamBase}/api/streamweaver/control/flows/preview`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ packageId: "mtman1987.coinflip", message: "!coinflip" }) });
    assert.equal((await secondPreview.json()).roomId,previewBody.roomId);
    const rooms = await (await fetch(`${spmtBase}/v1/simulation-rooms`, { headers: { cookie, "x-spmt-tenant": tenantId } })).json();
    assert.equal(rooms.filter((room)=>room.roomId===previewBody.roomId).length,1,"repeated previews reuse a single room");
    assert.ok(rooms.find((room)=>room.roomId===previewBody.roomId).eventCount>=4,"inputs and outputs belong in the conversation");
    assert.doesNotMatch(browserSource,/data-nav="shadow-rooms"|data-spmt-live-slot="shadow-rooms"/);
    const blockedBuilder = await fetch(`${streamBase}/api/streamweaver/control/flows/ai`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ idea: "Make !hello greet the chatter" }) });
    assert.equal(blockedBuilder.status, 200); assert.equal((await blockedBuilder.json()).status, "blocked");
    const persona = await fetch(`${streamBase}/api/streamweaver/control/persona`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ personaId: "athena", displayName: "Athena", aliases: "athena\nannie", homeChannelIds: "main", summonWindowMinutes: 10, instructions: "Be warm, accurate, and concise.", memoryPolicy: "conversation" }) });
    assert.equal(persona.status, 200);
    const economy = await fetch(`${streamBase}/api/streamweaver/control/economy`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ currencyName: "Quacks", defaultBet: 100, minBet: 1, maxBet: 10000, winPercent: 28, jackpotPercent: 1, jackpotMultiplier: 10, spmtExchangeEnabled: false, baseLocalPerSpmt: 1000, referenceSupply: 1000000, maxSpmtPerExchange: 100 }) });
    assert.equal(economy.status, 200); assert.equal((await economy.json()).currencyName, "Quacks");
    const shadowVoice = await fetch(`${streamBase}/api/streamweaver/control/voice`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ destination: "twitch", connectionId: "main", message: "Hello stream", idempotencyKey: "shadow-voice-test" }) });
    assert.equal(shadowVoice.status, 202);
    const shadowVoiceBody = await shadowVoice.json(); assert.equal(shadowVoiceBody.kind, "egress"); assert.equal(shadowVoiceBody.destination, "twitch"); assert.ok(shadowVoiceBody.jobId);
    const simulatedAction = await fetch(`${streamBase}/api/streamweaver/control/voice`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ destination: "private", message: "post a DSH shoutout for @creator in #shoutouts", idempotencyKey: "simulated-dsh-action" }) });
    assert.equal(simulatedAction.status, 202);
    const simulatedActionBody = await simulatedAction.json(); assert.equal(simulatedActionBody.kind, "suite-action"); assert.equal(simulatedActionBody.action, "dsh.shoutouts.post"); assert.ok(simulatedActionBody.jobId);
    const routedEvents = await (await fetch(`${spmtBase}/v1/events?type=spmt.simulation-room.event.v1&limit=100`, { headers: { cookie, "x-spmt-tenant": tenantId } })).json();
    assert.ok(routedEvents.some((event) => event.payload?.title === "dsh.shoutouts.post Voice Commander input" && event.payload?.data?.risk === "broadcast"));
  });
});
