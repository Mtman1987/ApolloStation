import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const integration = readFileSync(new URL("../apps/spacemountain-web/src/avatar-studio-integration.ts", import.meta.url), "utf8");
const host = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");

test("Avatar Studio route uses the integrated source selector wrapper", () => {
  assert.match(host, /from "\.\/avatar-studio-integration\.js"/);
  assert.match(host, /renderAvatarStudioPage\(nonce\)/);
  assert.match(integration, /renderBaseAvatarStudioPage\(nonce\)/);
});

test("2D PNG-Tuber and 3D model modes share the existing Avatar Studio route", () => {
  assert.match(integration, /id="avatarSourceMode"/);
  assert.match(integration, /value="3d"/);
  assert.match(integration, /value="2d"/);
  assert.match(integration, /id="pngTuberFile"/);
  assert.match(integration, /id="pngTuberSpeakingFile"/);
  assert.match(integration, /room\.classList\.toggle\('avatar-mode-2d', is2d\)/);
  assert.match(integration, /setAvatarSourceMode\(\)/);
});

test("Audio2Face bridge is optional and applies incoming morph data without claiming to launch NVIDIA Audio2Face", () => {
  assert.match(integration, /id="audio2FaceUrl"/);
  assert.match(integration, /new WebSocket\(endpoint\)/);
  assert.match(integration, /payload\.blendshapes/);
  assert.match(integration, /node\.morphTargetDictionary/);
  assert.match(integration, /does not start NVIDIA Audio2Face itself/);
  assert.match(integration, /Audio2Face bridge disconnected/);
});
