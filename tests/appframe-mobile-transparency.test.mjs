import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");

test("embedded AppFrame wrappers stay visually absent and transparent on mobile Chromium", () => {
  assert.match(wrapper, /applyAppFramePresentation\(frame\)/);
  assert.match(wrapper, /shell\.style\.border = "0"/);
  assert.match(wrapper, /shell\.style\.borderRadius = "0"/);
  assert.match(wrapper, /shell\.style\.background = "transparent"/);
  assert.match(wrapper, /frame\.style\.background = "transparent"/);
  assert.match(wrapper, /frame\.style\.setProperty\("color-scheme", "normal"\)/);
  assert.match(wrapper, /frame\.setAttribute\("allowtransparency", "true"\)/);
});
