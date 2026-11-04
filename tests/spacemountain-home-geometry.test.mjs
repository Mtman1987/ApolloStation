import test from "node:test";
import assert from "node:assert/strict";
import { THEMED_SURFACE_CSS } from "../apps/spacemountain/dist/themed-surface-css.js";

test("SpaceMountain Home derives its height from the shared shell top and bottom insets", () => {
  assert.match(
    THEMED_SURFACE_CSS,
    /\.spmt-space-root \.spmt-space-main\{[^}]*position:absolute;[^}]*top:calc\([^}]*bottom:18px;[^}]*height:auto/,
  );
  assert.match(
    THEMED_SURFACE_CSS,
    /\.spmt-space-root\[data-spmt-view="home"\] \.spmt-space-main,\.spmt-space-root\[data-spmt-view="app"\] \.spmt-space-main\{height:auto;overflow:hidden/,
  );
});
