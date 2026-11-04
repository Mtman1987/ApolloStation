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
      assert.equal(response.headers.get("x-frame-options"), null);
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
      assert.match(await response.text(), new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    await host.close();
  }
});
