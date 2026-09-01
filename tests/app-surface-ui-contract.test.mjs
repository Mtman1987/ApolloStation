import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public surface contract carries scene pages and host-child page messages", async () => {
  const source = await read("packages/contracts/src/surface.ts");
  assert.match(source, /interface AppSurfaceManifestV1/);
  assert.match(source, /imageUrl: string/);
  assert.match(source, /pages: AppSurfacePageV1\[\]/);
  assert.match(source, /type: "surface\.manifest"/);
  assert.match(source, /type: "page\.open"/);
  assert.match(source, /type: "page\.changed"/);
  assert.match(source, /exactly one home page/);
});

test("SpaceMountain consumes published surface metadata without reading iframe DOM", async () => {
  const source = await read("apps/spacemountain/src/shell-ui.ts");
  assert.match(source, /isAppSurfaceMessageV1/);
  assert.match(source, /message\.type === "surface\.manifest"/);
  assert.match(source, /installProductBackdrop\(this\.options\.root/);
  assert.match(source, /data-spmt-surface-page/);
  assert.match(source, /type: "page\.open"/);
  assert.doesNotMatch(source, /contentDocument/);
});

test("shell viewport starts below the real header and collapsed dock never steals header width", async () => {
  const source = await read("apps/spacemountain/src/shell-ui.ts");
  assert.match(source, /header\.getBoundingClientRect\(\)/);
  assert.match(source, /main\.style\.setProperty\("position", "fixed", "important"\)/);
  assert.match(source, /main\.style\.setProperty\("top", `\$\{Math\.ceil\(headerRect\.bottom\) \+ gap\}px`, "important"\)/);
  assert.match(source, /dock\.style\.setProperty\("top", `\$\{Math\.max\(8, Math\.ceil\(headerRect\.top\)\)\}px`, "important"\)/);
  assert.match(source, /root\.dataset\.spmtDock === "collapsed"[\s\S]*dock\.style\.setProperty\("bottom", "auto", "important"\)/);
  assert.match(source, /data-spmt-dock="collapsed"\][\s\S]*\.spmt-shell-header-stack\{left:108px!important\}/);
  assert.doesNotMatch(source, /\.spmt-shell-header-stack\{left:94px!important\}/);
  assert.match(source, /window\.visualViewport\?\.addEventListener\("resize", this\.geometryListener\)/);
  assert.match(source, /\.spmt-workspace-tray\{z-index:870!important\}/);
  assert.match(source, /\.spmt-rocket-dock\{z-index:860!important\}/);
});

test("generic product apps keep their app-owned scene while shell controls layout", async () => {
  const source = await read("packages/app-foundation/src/surface-client.ts");
  assert.match(source, /productSurfaceManifest/);
  assert.match(source, /home: true/);
  assert.match(source, /document\.documentElement/);
  assert.match(source, /data-surface="shell"[\s\S]*spmt-product-backdrop\{display:block!important\}/);
  assert.doesNotMatch(source, /html\.style\.setProperty\('background','transparent','important'\)/);
  assert.doesNotMatch(source, /body\.style\.setProperty\('background','transparent','important'\)/);
  assert.match(source, /function setMode\(mode\)\{html\.dataset\.spmtSurfaceMode=mode\}/);
  assert.match(source, /\.owned \.home\{height:100%!important;min-height:0!important;overflow:hidden!important\}/);
  assert.match(source, /\.owned \.app-page\{height:100%!important;min-height:0!important;overflow:auto!important/);
  assert.match(source, /data-spmt-surface-shortcut/);
  assert.match(source, /scrollbar-width:thin/);
  assert.match(source, /::-webkit-scrollbar\{width:4px;height:4px\}/);
});

test("Green app-owned web surfaces publish their own scenes and pages", async () => {
  for (const path of [
    "apps/discord-stream-hub/src/web-server.ts",
    "apps/streamweaver/src/web-server.ts",
    "apps/mountainview/src/web-server.ts",
    "apps/companion/src/web-server.ts",
  ]) {
    const source = await read(path);
    assert.match(source, /productSurfaceManifest/);
    assert.match(source, /appSurfaceBrowserJs/);
    assert.match(source, /sceneUrl:/);
  }
});

test("HearMeOut keeps its own shell scene and delegates Rooms navigation to real app controls", async () => {
  const surface = await read("apps/hearmeout/src/surface-client.ts");
  const web = await read("apps/hearmeout/src/web-server.ts");
  assert.match(surface, /hearmeout-background\.webp/);
  assert.match(surface, /id: "rooms"/);
  assert.match(surface, /data-hmo-open-rooms/);
  assert.match(surface, /document\.documentElement/);
  assert.match(surface, /data-surface="shell"[\s\S]*spmt-product-backdrop\{display:block!important\}/);
  assert.doesNotMatch(surface, /html\.style\.setProperty\('background','transparent','important'\)/);
  assert.doesNotMatch(surface, /body\.style\.setProperty\('background','transparent','important'\)/);
  assert.match(surface, /function setMode\(mode\)\{html\.dataset\.spmtSurfaceMode=mode\}/);
  assert.match(surface, /hmo-room-scroll[\s\S]*scrollbar-width:thin/);
  assert.match(surface, /\.hmo-home\[hidden\],\.hmo-rooms\[hidden\]\{display:none!important\}/);
  assert.match(surface, /data-hmo-view=\\"rooms\\"\] \.hmo-home\{display:none!important\}/);
  assert.match(surface, /data-hmo-view=\\"rooms\\"\] \.hmo-rooms\{display:grid!important;height:100%!important;min-height:0!important;overflow:hidden!important\}/);
  assert.match(web, /HEARMEOUT_SURFACE_BROWSER_JS/);
});

test("Nebula Arcade keeps its app-owned scene in shell mode", async () => {
  const source = await read("apps/nebula-arcade/src/nebula-theme-css.ts");
  assert.match(source, /data-surface="shell"\]>\.spmt-product-backdrop\{display:block\}/);
  assert.doesNotMatch(source, /data-surface="shell"\]>\.spmt-product-backdrop,[\s\S]*display:none/);
});
