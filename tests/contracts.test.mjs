import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOverlayWidgetManifestV1,
  isEmbedBridgeMessageV1,
  isShellLayoutMetricsV1,
  isSurfaceModeV1,
} from "../packages/contracts/dist/index.js";
import { effectiveShellTopInset, usableShellRect } from "../packages/embed/dist/index.js";

const wrappedHeader = {
  schemaVersion: 1,
  headerHeight: 132,
  safeTop: 24,
  safeRight: 0,
  safeBottom: 16,
  safeLeft: 0,
  availableWidth: 390,
  availableHeight: 844,
  measuredAt: new Date(0).toISOString(),
};

test("SurfaceModeV1 accepts only the four canonical modes", () => {
  for (const mode of ["shell", "standalone", "overlay", "popout"]) assert.equal(isSurfaceModeV1(mode), true);
  assert.equal(isSurfaceModeV1("embedded-special-case"), false);
});

test("shell mode always reserves measured header plus device safe area", () => {
  assert.equal(isShellLayoutMetricsV1(wrappedHeader), true);
  assert.equal(effectiveShellTopInset("shell", wrappedHeader), 156);
  const rect = usableShellRect("shell", wrappedHeader);
  assert.equal(rect.top, 156);
  assert.equal(rect.height, 672);
  assert.ok(rect.bottom <= wrappedHeader.availableHeight);
});

test("headless overlay does not inherit workspace header", () => {
  assert.equal(effectiveShellTopInset("overlay", wrappedHeader), 24);
  const rect = usableShellRect("overlay", wrappedHeader);
  assert.equal(rect.top, 24);
});

test("embed bridge rejects ad-hoc app-specific messages", () => {
  assert.equal(isEmbedBridgeMessageV1({ protocol: "my-custom-app", version: 1, type: "layout.changed" }), false);
  assert.equal(isEmbedBridgeMessageV1({ protocol: "spmt.embed", version: 1, type: "layout.changed", layout: wrappedHeader }), true);
});

test("overlay manifests reject insecure remote renderer URLs", () => {
  assert.throws(() => assertOverlayWidgetManifestV1({
    schemaVersion: 1,
    appId: "reference",
    widgetId: "status",
    title: "Status",
    kind: "status",
    rendererUrl: "http://example.com/overlay",
    requiredScopes: [],
    supportsAudio: false,
    supportsInteraction: false,
  }));
});
