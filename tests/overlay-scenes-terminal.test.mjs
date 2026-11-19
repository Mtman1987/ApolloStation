import test from "node:test";
import assert from "node:assert/strict";
import {
  createOverlayScene,
  createOverlaySource,
  normalizeOverlayScene,
  sourceLabel,
} from "../apps/spacemountain/dist/overlay-scenes.js";

test("Overlay Bay accepts and preserves the native Apollo diagnostic terminal source", () => {
  const scene = createOverlayScene("Owner diagnostics");
  const terminal = createOverlaySource("terminal");
  scene.sources.push(terminal);
  const normalized = normalizeOverlayScene(scene);
  assert.equal(normalized.sources[0]?.kind, "terminal");
  assert.equal(normalized.sources[0]?.name, "Apollo Diagnostic Terminal");
  assert.equal(sourceLabel("terminal"), "Apollo Diagnostic Terminal");
});
