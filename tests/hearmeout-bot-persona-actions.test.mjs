import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HearMeOutBotActionAdapter, SqliteHearMeOutPersonaRoomController, SqliteHearMeOutRoomMediaRuntime } from "../apps/hearmeout/dist/index.js";

const owner = { tenantId: "tenant-a", userId: "owner-a", displayName: "Owner", roles: ["admin", "member"] };
const member = { tenantId: "tenant-a", userId: "member-a", displayName: "Member", roles: ["member"] };

test("HearMeOut bot actions never fall into a global media queue and preserve exact volume", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "apollo-hmo-actions-"));
  const rooms = new SqliteHearMeOutRoomMediaRuntime(path.join(dir, "hmo.sqlite"));
  const now = new Date().toISOString();
  const joinedAt = new Date(Date.parse(now) + 1_000).toISOString();
  let resolved = 0;
  const adapter = new HearMeOutBotActionAdapter(rooms, { resolve: async () => { resolved += 1; return { itemId: "song-1", type: "music", title: "Song", source: "test", playbackUrl: "https://media.example/song.mp3" }; } });
  try {
    rooms.createRoom(owner, { roomId: "studio", name: "Studio", privacy: "public", operationId: "create-studio", now });
    rooms.joinRoom(member, "studio", "join-member", joinedAt);
    await assert.rejects(() => adapter.execute("hmo.media.request", member, { query: "Space Oddity" }, "outside-room"), /not sent to a global queue/);
    assert.equal(resolved, 0);
    const requested = await adapter.execute("hmo.media.request", member, { roomId: "studio", query: "Space Oddity" }, "request-song");
    assert.equal(resolved, 1);
    assert.equal(requested.session.current.item.title, "Song");
    const volume = await adapter.execute("hmo.media.control", owner, { roomId: "studio", control: "volume", value: "42" }, "volume-42");
    assert.equal(volume.session.playback.volume, 42);
  } finally { rooms.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("tenant persona joins with a service session and publishes bounded room audio", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "apollo-hmo-persona-"));
  const databasePath = path.join(dir, "hmo.sqlite");
  const rooms = new SqliteHearMeOutRoomMediaRuntime(databasePath);
  const now = new Date().toISOString();
  const calls = [];
  const personas = new SqliteHearMeOutPersonaRoomController(databasePath, rooms, { control: async (input) => { calls.push(["control", input]); return { running: true }; }, speak: async (input) => { calls.push(["speak", input]); return { published: true }; } }, () => now);
  const persona = { personaId: "moonbeam", displayName: "Moonbeam", ownerTenantId: "tenant-a", aliases: ["moon"], interests: ["space"], canInvite: true };
  try {
    rooms.createRoom(owner, { roomId: "studio", name: "Studio", privacy: "private", operationId: "create-private", now });
    await assert.rejects(() => personas.control(member, { roomId: "studio", action: "join", persona }), /management is required/);
    const joined = await personas.control(owner, { roomId: "studio", action: "join", persona });
    assert.equal(joined.presence.persona.displayName, "Moonbeam");
    assert.equal(calls[0][1].serviceSession, true);
    await personas.speak(owner, { roomId: "studio", personaId: "moonbeam", audioDataUri: "data:audio/wav;base64,QUJD" });
    assert.equal(calls[1][0], "speak");
    await assert.rejects(() => personas.speak(owner, { roomId: "studio", personaId: "moonbeam", audioDataUri: "data:text/plain;base64,QUJD" }), /audio is invalid/);
  } finally { personas.close(); rooms.close(); rmSync(dir, { recursive: true, force: true }); }
});
