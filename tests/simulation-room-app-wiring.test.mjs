import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DshSimulationRoomDiscordTransport } from "../apps/discord-stream-hub/dist/index.js";
import { HearMeOutWebSuiteActionExecutor, SqliteHearMeOutRoomMediaRuntime } from "../apps/hearmeout/dist/index.js";

test("DSH keeps server/channel reads live while all Discord writes become exact tenant room previews", async () => {
  const providerReads = [];
  const provider = {
    async listGuilds(tenantId) { providerReads.push(["guilds", tenantId]); return [{ id: "11111", name: "Apollo" }]; },
    async listGuildChannels(tenantId, guildId) { providerReads.push(["channels", tenantId, guildId]); return [{ id: "22222", name: "launch-control", type: 0, position: 1 }]; },
  };
  const events = [];
  const client = { async publishSimulationRoomEvent(tenantId, input, idempotencyKey) { events.push({ tenantId, input, idempotencyKey }); return { id: `event-${events.length}` }; } };
  const shadow = new DshSimulationRoomDiscordTransport(provider, client, { guildIds: () => ["11111"], now: () => "2026-09-05T12:00:00.000Z" });
  assert.equal((await shadow.listGuilds("tenant-a"))[0].name, "Apollo");
  assert.equal((await shadow.listGuildChannels("tenant-a", "11111"))[0].name, "launch-control");
  const messageId = await shadow.createMessage("tenant-a", "22222", { content: "Hello shadow", embeds: [{ title: "Launch", description: "Exact payload" }] });
  await shadow.editMessage("tenant-a", "22222", messageId, { content: "Updated shadow" });
  await shadow.deleteMessage("tenant-a", "22222", messageId);
  await shadow.sendDirectMessage("tenant-b", "33333", { content: "Private preview" });
  assert.match(messageId, /^\d{18}$/);
  assert.deepEqual(providerReads, [["guilds", "tenant-a"], ["channels", "tenant-a", "11111"]]);
  assert.deepEqual(events.slice(0, 3).map((event) => event.input.roomId), ["discord:11111:22222", "discord:11111:22222", "discord:11111:22222"]);
  assert.deepEqual(events.slice(0, 3).map((event) => event.input.data.operation), ["create", "edit", "delete"]);
  assert.deepEqual(events[0].input.data.payload, { content: "Hello shadow", embeds: [{ title: "Launch", description: "Exact payload" }] });
  assert.equal(events[3].tenantId, "tenant-b");
  assert.equal(events[3].input.roomId, "discord:dm:33333");
});

test("HearMeOut simulation jobs read the real room but cannot mutate media, persona, or voice state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hmo-simulation-room-"));
  const rooms = new SqliteHearMeOutRoomMediaRuntime(join(directory, "hearmeout.sqlite"));
  const principal = { tenantId: "tenant-a", userId: "user-a", displayName: "Member", roles: ["member"] };
  let mediaCalls = 0;
  const executor = new HearMeOutWebSuiteActionExecutor(rooms, { async resolve() { mediaCalls += 1; throw new Error("simulation must not resolve media"); } });
  try {
    rooms.createRoom(principal, { roomId: "studio", name: "Studio", privacy: "public", operationId: "create-studio", now: new Date().toISOString() });
    const base = { schemaVersion: 1, actor: { userId: "user-a", username: "Member", role: "member" }, source: { kind: "voice-commander", requestId: "request-1", simulation: true } };
    const media = await executor.execute({ ...base, action: "hmo.media.request", args: { roomId: "studio", query: "Space Oddity" } }, { tenantId: "tenant-a", idempotencyKey: "media-1" });
    assert.equal(media.simulation, true);
    assert.match(media.text, /No live room, media provider, persona, or Discord voice state was changed/);
    assert.equal(mediaCalls, 0);
    assert.equal(rooms.getSession("tenant-a", "studio", "music").current, null);
    const voice = await executor.execute({ ...base, action: "hmo.voice.bridge.control", args: { roomId: "studio", control: "start", guildId: "11111", voiceChannelId: "22222" } }, { tenantId: "tenant-a", idempotencyKey: "voice-1" });
    assert.equal(voice.simulation, true);
    assert.match(voice.text, /Discord voice control start/);
  } finally {
    rooms.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const liveWrites of [false,true]) test(`named shadow Discord destinations preserve exact embeds with live writes ${liveWrites}`, async () => {
  const {simulationDiscordIds} = await import('../packages/contracts/dist/index.js');
  let rooms=[{roomId:'room-a',name:'My embed lab'},{roomId:'room-b',name:'Other room'}];
  let writes=0, reads=0;
  const events=[];
  const client={listSimulationRooms:async tenant=>tenant==='tenant-a'?rooms:[],publishSimulationRoomEvent:async(tenant,input)=>events.push({tenant,input})};
  const provider={listGuilds:async()=>{reads++;throw new Error('No Discord bot connected');},listGuildChannels:async()=>{reads++;return[];},createMessage:async()=>{writes++;return'live-message';},editMessage:async()=>{writes++;},deleteMessage:async()=>{writes++;}};
  const transport=new DshSimulationRoomDiscordTransport(provider,client,{liveWrites});
  const ids=simulationDiscordIds('tenant-a','room-a');
  const guilds=await transport.listGuilds('tenant-a');
  assert.equal(guilds[0].name,'Shadow · My embed lab');
  assert.equal(guilds[0].id,ids.guildId);
  assert.equal((await transport.listGuildChannels('tenant-a',ids.guildId))[0].id,ids.channelId);
  const payload={embeds:[{title:'Application',description:'Exact tier appearance',color:0x38bdf8}],components:[{type:1,components:[{type:2,style:1,label:'Apply',custom_id:`application_start:mod:${ids.guildId}`}]}]};
  const messageId=await transport.createMessage('tenant-a',ids.channelId,payload);
  await transport.editMessage('tenant-a',ids.channelId,messageId,{...payload,content:'Updated'});
  await transport.deleteMessage('tenant-a',ids.channelId,messageId);
  assert.equal(writes,0);
  assert.equal(reads,1,'virtual channel lookup does not consult Discord');
  assert.deepEqual(events.map(event=>event.input.roomId),['room-a','room-a','room-a']);
  assert.deepEqual(events[0].input.data.payload,payload);
  assert.equal(events[0].input.data.explicitRoom,true);
  assert.equal(events[1].input.data.messageId,messageId);
  await assert.rejects(transport.createMessage('tenant-b',ids.channelId,payload),/no longer available/);
  rooms=[];
  await assert.rejects(transport.createMessage('tenant-a',ids.channelId,payload),/no longer available/);
  assert.equal(writes,0,'deleted or foreign shadow destinations never fall through to Discord');
  if(liveWrites){assert.equal(await transport.createMessage('tenant-a','1234567890',payload),'live-message');assert.equal(writes,1);}
});
