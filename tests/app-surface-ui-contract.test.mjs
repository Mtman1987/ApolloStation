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

test("embedded app viewport leaves chrome floating above it and mobile rocket stays top-left", async () => {
  const source = await read("apps/spacemountain/src/shell-ui.ts");
  assert.match(source, /\.spmt-space-root\[data-spmt-view="app"\] \.spmt-space-main\{position:fixed!important/);
  assert.match(source, /\.spmt-workspace-tray\{z-index:870!important\}/);
  assert.match(source, /\.spmt-rocket-dock\{z-index:860!important\}/);
  assert.match(source, /data-spmt-dock="collapsed"\][\s\S]*top:calc\(var\(--guard-height,38px\) \+ 8px\)!important;bottom:auto!important/);
});

test("generic product apps publish every page, keep Home fixed and scroll internal pages", async () => {
  const source = await read("packages/app-foundation/src/surface-client.ts");
  assert.match(source, /productSurfaceManifest/);
  assert.match(source, /home: true/);
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

test("HearMeOut publishes its own scene and delegates Rooms navigation to its real app controls", async () => {
  const surface = await read("apps/hearmeout/src/surface-client.ts");
  const web = await read("apps/hearmeout/src/web-server.ts");
  assert.match(surface, /hearmeout-background\.webp/);
  assert.match(surface, /id: "rooms"/);
  assert.match(surface, /data-hmo-open-rooms/);
  assert.match(surface, /data-surface="shell"[\s\S]*spmt-product-backdrop\{display:none!important\}/);
  assert.match(surface, /hmo-room-scroll[\s\S]*scrollbar-width:thin/);
  assert.match(web, /HEARMEOUT_SURFACE_BROWSER_JS/);
});
