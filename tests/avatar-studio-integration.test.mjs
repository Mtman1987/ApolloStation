import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("../apps/streamweaver/src/avatar-studio.ts", import.meta.url), "utf8");
const host = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");

test("Apollo's Avatar Studio route uses the shared StreamWeaver editor", () => {
  assert.match(host, /url\.pathname === "\/avatar-studio"/);
  assert.match(host, /renderAvatarStudioPage\(nonce\)/);
  assert.match(host, /@spmt\/streamweaver\/dist\/avatar-studio\.js/);
});

test("2D PNG-Tuber and 3D GLB modes are available in the shared editor", () => {
  for (const id of ["avatarSourceMode", "pngTuberFile", "savePngTuber", "modelFile", "rigActivate3d", "exportCombinedGlb"]) {
    assert.ok(studio.includes('id="' + id + '"'), "missing control " + id);
  }
  assert.match(studio, /value="2d"/);
  assert.match(studio, /value="3d"/);
  assert.match(studio, /setAvatarSourceMode\(\)/);
});

test("Audio2Face bridge is optional and applies incoming data to the selected avatar", () => {
  assert.match(studio, /id="audio2FaceUrl"/);
  assert.match(studio, /new WebSocket\(endpoint\)/);
  assert.match(studio, /payload\.blendshapes/);
  assert.match(studio, /morphTargetDictionary/);
  assert.match(studio, /does not start NVIDIA Audio2Face itself/);
  assert.match(studio, /id="a2fTelemetry"/);
  assert.match(studio, /id="a2fBrowserTtsTest"/);
  assert.match(studio, /id="a2fBridgeTtsTest"/);
  assert.match(studio, /type:'tts_test'/);
  assert.match(studio, /a2fFrameCount\+\+/);
  assert.match(studio, /Browser TTS visual smoke test/);
  assert.match(studio, /not Audio2Face inference/);
});

test("3D model adjustment and direct GLB rigging controls are present", () => {
  for (const id of ["avatarTweakScale", "avatarTweakMorph", "rigActivate3d"]) {
    assert.ok(studio.includes('id="' + id + '"'), "missing control " + id);
  }
  assert.match(studio, /single-file GLB/);
  assert.match(studio, /No photo turnaround or second head reconstruction/);
});


test("StreamWeaver accepts avatar GLBs and shared media files up to 50 MiB", () => {
  const client = readFileSync(new URL("../apps/streamweaver/src/web-client.ts", import.meta.url), "utf8");
  const assets = readFileSync(new URL("../apps/streamweaver/src/assets-client.ts", import.meta.url), "utf8");
  assert.match(studio, /currentModelFile\.size > 50 \* 1024 \* 1024/);
  assert.match(client, /file\.size>50\*1024\*1024/);
  assert.match(assets, /file\.size>50\*1024\*1024/);
  assert.match(client, /up to 50 MiB/);
  assert.match(assets, /up to 50 MiB/);
});
