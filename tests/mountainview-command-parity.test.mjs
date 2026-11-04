import assert from "node:assert/strict";
import test from "node:test";
import { createCompanionDeviceCommand, planMountainViewVoiceCommand } from "../apps/mountainview/dist/index.js";

const context={schemaVersion:1,tenantId:"tenant-a",userId:"captain",targetCompanionDeviceId:"pc-1",hearMeOutRoomId:"room-a"};

test("MountainView routes donor OBS and Companion audio commands deterministically",()=>{
 const scene=planMountainViewVoiceCommand("switch OBS to BRB",context);assert.equal(scene.kind,"route");assert.equal(scene.targetAppId,"companion");assert.equal(scene.action,"obs.scene.set");assert.equal(scene.payload.sceneName,"BRB");
 const mute=planMountainViewVoiceCommand("mute the PC companion",context);assert.equal(mute.kind,"route");assert.equal(mute.action,"media.mute.set");assert.equal(mute.payload.muted,true);
 const unmute=planMountainViewVoiceCommand("unmute the PC companion",context);assert.equal(unmute.kind,"route");assert.equal(unmute.payload.muted,false);
 const volume=planMountainViewVoiceCommand("set PC companion volume to 50 percent",context);assert.equal(volume.kind,"route");assert.equal(volume.action,"media.volume.set");assert.equal(volume.payload.volume,.5);
 const relay=createCompanionDeviceCommand({plan:volume,context,commandId:"cmd-1",idempotencyKey:"idem-1",requestedAt:"2026-08-25T03:00:00.000Z"});assert.equal(relay.capability,"media.playback");assert.equal(relay.targetDeviceId,"pc-1");
});

test("MountainView routes concrete music and watch requests to HearMeOut",()=>{
 const song=planMountainViewVoiceCommand("play the song Squad Goals by Prof",context);assert.equal(song.kind,"route");assert.equal(song.targetAppId,"hearmeout");assert.equal(song.action,"hmo.media.request");assert.equal(song.payload.query,"Squad Goals by Prof");assert.equal(song.payload.roomId,"room-a");
 const pause=planMountainViewVoiceCommand("pause music",context);assert.equal(pause.kind,"route");assert.equal(pause.action,"hmo.media.control");assert.equal(pause.payload.control,"pause");
 const next=planMountainViewVoiceCommand("skip the music",context);assert.equal(next.kind,"route");assert.equal(next.action,"hmo.media.control");assert.equal(next.payload.control,"next");
 const movie=planMountainViewVoiceCommand("watch movie The Matrix",context);assert.equal(movie.kind,"route");assert.equal(movie.action,"hmo.media.request");assert.equal(movie.payload.lane,"movie");assert.equal(movie.payload.query,"The Matrix");
});

test("MountainView keeps community live status separate from the Nebula Arcade tag game game module",()=>{
 const everyone=planMountainViewVoiceCommand("who's live",context);assert.equal(everyone.kind,"route");assert.equal(everyone.targetAppId,"discord-stream-hub");assert.equal(everyone.action,"dsh.shoutouts.live.read");
 const game=planMountainViewVoiceCommand("who's active in Nebula Arcade",context);assert.equal(game.kind,"route");assert.equal(game.targetAppId,"nebula-arcade");assert.equal(game.action,"nebula-arcade.tag.live-members.read");
});

test("MountainView refuses local controls when no Companion is paired",()=>{
 const plan=planMountainViewVoiceCommand("mute the PC companion",{...context,targetCompanionDeviceId:undefined});assert.equal(plan.kind,"clarify");assert.match(plan.reason,/Pair a Companion/);
});
