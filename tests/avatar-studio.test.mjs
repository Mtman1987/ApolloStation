import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("../apps/streamweaver/src/avatar-studio.ts", import.meta.url), "utf8");
const host = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");
const bay = readFileSync(new URL("../apps/spacemountain/src/overlay-bay-ui.ts", import.meta.url), "utf8");

test("Apollo exposes a dedicated Avatar Studio route with a constrained CDN policy", () => {
  assert.match(host, /url\.pathname === "\/avatar-studio"/);
  assert.match(host, /renderAvatarStudioPage\(nonce\)/);
  assert.match(host, /@spmt\/streamweaver\/dist\/avatar-studio\.js/);
  assert.match(host, /https:\/\/cdn\.jsdelivr\.net/);
});

test("Avatar Studio provides a same-room toggle, GLB model upload, and unified clip selector", () => {
  assert.match(studio, /id="toggle"/);
  assert.match(studio, /id="modelFile" type="file"/);
  assert.match(studio, /id="animationFile" type="file"/);
  assert.match(studio, /id="clipSelect"/);
  assert.match(studio, /id="triggerClip"/);
  assert.match(studio, /setEditor\(editor\.hidden\)/);
  assert.match(studio, /g\.animations\.map/);
});

test("Avatar Studio exposes manually configurable event and AI trigger mappings", () => {
  for (const label of ["AI command", "Twitch follow", "Subscription", "Raid", "Channel Point redemption", "Chat command"]) {
    assert.ok(studio.includes(label), "missing trigger source: " + label);
  }
  assert.match(studio, /id="triggerName" value="bow_gesture"/);
  assert.match(studio, /id="addTrigger"/);
});

test("Overlay Bay links to Avatar Studio without replacing the existing video avatar flow", () => {
  assert.match(bay, /data-ob-avatar-studio/);
  assert.match(bay, /window\.open\("\/avatar-studio"/);
  assert.doesNotMatch(bay, /streamweaver.*avatar.*replace/i);
});

test("Avatar Studio has a retargetable shared motion library and labels GIFs honestly as references", () => {
  assert.match(studio, /@three-ws\/retarget/);
  assert.match(studio, /loadMotionLibrary/);
  assert.match(studio, /retargetClipToObject/);
  assert.match(studio, /for\(const sourceClip of g\.animations\)/);
  assert.match(studio, /Quaternius Universal Animation Library/);
  assert.match(studio, /id="cohostAction"/);
  assert.match(studio, /id="clipCategory"/);
  assert.match(studio, /function playCohostAction/);
  for (const preset of ['laugh','cheer','love','sad','angry','thinking']) assert.match(studio, new RegExp('value="'+preset+'"'));
  assert.match(studio, /idle-sitting/);
  assert.match(studio, /UAL1_Standard/);
  assert.match(studio, /UAL2_Standard/);
  assert.match(studio, /Rig_Medium_General\\.glb/);
  assert.match(studio, /KayKit General · CC0/);
  assert.match(studio, /Sitting_Idle|idle-sitting/);
  assert.match(studio, /CC0/);
  for (const file of ["Formal_Bow.gif","FunnyDancing_01.gif","Chair_Sit_Idle_M.gif","Big_Wave_Hello.gif","Confused_Scratch.gif","Discuss_While_Moving.gif","Dodge_and_Counter.gif","Call_Gesture.gif","Dozing_Elderly.gif"]) {
    assert.ok(studio.includes(file), "missing animation reference " + file);
  }
  assert.match(studio, /GIF reference only/);
});

test("Avatar Studio saves the chosen 2D or 3D avatar and connects Audio2Face to the shared source", () => {
  for (const id of ["avatarSourceMode", "savePngTuber", "saveAudio2Face", "rigActivate3d", "exportCombinedGlb", "audio2FaceUrl", "avatarTweakScale", "avatarTweakMorph"]) {
    assert.ok(studio.includes('id="' + id + '"'), "missing integrated control " + id);
  }
  assert.match(studio, /modelAssetId:asset\.id/);
  assert.match(studio, /audio2FaceUrl:a2fUrl\.value\.trim\(\)/);
  assert.match(studio, /No photo turnaround or second head reconstruction/);
  assert.match(studio, /single-file GLB/);
});

test("Avatar Studio offers separate generic male/female bodies and an unchanged commissioned-model viewer", () => {
  assert.match(studio, /value="male-body"/);
  assert.match(studio, /value="female-body"/);
  assert.match(studio, /value="commissioned"/);
  assert.match(studio, /male-base-mesh-base_male\.glb/);
  assert.match(studio, /female-base-mesh-base_female\.glb/);
  assert.match(studio, /Meshy_AI_Neon_Lock_In_Gamer_All_Animations%20\(1\)\.glb/);
  assert.match(studio, /https:\/\/cdn\.jsdelivr\.net\/gh\/Mtman1987\/3davatar@main/);
  assert.doesNotMatch(studio, /raw\.githubusercontent\.com\/Mtman1987\/3davatar/);
  assert.match(studio, /currentModelPurpose==='finished'/);
  assert.match(studio, /currentModelPurpose === 'finished'.*view-only/s);
  assert.match(studio, /if\(!avatar\|\|currentModelPurpose==='finished'\)return/);
  assert.match(studio, /currentModelPurpose!=='finished'/);
});

test("Avatar Studio generates a photo-based ARKit face on generic bodies and preserves the separate finished-model viewer", () => {
  for (const id of ["facePhotoCamera", "facePhotoLibrary", "faceChoice", "facePreset", "faceExpression", "faceHeadScale", "faceHeadY", "faceHeadZ", "generate2dPng", "faceGenerationStatus"]) {
    assert.ok(studio.includes('id="' + id + '"'), "missing face-generation control " + id);
  }
  assert.match(studio, /face-builder-browser\.js/);
  assert.match(studio, /FaceLandmarker\.createFromOptions/);
  assert.match(studio, /AvatarAceFaceBuilder\.buildFace/);
  assert.match(studio, /ARKIT_BLENDSHAPE_NAMES/);
  assert.match(studio, /hasGeneratedFace/);
  assert.match(studio, /if\(currentModelPurpose==='body'\)attachGeneratedFace\(\)/);
  assert.match(studio, /storage\.googleapis\.com/);
  assert.match(host, /connect-src[^;]*https:\/\/storage\.googleapis\.com/);
  assert.match(host, /wasm-unsafe-eval/);
  assert.match(host, /worker-src 'self' blob:/);
});
