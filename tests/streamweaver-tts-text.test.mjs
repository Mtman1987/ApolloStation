import assert from "node:assert/strict";
import test from "node:test";
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
