import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DSH_CARD_PACK_RENDER_PROFILE,
  DSH_QUACKVERSE_ART_PROFILE,
  DshCardPackRenderWorker,
  DshChannelModerationService,
  DshSignalControlSigner,
  DshTenantSettingsStore,
  SqliteDshCardPackRenderStore,
  bulkEligible,
  removeDshSignal,
  normalizeDshBannerVariant,
  DshQuackversePackPublisher,
  DshQuackverseArtExecutionWorker,
  buildDshSignalPresentation,
} from "../apps/discord-stream-hub/dist/index.js";
import {
  HearMeOutPersonaConversationCoordinator,
  HEARMEOUT_PERSONA_TALK_BROWSER_JS,
  frameHearMeOutPersonaPcm,
  resolveHearMeOutBotInvocation,
} from "../apps/hearmeout/dist/index.js";
import {
  QUACKVERSE_CANON_GROUPS,
  buildQuackversePackDiscordPayload,
  getQuackverseVisualCanon,
  quackversePresentationDirection,
  resolveQuackversePresentation,
  NebulaQuackverseArtCoordinator,
} from "../apps/nebula-arcade/dist/index.js";
import {
  SeaArtCliProvider,
  StreamWeaverCardPackCoordinator,
  StreamWeaverImageGenerationService,
  buildStreamWeaverCardPackRenderUrl,
  decodeStreamWeaverCardPackEvent,
  encodeStreamWeaverCardPackEvent,
  extractSeaArtCliImageUrls,
  formatStreamWeaverLiveMemberGroups,
  groupStreamWeaverLiveMembers,
  normalizeStreamWeaverCardPackEvent,
  StreamWeaverHearMeOutPersonaService,
  resolveStreamWeaverCountInteraction,
} from "../apps/streamweaver/dist/index.js";
import { MountainViewForegroundWake, mountainViewWakeCommand, planMountainViewVoiceCommand } from "../apps/mountainview/dist/index.js";
import { COMPANION_WAKE_PREFIX, companionPowerShellWakeScript, decodeCompanionWakeLine } from "../apps/companion/dist/index.js";
import { SpaceMountainSessionRecoveryGate, classifySpaceMountainSessionFailure } from "../apps/spacemountain-web/dist/session-resilience.js";

function fixture() { const dir = mkdtempSync(join(tmpdir(), "apollo-live-catchup-")); return { dir, path: join(dir, "state.sqlite"), close() { rmSync(dir, { recursive: true, force: true }); } }; }
function snowflake(at) { return ((BigInt(at) - 1_420_070_400_000n) << 22n).toString(); }

test("DSH spotlight policy, nuke pagination, and old-message fallback match Discord constraints", async () => {
  assert.equal(normalizeDshBannerVariant("spotlight"), "spotlight");
  const now = Date.parse("2026-09-03T00:00:00Z"), recent = snowflake(now - 60_000), old = snowflake(now - 15 * 86_400_000), bot = "123456789012345678";
  assert.equal(bulkEligible(recent, now), true); assert.equal(bulkEligible(old, now), false);
  const calls = [];
  const service = new DshChannelModerationService({ channel: async () => ({ id: "223456789012345678", guildId: "323456789012345678", name: "cleanup" }), botIdentity: async () => ({ id: bot }), message: async () => undefined, messages: async () => [{ id: recent, authorId: bot }, { id: old, authorId: bot }], bulkDelete: async (_tenant, _channel, ids) => calls.push(["bulk", ...ids]), deleteMessage: async (_tenant, _channel, id) => calls.push(["one", id]) }, () => now);
  const result = await service.nuke({ schemaVersion: 1, tenantId: "tenant-a", guildId: "323456789012345678", channelId: "223456789012345678", mode: "bot", actorRole: "admin" });
  assert.equal(result.deleted, 2); assert.deepEqual(calls, [["one", recent], ["one", old]]);
});

test("DSH Signal removal tokens are tenant-bound and credential-free", async () => {
  const signer = new DshSignalControlSigner(Buffer.alloc(32, 7), () => 1_800_000_000_000), calls = [];
  const token = signer.issue({ tenantId: "tenant-a", dropId: "drop-1", channelId: "12345", messageId: "67890", ttlSeconds: 120 });
  const result = await removeDshSignal(signer, { deleteMessage: async (...args) => calls.push(args), removeDrop: async () => true }, { tenantId: "tenant-a", role: "owner" }, token);
  assert.equal(result.removed, true); assert.deepEqual(calls, [["tenant-a", "12345", "67890"]]);
  await assert.rejects(() => removeDshSignal(signer, { deleteMessage: async () => {}, removeDrop: async () => true }, { tenantId: "tenant-b", role: "owner" }, token), /another tenant/);
  assert.equal(token.includes("Bearer"), false);
});

test("DSH Signal presentation keeps the sender identity and fixed acquired badge", () => {
  const value=buildDshSignalPresentation({displayName:"Pilot",username:"pilot",userAvatarUrl:"https://cdn.example/pilot.png",signalText:"lost transmission",signalBadgeUrl:"https://cdn.example/signal.gif"});
  assert.equal(value.webhookUsername,"Pilot");assert.equal(value.webhookAvatarUrl,"https://cdn.example/pilot.png");assert.equal(value.embeds[0].thumbnail.url,"https://cdn.example/signal.gif");assert.equal(value.embeds[0].footer.text,"SIGNAL LOCKED • MESSAGE ACQUIRED");assert.deepEqual(value.allowed_mentions,{parse:[]});
});

test("DSH card-pack queue survives leases and validates GIF output", async () => {
  const f = fixture(); let now = "2026-09-03T00:00:00Z";
  const store = new SqliteDshCardPackRenderStore(f.path, () => now);
  try {
    const created = store.create({ id: "pack-1", tenantId: "tenant-a", source: "quackverse", renderUrl: "https://stream.example/overlay/card-pack" });
    assert.equal(created.status, "pending"); assert.equal(DSH_CARD_PACK_RENDER_PROFILE.durationSeconds, 14);
    const worker = new DshCardPackRenderWorker(store, { render: async () => Buffer.from("GIF89a") });
    assert.equal((await worker.runOnce()).job.status, "ready"); assert.equal(store.get("pack-1").gif.byteLength, 6);
    store.create({ id: "pack-2", tenantId: "tenant-a", source: "pokemon", renderUrl: "https://stream.example/overlay/card-pack" }); store.claim("pack-2"); now = "2026-09-03T00:06:00Z"; assert.equal(store.claim("pack-2").attempts, 2);
  } finally { store.close(); f.close(); }
});

test("DSH tenant settings are revisioned, validated, and integrity-checkable", () => {
  const f = fixture(), store = new DshTenantSettingsStore(f.path, () => "2026-09-03T00:00:00Z");
  try { const initial = store.read("tenant-a"); assert.equal(initial.pollIntervalSeconds, 60); const next = store.patch("tenant-a", { schemaVersion: 1, expectedRevision: 0, values: { spotlightChannelId: "12345", groupChannels: '{"crew":"67890"}' } }); assert.deepEqual(next.groupChannels, { crew: "67890" }); assert.equal(next.revision, 1); assert.equal(store.checkpoint().integrity, true); assert.throws(() => store.patch("tenant-a", { schemaVersion: 1, expectedRevision: 1, values: { groupChannels: "[]" } }), /object/); } finally { store.close(); f.close(); }
});

test("Quackverse render profile preserves live ping-pong and palette limits", () => { assert.deepEqual(DSH_QUACKVERSE_ART_PROFILE.hover.paletteLevels, [128, 96, 80, 64]); assert.equal(DSH_QUACKVERSE_ART_PROFILE.hover.frameCount, 100); assert.equal(DSH_QUACKVERSE_ART_PROFILE.hover.pingPong, true); assert.equal(DSH_QUACKVERSE_ART_PROFILE.maxBytes, 50 * 1024 * 1024); });

test("Nebula owns full Quackverse canon, presentation locks, and safe unified pack payloads", () => {
  assert.equal(Object.keys(QUACKVERSE_CANON_GROUPS).length, 101);
  assert.equal(QUACKVERSE_CANON_GROUPS[69].identityBaseId, 31);
  assert.equal(resolveQuackversePresentation({ id: 7, type: "duck" }, QUACKVERSE_CANON_GROUPS[7]), "feminine");
  const canon = getQuackverseVisualCanon({ id: 69, name: "Cosmic Drake Ultra", family: "Drake", role: "Warrior" });
  assert.equal(canon.identityBaseId, 31); assert.equal(canon.species, "Canvasback");
  assert.match(quackversePresentationDirection({ id: 7, type: "duck" }, { ...QUACKVERSE_CANON_GROUPS[7], species: "Tundra Swan", plumage: "white" }), /adult female Tundra Swan pen/);
  const payload = buildQuackversePackDiscordPayload({ packId: "pack-1", username: "Pilot", pack: [{ id: 7, name: "Moon Duck", rarity: "Rare", imageUrl: "https://cdn.example/7.webp" }], packsRemaining: 3, collectionIds: [7, 7] });
  assert.deepEqual(payload.allowed_mentions, { parse: [] }); assert.match(payload.embeds[0].description, /rendering/); assert.match(payload.embeds[0].fields[1].value, /1 unique/);
});

test("Nebula hands canon-rich Quackverse art jobs to the DSH renderer through SPMT", async () => {
  const calls=[],coordinator=new NebulaQuackverseArtCoordinator({createExecutionJob:async(...args)=>{calls.push(args);return{job:{id:"art-job"},duplicate:false}}});
  const requested=await coordinator.request("tenant-a","user-a",{id:69,name:"Cosmic Drake Ultra",type:"duck",role:"Warrior",family:"Drake",sourceImageUrl:"https://cdn.example/source.webp"});
  assert.equal(requested.canon.identityBaseId,31);assert.equal(calls[0][1].executionOwner,"discord-stream-hub");assert.equal(calls[0][1].capabilityId,"dsh.quackverse.art.render.v1");assert.match(calls[0][1].input.presentationDirection,/SEX\/PRESENTATION LOCK/);
  const workerCalls=[],job={id:"job-1",tenantId:"tenant-a",leaseId:"lease-1",fencingEpoch:1,input:{cardId:69,sourceImageUrl:"https://cdn.example/source.webp"}},client={claimAnyExecutionJob:async()=>job,heartbeatExecutionJob:async()=>{},succeedExecutionJob:async(...args)=>workerCalls.push(["succeed",...args]),failExecutionJob:async(...args)=>workerCalls.push(["fail",...args])};
  const worker=new DshQuackverseArtExecutionWorker(client,{load:async()=>Uint8Array.of(1,2,3)},{enhanceAndAnimate:async()=>({master:Uint8Array.of(4,5),hover:Buffer.from("GIF89a"),paletteColors:128})},{publish:async()=>({masterUrl:"https://cdn.example/master.webp",hoverUrl:"https://cdn.example/hover.gif"})},"worker-1");
  assert.equal(await worker.runOnce(),"job-1");assert.equal(workerCalls[0][0],"succeed");assert.equal(workerCalls[0][6].paletteColors,128);
});

test("DSH sends a Quackverse result immediately and edits the same Discord message with its GIF", async () => {
  const calls = [], discord = { createMessage: async (...args) => { calls.push(["create", ...args]); return "9876543210"; }, editMessage: async (...args) => calls.push(["edit", ...args]), deleteMessage: async (...args) => calls.push(["delete", ...args]) };
  const publisher = new DshQuackversePackPublisher(discord, { render: async () => ({ gifUrl: "https://cdn.example/pack.gif", status: "ready", attempts: 1 }) }, (task, delay) => calls.push(["schedule", task, delay]));
  const result = await publisher.present({ tenantId: "tenant-a", userId: "user-a", channelId: "123456", presentation: { packId: "pack-1", username: "Pilot", pack: [{ id: 7, name: "Moon Duck", rarity: "Rare", imageUrl: "https://cdn.example/7.webp" }], packsRemaining: 3, collectionIds: [7] } });
  assert.equal(result.success, true); assert.equal(calls[0][0], "create"); assert.equal(calls[1][0], "edit"); assert.equal(calls[1][4].embeds[0].image.url, "https://cdn.example/pack.gif"); assert.equal(calls[2][2], 10 * 60_000);
});

test("HearMeOut shares exact wake routing, bounded explicit Talk, healthy persona command, and padded PCM", async () => {
  assert.deepEqual(resolveHearMeOutBotInvocation("Please ask Hey Athena about orbit", [{ displayName: "Athena", wakeNames: ["Annie"], targetTenantId: "athena" }]), { displayName: "Athena", targetTenantId: "athena" });
  assert.equal(resolveHearMeOutBotInvocation("cathenax", [{ displayName: "Athena", wakeNames: [] }]), null);
  assert.match(HEARMEOUT_PERSONA_TALK_BROWSER_JS, /new MediaRecorder/); assert.match(HEARMEOUT_PERSONA_TALK_BROWSER_JS, /8000/); assert.doesNotMatch(HEARMEOUT_PERSONA_TALK_BROWSER_JS, /SpeechRecognition/);
  const calls = [], coordinator = new HearMeOutPersonaConversationCoordinator({ listPublicPersonas: async () => [{ personaId: "athena", targetTenantId: "athena", displayName: "Athena", wakeNames: ["Annie"], canInvite: true, transportHealthy: true }], inspectWorkerPersona: async () => ({ active: true, transportHealthy: true, displayName: "Athena" }), transcribe: async () => ({ transcription: "Hey Athena" }), invoke: async (input) => { calls.push(["invoke", input]); return { response: "On it.", bot: { tenantId: "athena", name: "Athena" }, tts: { audioDataUri: "data:audio/wav;base64,QUJD" } }; }, speak: async (input) => { calls.push(["speak", input]); return { bytes: 3, transportHealthy: true }; } });
  assert.deepEqual(await coordinator.transcribe("QUJD"), { transcription: "Hey Athena" });
  const result = await coordinator.command({ roomId: "studio", targetTenantId: "athena", command: "show orbit" }); assert.equal(result.reply, "On it."); assert.equal(calls[0][1].actorUsername, "Guest"); assert.equal(calls[1][0], "speak");
  const frames = frameHearMeOutPersonaPcm(Uint8Array.from({ length: 1921 }, (_, index) => index % 255)); assert.equal(frames.length, 2); assert.equal(frames[1].byteLength, 1920); assert.equal(frames[1][0], 135); assert.equal(frames[1][1], 0);
});

test("StreamWeaver canonicalizes card packs and hands rendering to DSH through SPMT", async () => {
  const event = normalizeStreamWeaverCardPackEvent({ eventId: "pack:7", game: "quackverse", username: "Pilot", cards: [{ name: "Common", rarity: "common", imageUrl: "https://cdn.example/common.webp" }, { name: "Legend", rarity: "legendary", imageUrl: "https://cdn.example/legend.webp" }] }, () => "2026-09-03T00:00:00Z");
  assert.equal(event.featureCard.name, "Legend"); assert.deepEqual(decodeStreamWeaverCardPackEvent(encodeStreamWeaverCardPackEvent(event)), event); assert.match(buildStreamWeaverCardPackRenderUrl("https://stream.example", event), /capture=1/);
  const calls = [], client = { publishEvent: async (...args) => calls.push(["event", ...args]), createExecutionJob: async (...args) => { calls.push(["job", ...args]); return { job: { id: "job-1" }, duplicate: false }; } };
  const opened = await new StreamWeaverCardPackCoordinator(client, "https://stream.example").open("tenant-a", "user-a", event);
  assert.equal(opened.renderJob.id, "job-1"); assert.equal(calls[1][2].executionOwner, "discord-stream-hub");
});

test("SeaArt CLI polling extracts async results without logging credentials", async () => {
  let clock = 0; const calls = [], outputs = [{ stdout: "ok", stderr: "" }, { stdout: '{"task_id":"task_123456","status":"queued"}', stderr: "" }, { stdout: '{"status":"completed","images":["https://image.seaart.example/final.webp"]}', stderr: "" }];
  const provider = new SeaArtCliProvider("provider-token", { run: async (args) => { calls.push(args); return outputs.shift(); } }, async (ms) => { clock += ms; }, () => clock);
  const image = await provider.generateImage({ prompt: "a duck astronaut", modelNo: "model-1", modelVerNo: "version-1" });
  assert.equal(image.resourceUrl, "https://image.seaart.example/final.webp"); assert.deepEqual(extractSeaArtCliImageUrls('url=https://cdn.example/a.png'), ["https://cdn.example/a.png"]); assert.deepEqual(calls[2], ["task", "status", "task_123456"]);
});

test("StreamWeaver image service falls back and enhances prompts", async () => {
  const service = new StreamWeaverImageGenerationService([{ id: "primary", generateImage: async () => { throw new Error("temporarily unavailable"); } }, { id: "fallback", generateImage: async () => ({ taskId: "ok", resourceUrl: "https://cdn.example/fallback.png", resourceUrls: ["https://cdn.example/fallback.png"], provider: "seaart-cli" }) }], { enhance: async (prompt) => `${prompt}, cinematic light` });
  const output = await service.image({ prompt: "moon base", modelNo: "m", modelVerNo: "v" }); assert.deepEqual(output.attemptedProviders, ["primary", "fallback"]); assert.equal(output.prompt, "moon base, cinematic light");
});

test("StreamWeaver exposes every public persona plus the visible blocked Count exception and direct HearMeOut STT/TTS", async () => {
  const calls=[],service=new StreamWeaverHearMeOutPersonaService({listPersonas:async()=>[{tenantId:"moon",personaId:"moonbeam",displayName:"Moonbeam",aliases:["Moon"],ownerName:"Pilot",voice:"nova"}],transcribe:async()=>({transcription:"hello Moonbeam",provider:"stt"}),invoke:async(input)=>{calls.push(["invoke",input]);return{response:"Hello there."}},synthesize:async(input)=>{calls.push(["tts",input]);return{audioDataUri:"data:audio/wav;base64,QUJD",provider:"say"}}});
  const catalog=await service.catalog();assert.equal(catalog.length,2);assert.equal(catalog.find(item=>item.displayName==="The Count").canInvite,false);assert.equal(catalog.find(item=>item.displayName==="Moonbeam").canTalk,true);
  assert.equal((await service.transcribe("QUJD")).transcription,"hello Moonbeam");const reply=await service.command({targetTenantId:"moon",roomId:"studio",command:"say hello"});assert.equal(reply.tts.audioDataUri,"data:audio/wav;base64,QUJD");assert.equal(calls[0][1].actorUsername,"Guest");assert.equal(calls[1][1].source,"hearmeout-say");await assert.rejects(()=>service.command({targetTenantId:"thecountspmt",roomId:"studio",command:"hello"}),/does not participate/);
  const locked=resolveStreamWeaverCountInteraction({message:"hello The Count",eggs:{signal:false,rocket:false,blackHole:false},speakerNames:["Moonbeam"],random:()=>0});assert.equal(locked.unlocked,false);assert.match(locked.response,/static around Discord/);const open=resolveStreamWeaverCountInteraction({message:"Count, a riddle",eggs:{signal:true,rocket:true,blackHole:true},speakerNames:[]});assert.equal(open.unlocked,true);
});

test("StreamWeaver groups live members in canonical community order", () => {
  const groups = groupStreamWeaverLiveMembers([{ canonicalUserId: "u2", displayName: "Guest", provider: "twitch", channelUrl: "https://twitch.tv/guest", group: "unknown", viewerCount: 2 }, { canonicalUserId: "u1", displayName: "Crew", provider: "twitch", channelUrl: "https://twitch.tv/crew", group: "Crew", gameName: "Nebula", viewerCount: 9 }]);
  assert.deepEqual(groups.map((item) => item.group), ["Crew", "Everyone Else"]); assert.match(formatStreamWeaverLiveMemberGroups(groups), /Crew: Crew \(Nebula\)/);
});

test("MountainView routes image speech and consumes fresh Android wake commands", async () => {
  const plan = planMountainViewVoiceCommand("Hey Athena, generate an image of a purple mountain", { schemaVersion: 1, tenantId: "tenant-a", userId: "user-a" }); assert.equal(plan.action, "sw.image.generate"); assert.equal(plan.payload.prompt, "a purple mountain"); assert.equal(mountainViewWakeCommand("Hey Annie, switch OBS to BRB"), "switch OBS to BRB");
  const wake = new MountainViewForegroundWake({ startAthenaForegroundWake: async () => ({}), stopAthenaForegroundWake: async () => ({}), consumePendingWakeCommand: async () => ({ transcript: "Hey Athena, draw a comet", capturedAt: 1000 }) }, () => 1500); assert.equal((await wake.consume()).command, "draw a comet");
});

test("Companion offline wake protocol decodes local transcripts", () => { const transcript = "hey athena switch to brb", line = `${COMPANION_WAKE_PREFIX}${Buffer.from(transcript).toString("base64")}`; assert.deepEqual(decodeCompanionWakeLine(line), { type: "wake", transcript }); const script = companionPowerShellWakeScript(); assert.match(script, /System\.Speech/); assert.match(script, /SetInputToDefaultAudioDevice/); assert.doesNotMatch(script, /https?:\/\//); });

test("SpaceMountain recovers once and never treats outages as logout", () => { const gate = new SpaceMountainSessionRecoveryGate(); assert.equal(classifySpaceMountainSessionFailure({ status: 503 }), "temporarily-unavailable"); assert.equal(gate.canRecover({ status: 503 }), false); assert.equal(gate.canRecover({ status: 401 }), true); assert.equal(gate.canRecover({ status: 401 }), false); gate.authenticated(); assert.equal(gate.canRecover({ status: 403 }), true); gate.beginLogout(); assert.equal(gate.canRecover({ status: 401 }), false); });
