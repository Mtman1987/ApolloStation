import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("../apps/streamweaver/src/avatar-studio.ts", import.meta.url), "utf8");

test("Avatar Studio exposes skin-suit material controls, not a wardrobe", () => {
  for (const id of ["skinSuitControls", "skinTone", "applySkinSuit", "skinSuitStatus"]) {
    assert.ok(studio.includes('id="' + id + '"'), "missing skin-suit control " + id);
  }
  for (const tone of ["#f2d3c4", "#e0b08a", "#c68642", "#8d5524", "#4b2e1f"]) {
    assert.ok(studio.includes(tone), "missing skin tone " + tone);
  }
  assert.match(studio, /function applySkinSuit\(toneOverride=null\)/);
  assert.ok(studio.includes("applySkinSuit();attachGeneratedFace();"));
  assert.match(studio, /applySkinSuit\(matchedTone\)/);
  assert.match(studio, /material\.roughness=Math\.max\(material\.roughness,\.72\)/);
  assert.match(studio, /material\.normalScale\.set\(\.025,\.025\)/);
  assert.match(studio, /new THREE\.CanvasTexture\(canvas\)/);
  assert.match(studio, /hasGeneratedFace && !hasSkinSuitMaterial/);
  assert.match(studio, /hasGeneratedFace \|\| hasSkinSuitMaterial \|\| clips\.some/);
  assert.doesNotMatch(studio, /new THREE\.DataTexture/);
  assert.match(studio, /currentModelPurpose!==\'body\'/);
  assert.doesNotMatch(studio, /wardrobeLibrary|wardrobeAssets|wardrobeAttached|applyWardrobeAsset|CharacterCreator@master|clothing_tshirt\.glb/);
});

test("Skin suits use real base GLBs and leave the commissioned model on a separate view-only path", () => {
  assert.match(studio, /public\/models\/male-base-mesh-base_male\.glb/);
  assert.match(studio, /public\/models\/female-base-mesh-base_female\.glb/);
  assert.match(studio, /public\/models\/commissioned-finished-model\.glb/);
  assert.match(studio, /currentModelPurpose===\'finished\'/);
  assert.match(studio, /view-only/);
});
