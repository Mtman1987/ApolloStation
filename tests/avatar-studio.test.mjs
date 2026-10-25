import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("../apps/spacemountain-web/src/avatar-studio.ts", import.meta.url), "utf8");
const host = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");
const bay = readFileSync(new URL("../apps/spacemountain/src/overlay-bay-ui.ts", import.meta.url), "utf8");

test("Apollo exposes a dedicated Avatar Studio route with a constrained CDN policy", () => {
  assert.match(host, /url\.pathname === "\/avatar-studio"/);
  assert.match(host, /renderAvatarStudioPage\(nonce\)/);
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
  assert.match(studio, /Retargeted \x27\+added\.length/);
  assert.match(studio, /https:\/\/three\.ws\/animations\/clips\/idle\.json/);
  for (const file of ["Formal_Bow.gif","FunnyDancing_01.gif","Chair_Sit_Idle_M.gif","Big_Wave_Hello.gif","Confused_Scratch.gif","Discuss_While_Moving.gif","Dodge_and_Counter.gif","Call_Gesture.gif","Dozing_Elderly.gif"]) {
    assert.ok(studio.includes(file), "missing animation reference " + file);
  }
  assert.match(studio, /GIF reference only/);
});
