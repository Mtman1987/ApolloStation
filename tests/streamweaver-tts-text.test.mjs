import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeTextForTTS } from "../apps/streamweaver/dist/index.js";

test("TTS normalization preserves words and expands Mt. before a name", () => {
  assert.equal(normalizeTextForTTS("Hey Mt. Baker, welcome!"), "Hey M.T. Baker, welcome!");
});

test("TTS normalization removes Discord emotes, emoji, and Twitch emote tokens", () => {
  assert.equal(normalizeTextForTTS("Hello <a:dance:123456> Kappa 😄 :pogchamp: everyone!"), "Hello everyone!");
});

test("TTS normalization tidies punctuation and empty input", () => {
  assert.equal(normalizeTextForTTS("  Hello   world   !  "), "Hello world!");
  assert.equal(normalizeTextForTTS("   "), "");
});

test("all StreamWeaver synthesis entry points normalize text before creating speech jobs", () => {
  const sources = [
    "../apps/streamweaver/src/provider-runtime.ts",
    "../apps/streamweaver/src/stream-presentation-runtime.ts",
    "../apps/streamweaver/src/checkin-presentation.ts",
  ].map(path => readFileSync(new URL(path, import.meta.url), "utf8"));
  for (const source of sources) {
    assert.match(source, /normalizeTextForTTS/);
    assert.match(source, /There is no speakable text after removing emotes and emoji/);
  }
});
