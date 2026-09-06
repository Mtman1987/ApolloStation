import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { createDiscordStreamHubWebServer } from "../apps/discord-stream-hub/dist/web-server.js";
import { discordStreamHubCatalogRegistration } from "../apps/discord-stream-hub/dist/index.js";
import { createIntegratedSpaceMountainWebHost } from "../apps/spacemountain-web/dist/integrated-server.js";
import { createStreamWeaverWebServer } from "../apps/streamweaver/dist/web-server.js";
import { streamweaverCatalogRegistration } from "../apps/streamweaver/dist/index.js";

async function fixture(run, aiOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "spmt-app-controls-"));
  const dshDatabase = join(directory, "dsh.sqlite"), streamDatabase = join(directory, "streamweaver.sqlite"), configPath = join(directory, "dsh-config.json");
  const guildId = "123456789012345678", streamweaverCredential = "streamweaver-test-worker-credential-123456789";
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, pollIntervalSeconds: 60, tenants: [{ tenantId: "placeholder", twitchProviderUserId: "twitch-owner", discordProviderUserId: "discord-bot", discordGuildIds: [guildId], branding: { communityMemberName: "Crew" }, members: [] }] }));
  const spmt = createSpmtService({ ...(aiOptions.communityAssistant ? {communityAssistant:aiOptions.communityAssistant} : {}), databasePath: join(directory, "spmt.sqlite"), webhookKey: Buffer.alloc(32, 4), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.example", runtimeMode: "sandbox", sandboxOwnerUsername: "mtman1987", streamweaverProviderRuntimeEnabled: true, streamweaverWorkerCredential: streamweaverCredential, sandboxApps: [discordStreamHubCatalogRegistration("https://spmt.example/apps/discord-stream-hub"), streamweaverCatalogRegistration("https://spmt.example/apps/streamweaver")] });
  let dsh, streamweaver, ingress;
  try {
    await spmt.listen(); const spmtAddress = spmt.server.address(); assert.ok(spmtAddress && typeof spmtAddress !== "string"); const spmtBase = `http://127.0.0.1:${spmtAddress.port}`;
    await fetch(`${spmtBase}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "M.T.", username: "mtman1987", password: "sandbox-owner-password" }) });
    const login = await fetch(`${spmtBase}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "mtman1987", password: "sandbox-owner-password" }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0]; assert.ok(cookie);
    const session = await (await fetch(`${spmtBase}/v1/session`, { headers: { cookie } })).json(); const tenantId = session.tenantIds[0];
    spmt.authority.linkProvider(session.userId ?? session.actorId, "twitch", "100");
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, pollIntervalSeconds: 60, tenants: [{ tenantId, twitchProviderUserId: "twitch-owner", discordProviderUserId: "discord-bot", discordGuildIds: [guildId], branding: { communityMemberName: "Crew" }, members: [] }] }));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519"), publicKeyHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
    dsh = createDiscordStreamHubWebServer({ spmtOrigin: spmtBase, host: "127.0.0.1", port: 0, databasePath: dshDatabase, runtimeConfigPath: configPath, publicOrigin: "https://spmt.example", discordPublicKey: publicKeyHex, discordClientId: "222222222222222222" });
    streamweaver = createStreamWeaverWebServer({ privateAiDraftsEnabled:aiOptions.privateAiDraftsEnabled, spmtOrigin: spmtBase, host: "127.0.0.1", port: 0, databasePath: streamDatabase, credential: streamweaverCredential, operationMode: "read-only", connectionsJson: JSON.stringify([{ schemaVersion: 1, tenantId, provider: "twitch", connectionId: "main", channelId: "mtman1987", providerAccountId: "twitch-owner", desired: true }]) });
    await dsh.listen(); await streamweaver.listen(); const dshAddress = dsh.server.address(), streamAddress = streamweaver.server.address(); assert.ok(dshAddress && typeof dshAddress !== "string" && streamAddress && typeof streamAddress !== "string");
    ingress = createIntegratedSpaceMountainWebHost({ spmtOrigin: spmtBase, host: "127.0.0.1", port: 0, greenAppOrigins: { "discord-stream-hub": `http://127.0.0.1:${dshAddress.port}`, "streamweaver": `http://127.0.0.1:${streamAddress.port}` } });
    await ingress.listen(); const webBase = `http://127.0.0.1:${ingress.server.address().port}`;
    await run({ spmt, streamDatabase, cookie, tenantId, guildId, spmtBase, webBase, dshBase: `http://127.0.0.1:${dshAddress.port}`, streamBase: `http://127.0.0.1:${streamAddress.port}`, privateKey });
  } finally { if (ingress) await ingress.close(); if (streamweaver) await streamweaver.close(); if (dsh) await dsh.close(); await spmt.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("DSH makes calendar, channel delivery, application publishing, and private review discoverable", async () => {
  await fixture(async ({ cookie, guildId, dshBase, privateKey }) => {
    const page = await (await fetch(dshBase)).text();
    assert.match(page, /Community Calendar/); assert.match(page, /Post Application Embed/); assert.match(page, /Application review/); assert.match(page, /Discord Delivery Settings/); assert.match(page, /Add DSH bot/); assert.match(page, /@media\(max-width:720px\)/);
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
    assert.match(page, /Setup Guide/); assert.match(page, /Community Flows/); assert.match(page, /Build one flow with AI/); assert.match(page, /No flows installed yet/); assert.match(page, /Voice Commander/); assert.match(page, /Review your text before sending/); assert.match(page, /Provider replies are captured in Simulation Rooms/); assert.match(page, /Simulation Rooms/); assert.match(page, /Manage linked accounts/); assert.match(page, /@media\(max-width:720px\)/);
    const browserSource = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
    assert.ok(browserSource); assert.doesNotThrow(() => new Function(browserSource));
    assert.doesNotMatch(browserSource, /window.fetch=|nativeFetch=/, "the page controller does not replace browser fetch");
    const control = await (await fetch(`${streamBase}/api/streamweaver/control`, { headers: { cookie } })).json();
    assert.equal(control.role, "owner"); assert.equal(control.operationMode, "read-only"); assert.equal(control.connections[0].provider, "twitch"); assert.equal(control.botRuntime.publicCommands, "connected"); assert.equal(control.botRuntime.suiteActions, "partial"); assert.ok(control.botActions.length >= 20); assert.equal(control.botActions.find((action) => action.id === "sw.image.generate").availability, "connected"); assert.ok(control.botActions.some((action) => action.policy === "simulated")); assert.ok(control.botActions.every((action) => action.policy !== "blocked"));
    const origin = new URL(streamBase).origin;
    const saveBroadcaster = id => fetch(`${streamBase}/api/streamweaver/control/twitch`, {method:"POST",headers:{cookie,origin,"content-type":"application/json"},body:JSON.stringify({broadcasterId:id})});
    assert.equal((await saveBroadcaster("999")).status,400);
    assert.equal((await saveBroadcaster("100")).status,200);
    const avatar=await fetch(`${streamBase}/api/streamweaver/control/appearance`,{method:"POST",headers:{cookie,origin,"content-type":"application/json"},body:JSON.stringify({avatarUrl:"https://assets.test/idle.png",talkingUrl:"https://assets.test/talking.gif"})});
    assert.equal(avatar.status,200);assert.equal((await avatar.json()).appearance.talkingUrl,"https://assets.test/talking.gif");
    const widgets=await (await fetch(`${spmtBase}/v1/overlay/widgets`,{headers:{cookie,"x-spmt-tenant":tenantId}})).json();
    assert.ok(widgets.some(widget=>widget.manifest.appId==="streamweaver"&&widget.manifest.widgetId==="social"));
    const twitchSettings=await (await fetch(`${streamBase}/api/streamweaver/control`,{headers:{cookie}})).json();
    assert.equal(twitchSettings.twitch.broadcasterId,"100");
    const blankFlows = await (await fetch(`${streamBase}/api/streamweaver/control/flows`, { headers: { cookie } })).json();
    assert.deepEqual(blankFlows.installed, []); assert.equal(blankFlows.community.length, 53); assert.ok(blankFlows.community.every((item) => item.author.id === "mtman1987" && item.installUnit === "flow" && item.commands.length >= 1 && item.actions.length >= 1));
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
    const sharingPath=streamBase+"/api/streamweaver/control/persona/public",sharing=await (await fetch(sharingPath,{headers:{cookie}})).json();assert.equal(sharing.published,null);assert.ok(sharing.voices.length);
    const publication=await fetch(sharingPath,{method:"POST",headers:{cookie,origin,"content-type":"application/json"},body:JSON.stringify({action:"publish",voice:sharing.voices[0].id,instructions:"Do not use this unsaved browser text"})});assert.equal(publication.status,200);assert.equal((await publication.json()).published.displayName,"Athena");const catalog=await (await fetch(spmtBase+"/v1/assistant/public-personas",{headers:{cookie,"x-spmt-tenant":tenantId}})).json();assert.equal(catalog.personas[0].displayName,"Athena");assert.doesNotMatch(JSON.stringify(catalog),/instructions|unsaved browser text/);
    assert.equal((await fetch(sharingPath,{method:"POST",headers:{cookie,origin,"content-type":"application/json"},body:JSON.stringify({action:"withdraw"})})).status,200);

    const economy = await fetch(`${streamBase}/api/streamweaver/control/economy`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ currencyName: "Quacks", defaultBet: 100, minBet: 1, maxBet: 10000, winPercent: 28, jackpotPercent: 1, jackpotMultiplier: 10, spmtExchangeEnabled: true }) });
    assert.equal(economy.status, 200); const savedEconomy=await economy.json(); assert.equal(savedEconomy.currencyName, "Quacks"); assert.equal(savedEconomy.spmtExchangeEnabled,false); assert.doesNotMatch(page,/Enable bounded SPMT exchange|Maximum SPMT per exchange/);
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


test("DSH app-path ingress opens, edits and deletes a real workspace calendar without a Discord server", async () => {
  await fixture(async ({ cookie, webBase }) => {
    const api = `${webBase}/apps/discord-stream-hub/api/control`;
    const headers = { cookie, origin: webBase, "content-type": "application/json" };
    const initial = await fetch(`${api}?month=2026-09`, { headers: { cookie } });
    assert.match(initial.headers.get("content-type"), /application\/json/);
    assert.equal(initial.status, 200);
    assert.deepEqual((await initial.json()).calendar, []);
    const create = await fetch(`${api}/calendar/mission`, { method: "POST", headers, body: JSON.stringify({ missionName: "Workspace event", missionDescription: "Works before Discord is connected", missionDate: "2026-09-20", missionTime: "18:30" }) });
    assert.equal(create.status, 201);
    const event = (await create.json()).event;
    assert.equal(event.serverId, "workspace");
    assert.equal((await (await fetch(`${api}?month=2026-09`, { headers: { cookie } })).json()).calendar[0].id, event.id);
    const edit = await fetch(`${api}/calendar/update`, { method: "POST", headers, body: JSON.stringify({ eventId: event.id, eventDate: "2026-10-02", eventName: "Updated event" }) });
    assert.equal(edit.status, 200);
    assert.equal((await edit.json()).event.eventName, "Updated event");
    assert.equal((await (await fetch(`${api}?month=2026-09`, { headers: { cookie } })).json()).calendar.length, 0);
    assert.equal((await (await fetch(`${api}?month=2026-10`, { headers: { cookie } })).json()).calendar[0].id, event.id);
    const crossOrigin = await fetch(`${api}/calendar/delete`, { method: "POST", headers: { ...headers, origin: "https://outside.example" }, body: JSON.stringify({ eventId: event.id }) });
    assert.equal(crossOrigin.status, 403, "outer ingress validates the actual browser origin before rewriting it");
    const deleted = await fetch(`${api}/calendar/delete`, { method: "POST", headers, body: JSON.stringify({ eventId: event.id }) });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).deleted, true);
    const snapshot = await fetch(`${webBase}/apps/discord-stream-hub/api/snapshot`, { headers: { cookie } });
    assert.equal(snapshot.status, 200); assert.match(snapshot.headers.get("content-type"), /application\/json/);
    const unknown = await fetch(`${webBase}/apps/discord-stream-hub/api/missing`, { headers: { cookie } });
    assert.equal(unknown.status, 404); assert.match(unknown.headers.get("content-type"), /application\/json/);
  });
});


test("StreamWeaver app ingress supports manual command editing, pause, link settings, wallet changes and private voice retention",async()=>{
  await fixture(async({cookie,webBase})=>{
    const base=webBase+'/apps/streamweaver/api/control',headers={cookie,origin:webBase,'content-type':'application/json'};
    const read=async(path='')=>{const response=await fetch(base+path,{headers:{cookie}});assert.equal(response.status,200);return response.json()};
    const post=async(path,body,status=200)=>{const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,status,await response.clone().text());return response.json()};
    const state=await read();
    const research={enabled:true,liveSearchEnabled:false,knowledgePacks:["vocaloid"],sourceAllowlist:["vocaloid.com"],maxResults:3,cacheMinutes:0};await post("/research",research);assert.deepEqual((await read()).research,research);await post("/research",{...research,maxResults:99},400);
    const packageData={schemaVersion:1,kind:'streamweaver.flow-package',packageId:'flow.web-test',name:'Welcome',commands:[{id:'welcome',trigger:'!hello',aliases:[],enabled:false,actionIds:['reply']}],actions:[{id:'reply',type:'send-chat',enabled:false,config:{text:'Hello %userName%!'}}]};
    let saved=(await post('/flows/save',{package:packageData})).package;
    assert.equal(saved.commands[0].enabled,false);
    await post('/flows/save',{package:{...saved,name:'Changed'},expectedUpdatedAt:'stale'},400);
    await post('/flows/approve',{packageId:saved.packageId});
    await post('/flows/toggle',{packageId:saved.packageId,enabled:false});
    assert.equal((await read('/flows')).installed.find(i=>i.packageId===saved.packageId).enabled,false);
    await post('/links',{webpage:'https://example.org/community'});assert.equal((await read()).creatorLinks.webpage,'https://example.org/community');
    await post('/botshare',{enabled:true});assert.equal((await read()).botShareEnabled,true);
    const adjustment={userId:state.session.actorId,mode:'add',amount:10,idempotencyKey:'currency-web'};
    assert.equal((await post('/economy/adjust',adjustment)).wallet.balance,10);assert.equal((await post('/economy/adjust',adjustment)).duplicate,true);
    const bulk={mode:'add',amount:5,idempotencyKey:'currency-bulk'};assert.equal((await post('/economy/bulk',bulk)).count,1);await post('/economy/bulk',bulk);
    const wallet=await read('/economy/wallet?userId='+encodeURIComponent(state.session.actorId));assert.equal(wallet.wallet.balance,15);
    const ledger=(await read('/economy/ledger')).entries;assert.deepEqual(ledger.map(row=>row.delta),[5,10]);assert.equal(ledger[0].actorId,state.session.actorId);
    const diagnostics=await read('/diagnostics');assert.equal(diagnostics.currency.walletCount,1);assert.equal(diagnostics.operationMode,'read-only');assert.ok(Array.isArray(diagnostics.runs));
    await post('/voice',{destination:'private',message:'Do not retain this',idempotencyKey:'private'});
    assert.deepEqual((await read('/voice/history')).history,[]);
    await post('/voice',{destination:'ai',message:'Retained blocked request',idempotencyKey:'remembered'});
    assert.equal((await read('/voice/history')).history[0].status,'blocked');
    await post('/voice/history/clear',{});assert.equal((await read('/voice/history')).history.length,0);
    await post('/flows/delete',{packageId:saved.packageId});assert.equal((await read('/flows')).drafts.length,0);
    const archive={commands:[{id:'hello',command:'!importhello',actionId:'reply'}],actions:[{id:'reply',name:'Reply',subActions:[{type:'SendChatMessage',message:'Imported welcome'}]}],extra:'retained'};
    const imported=await post('/flows/import',{package:archive});assert.equal(imported.packages.length,2);assert.equal((await read('/flows')).installed.length,0);
    assert.deepEqual(imported.packages[0].legacySource.source,archive);
    const again=await post('/flows/import',{package:archive});assert.equal(again.packages[0].packageId,imported.packages[0].packageId);
    await post('/flows/approve',{packageId:imported.packages[0].packageId});assert.equal((await read('/flows')).installed.length,1);

  });
});

test("StreamWeaver exposes owner pairing and saves selected device automation through the canonical API",async()=>{
 await fixture(async({cookie,webBase,spmtBase})=>{
  const headers={cookie,origin:webBase,"content-type":"application/json"},root=webBase+"/api/streamweaver/control";
  const pairing=await fetch(root+"/devices/pair",{method:"POST",headers,body:JSON.stringify({name:"Studio Computer"})});assert.equal(pairing.status,200);const code=await pairing.json();
  const exchange=await fetch(spmtBase+"/v1/devices/bootstrap/exchange",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:code.code})});assert.equal(exchange.status,200);
  const paired=await exchange.json(),devices=await(await fetch(root+"/devices",{headers})).json();assert.equal(devices.devices[0].name,"Studio Computer");
  const saved=await fetch(root+"/devices",{method:"POST",headers,body:JSON.stringify({deviceId:paired.device.deviceId,actions:["obs.scene.set"]})});assert.equal(saved.status,200);assert.deepEqual((await saved.json()).automationGrants[0].actions,["obs.scene.set"]);
  const current=await(await fetch(root,{headers})).json();assert.equal(current.devices[0].automationGrants[0].appId,"streamweaver");
 });
});


test("Points-page value box reads live supplies after both local issuance and XP spending", async () => {
  await fixture(async({spmt,streamDatabase,cookie,tenantId,streamBase})=>{
    const {SqliteStreamWeaverEconomyStore}=await import("../apps/streamweaver/dist/economy.js");
    const store=new SqliteStreamWeaverEconomyStore(streamDatabase);
    try {
      store.setBalance(tenantId,"rate-viewer",1000000);
      spmt.authority.awardXp({tenantId,userId:"rate-viewer",delta:100000,sourceAppId:"test",reason:"seed",idempotencyKey:"rate-seed"});
      const read=async()=>{const response=await fetch(streamBase+"/api/streamweaver/control/economy/rate",{headers:{cookie}});assert.equal(response.status,200,await response.clone().text());return response.json()};
      const first=await read();assert.equal(first.streamerPointsPerXp,10);assert.equal(first.xpPerStreamerPoint,0.1);
      store.adjustBalance(tenantId,"rate-viewer",9000000);
      const second=await read();assert.equal(second.streamerPointsPerXp,100);assert.equal(second.xpPerStreamerPoint,0.01);
      spmt.authority.spendXp({tenantId,userId:"rate-viewer",amount:50000,sourceAppId:"test",idempotencyKey:"rate-spend"});
      const third=await read();assert.equal(third.streamerPointsPerXp,200);assert.equal(third.xpPerStreamerPoint,0.005);
      assert.equal(spmt.authority.getXpWallet(tenantId,"rate-viewer").lifetimeXp,100000);
      const anonymous=await fetch(streamBase+"/api/streamweaver/control/economy/rate");assert.notEqual(anonymous.status,200);
      const html=await(await fetch(streamBase)).text();assert.match(html,/Current SPMT value/);assert.match(html,/Updates every 5 seconds/);
    } finally {store.close()}
  });
});


test("sandbox private AI drafts reach the shared assistant while chat egress remains read-only", async () => {
  const requests=[];
  await fixture(async ({cookie,streamBase})=>{
    const response=await fetch(streamBase+'/api/streamweaver/control/flows/ai',{method:'POST',headers:{cookie,origin:streamBase,'content-type':'application/json'},body:JSON.stringify({idea:'Build !rpsls with hidden choices',idempotencyKey:'private-draft-test'})});
    const body=await response.json();assert.equal(response.status,202,JSON.stringify(body));assert.equal(body.jobId,'draft-test-job');
    assert.equal(requests.length,1);assert.equal(requests[0].surface,'developer');assert.equal(requests[0].remember,false);
    const control=await (await fetch(streamBase+'/api/streamweaver/control',{headers:{cookie}})).json();assert.equal(control.operationMode,'read-only');
  },{privateAiDraftsEnabled:true,communityAssistant:{status:()=>({availability:'available'}),accept(input){requests.push(input);return{jobId:'draft-test-job',executionTarget:'sprite'};}}});
});
