import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");

test("embedded AppFrame wrappers are transparent before mobile Chromium creates the iframe canvas", () => {
  assert.match(wrapper, /APPFRAME_PRESENTATION_CSS/);
  assert.match(wrapper, /iframe\[data-shell-app-frame\].*background:transparent!important.*color-scheme:normal!important/);
  const mount = wrapper.match(/mount\(\) \{([^\n]+)\}/)?.[1] ?? "";
  const presentationIndex = mount.indexOf("this.installAppFramePresentationContract()");
  const baseMountIndex = mount.indexOf("this.base.mount()");
  assert.ok(presentationIndex >= 0 && baseMountIndex > presentationIndex, "first-paint AppFrame CSS must install before the base shell creates an iframe");
  assert.match(wrapper, /style\.textContent = APPFRAME_PRESENTATION_CSS/);
  assert.match(wrapper, /applyAppFramePresentation\(frame\)/);
  assert.match(wrapper, /shell\.style\.border = "0"/);
  assert.match(wrapper, /shell\.style\.borderRadius = "0"/);
  assert.match(wrapper, /shell\.style\.background = "transparent"/);
  assert.match(wrapper, /frame\.style\.background = "transparent"/);
  assert.match(wrapper, /frame\.style\.setProperty\("color-scheme", "normal"\)/);
  assert.match(wrapper, /frame\.setAttribute\("allowtransparency", "true"\)/);
});

test("app surface navigation survives an iframe launch reload", () => {
  assert.match(wrapper, /this\.applyAppSurfaceManifest\(\);[\s\S]{0,400}this\.openSurfacePage\(this\.activeSurfacePage\);/);
  assert.match(wrapper, /private openSurfacePage\(pageId: string\)[\s\S]*this\.activeSurfacePage = pageId;\s*this\.syncSurfacePageState\(\);[\s\S]*type: "page\.open"/);
});

test("the rocket rail overlays full-width app surfaces and resets its geometry on toggle", () => {
  assert.match(wrapper, /main\.style\.setProperty\("left", `\$\{edge\}px`/);
  assert.doesNotMatch(wrapper, /const mainLeft = mobile \? 108/);
  assert.match(wrapper, /const toggleSize = 72;/);
  assert.match(wrapper, /if \(root\.dataset\.spmtDock === "collapsed"\)[\s\S]{0,400}dock\.style\.setProperty\("height", `\$\{toggleSize\}px`, "important"\)/);
  assert.match(wrapper, /const mainBottom = Math\.floor\(main\.getBoundingClientRect\(\)\.bottom\);[\s\S]{0,400}dock\.style\.setProperty\("height", `\$\{Math\.max\(toggleSize, mainBottom - Math\.ceil\(headerRect\.top\)\)\}px`, "important"\)/);
  assert.match(wrapper, /attributeFilter: \["data-spmt-dock"\]/);
});
