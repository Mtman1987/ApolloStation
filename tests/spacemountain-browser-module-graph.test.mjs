import assert from "node:assert/strict";
import test from "node:test";
import { createSpaceMountainWebHost } from "../apps/spacemountain-web/dist/server.js";

function browserModuleMetadata(html, base) {
  const importMapSource = html.match(/<script type="importmap"[^>]*>(.*?)<\/script>/s)?.[1];
  assert.ok(importMapSource, "page must declare its browser import map");
  const imports = JSON.parse(importMapSource).imports ?? {};
  const entries = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)]
    .map((match) => new URL(match[1], base).href);
  assert.ok(entries.length, "page must declare at least one browser module entrypoint");
  return { imports, entries };
}

function importedSpecifiers(source) {
  return [...source.matchAll(/(?:import\s+(?:[^"']*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

async function assertBrowserModuleGraph(base, pagePath) {
  const pageUrl = new URL(pagePath, base);
  const page = await fetch(pageUrl);
  assert.equal(page.status, 200, `${pageUrl.pathname} must load`);
  const { imports, entries } = browserModuleMetadata(await page.text(), pageUrl);
  const pending = [...entries];
  const visited = new Set();

  while (pending.length) {
    const moduleUrl = pending.shift();
    if (visited.has(moduleUrl)) continue;
    visited.add(moduleUrl);
    const response = await fetch(moduleUrl);
    assert.equal(response.status, 200, `${new URL(moduleUrl).pathname} must be browser-addressable`);
    assert.match(response.headers.get("content-type") ?? "", /text\/javascript/, `${new URL(moduleUrl).pathname} must be JavaScript`);
    const source = await response.text();
    for (const specifier of importedSpecifiers(source)) {
      const mapped = imports[specifier];
      assert.ok(mapped || specifier.startsWith(".") || specifier.startsWith("/"), `unmapped browser import: ${specifier}`);
      pending.push(new URL(mapped ?? specifier, moduleUrl).href);
    }
  }

  return visited;
}

test("SpaceMountain serves the complete browser module graph before boot", async () => {
  const web = createSpaceMountainWebHost({
    spmtOrigin: "http://127.0.0.1:3000",
    host: "127.0.0.1",
    port: 0,
    buildSha: "browser-module-graph-test",
  });
  try {
    await web.listen();
    const address = web.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;

    const shellGraph = await assertBrowserModuleGraph(base, "/");
    assert.ok(shellGraph.has(`${base}/assets/web/client.js`));
    assert.ok(shellGraph.has(`${base}/assets/web/session-resilience.js`));
    assert.ok(shellGraph.has(`${base}/assets/sdk/xp.js`));
    assert.ok(shellGraph.has(`${base}/assets/sdk/suite-actions.js`));

    const simulationGraph = await assertBrowserModuleGraph(base, "/simulation-rooms?roomId=preview");
    assert.ok(simulationGraph.has(`${base}/assets/spacemountain/simulation-rooms-ui.js`));
    assert.ok(simulationGraph.has(`${base}/assets/web/simulation-rooms-client.js`));

    const boundedGraph = await assertBrowserModuleGraph(base, "/apps/discord-stream-hub");
    assert.ok(boundedGraph.has(`${base}/assets/web/bounded-app-client.js`));
  } finally {
    await web.close();
  }
});
