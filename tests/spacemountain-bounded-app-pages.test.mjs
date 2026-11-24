import test from "node:test";
import assert from "node:assert/strict";
import { createSpaceMountainWebHost } from "../apps/spacemountain-web/dist/server.js";
import { BOUNDED_APP_PATHS, renderBoundedAppPage } from "../apps/spacemountain-web/dist/bounded-app-pages.js";

const EXPECTED = [
  ["/apps/discord-stream-hub", "Discord Stream Hub", "discord-stream-hub-background.webp"],
  ["/apps/hearmeout", "HearMeOut", "hearmeout-background.webp"],
  ["/apps/mountainview", "MountainView", "mountainview-background.webp"],
  ["/apps/companion", "SpaceMountain Companion", "companion-background.webp"],
  ["/apps/streamweaver", "StreamWeaver", "streamweaver-background.webp"],
];

test("bounded app pages are explicit, themed, and carry app identity without internal release copy", () => {
  for (const [path, name, artwork] of EXPECTED) {
    assert.equal(BOUNDED_APP_PATHS.has(path), true);
    const html = renderBoundedAppPage(path, "abc123def456");
    assert.match(html, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(artwork.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(`/assets/product/app-icons/solar-flare/${path.split("/").at(-1)}\\.png`));
    assert.match(html, /data-themed-app-icon/);
    assert.doesNotMatch(html, /App-owned comic scene|Green donor surface/);
    assert.doesNotMatch(html, /provider actions enabled|production ready/i);
  }
});

test("SpaceMountain web host serves retained donor app routes instead of JSON 404s and permits same-origin shell embedding", async () => {
  const host = createSpaceMountainWebHost({ spmtOrigin: "http://127.0.0.1:3000", port: 0, host: "127.0.0.1", buildSha: "bounded-route-test" });
  await host.listen();
  try {
    const address = host.server.address();
    assert.ok(address && typeof address === "object");
    for (const [path, name] of EXPECTED) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      assert.match(await response.text(), new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    await host.close();
  }
});

test("embedded app pages use the compact shell surface while standalone pages keep their own dock", () => {
  for (const [path, name] of EXPECTED) {
    const embedded = renderBoundedAppPage(path, "abc123def456", "nonce", "shell");
    const standalone = renderBoundedAppPage(path, "abc123def456", "nonce", "standalone");
    assert.match(embedded, /data-spmt-surface="shell"/, path);
    assert.match(embedded, /body\[data-spmt-surface="shell"\]\{background:transparent\}/, path);
    assert.doesNotMatch(embedded, /class="bounded-rocket-dock/, path);
    assert.match(embedded, /class="bounded-app-root"/, path);
    assert.match(standalone, /data-spmt-surface="standalone"/, path);
    assert.match(standalone, /class="bounded-rocket-dock/, path);
    assert.ok(standalone.includes(name), path);
    assert.match(embedded, /<footer id="status"[^>]*hidden>/, path);
  }
});
