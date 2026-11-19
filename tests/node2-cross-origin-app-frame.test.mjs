import assert from "node:assert/strict";
import test from "node:test";
import { createSpaceMountainWebHost } from "../apps/spacemountain-web/dist/server.js";
import { createStreamWeaverWebServer } from "../apps/streamweaver/dist/web-server.js";

const NODE1_ORIGIN = "https://apollo-node-1.hostless.app";
const NODE1_ALIAS = "https://node-1.hostless.app";

test("Node 1 shell permits the canonical Node 2 Hostless app frame", async () => {
  const app = createSpaceMountainWebHost({ spmtOrigin: "http://127.0.0.1:3200", host: "127.0.0.1", port: 0 });
  try {
    await app.listen();
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const page = await fetch(`${origin}/?surface=shell`);
    assert.equal(page.status, 200);
    const csp = page.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-src 'self' https:\/\/apollo-node-2\.hostless\.app;/);
  } finally {
    await app.close();
  }
});

test("Node 1 can frame Node 2 StreamWeaver and use only allowlisted read-only CORS", async () => {
  const app = createStreamWeaverWebServer({ spmtOrigin: NODE1_ORIGIN, host: "127.0.0.1", port: 0 });
  try {
    await app.listen();
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const page = await fetch(`${origin}/apps/streamweaver`);
    assert.equal(page.status, 200);
    const csp = page.headers.get("content-security-policy") ?? "";

    const preflight = await fetch(`${origin}/api/streamweaver/snapshot`, {
      method: "OPTIONS",
      headers: {
        origin: NODE1_ALIAS,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), NODE1_ALIAS);
    assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");

    const untrusted = await fetch(`${origin}/api/streamweaver/snapshot`, {
      method: "OPTIONS",
      headers: {
        origin: "https://untrusted.example",
        "access-control-request-method": "GET",
      },
    });
    assert.equal(untrusted.status, 403);
    assert.equal(untrusted.headers.get("access-control-allow-origin"), null);

    const mutation = await fetch(`${origin}/api/streamweaver/snapshot`, {
      method: "OPTIONS",
      headers: {
        origin: NODE1_ALIAS,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(mutation.status, 403, "cross-origin mutations remain blocked; app actions stay same-origin inside the Node 2 frame");
    assert.equal(mutation.headers.get("access-control-allow-origin"), null);
  } finally {
    await app.close();
  }
});
