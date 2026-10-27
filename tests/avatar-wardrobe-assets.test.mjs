import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("../apps/streamweaver/src/avatar-studio.ts", import.meta.url), "utf8");
const credits = readFileSync(new URL("../apps/streamweaver/AVATAR-WARDROBE-ASSETS.md", import.meta.url), "utf8");

test("Avatar Studio exposes real CC0 hairstyle and clothing selectors", () => {
  for (const id of ["hairStyle", "applyHair", "wardrobeTop", "wardrobeBottom", "wardrobeOuterwear", "wardrobeShoes", "applyClothing", "clearWardrobe"]) {
    assert.ok(studio.includes('id="' + id + '"'), "missing wardrobe control " + id);
  }
  for (const asset of ["hair_short02.glb", "hair_short04.glb", "hair_bob01.glb", "hair_bob02.glb", "hair_long01.glb", "hair_ponytail01.glb", "hair_braid01.glb", "hair_afro01.glb", "clothing_tshirt.glb", "clothing_jeans.glb", "clothing_hoodie.glb", "clothing_jacket.glb", "clothing_dress.glb", "clothing_trenchcoat.glb", "clothing_shoes.glb", "clothing_boots.glb"]) {
    assert.ok(studio.includes(asset), "missing asset mapping " + asset);
  }
  assert.match(studio, /https:\/\/cdn\.jsdelivr\.net\/gh\/kblood\/CharacterCreator@master\/output\//);
});

test("Wardrobe is guarded from the commissioned view-only model", () => {
  assert.match(studio, /currentModelPurpose==='finished'/);
  assert.match(studio, /commissioned finished model is view-only/);
  assert.match(studio, /avatar\.add\(item\)/);
});

test("Wardrobe asset provenance and fit limitations are documented", () => {
  assert.match(credits, /CC0-1\.0/);
  assert.match(credits, /not explicitly re-rigged/);
  assert.match(credits, /view-only/);
});
