import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createIntegratedSpaceMountainWebHost } from "../apps/spacemountain-web/dist/integrated-server.js";

// The spacemountain.live entrance is a static GitHub Pages page whose sign-in
// form posts cross-origin to Node 1. The ingress cross-origin guard must let
// exactly that one post through (the SPMT service enforces the same origin
// allowlist itself) while every other cross-origin write stays rejected.
test("the entrance origin may post only the browser sign-in through Apollo ingress", async () => {
  const spmt = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"stub":"spmt-service"}'); });
  let ingress;
  try {
    await new Promise((resolve) => spmt.listen(0, "127.0.0.1", resolve));
    const spmtOrigin = `http://127.0.0.1:${spmt.address().port}`;
    ingress = createIntegratedSpaceMountainWebHost({ spmtOrigin, host: "127.0.0.1", port: 0 });
    await ingress.listen();
    const base = `http://127.0.0.1:${ingress.server.address().port}`;
    const post = (path, origin) => fetch(base + path, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "username=probe&password=probe", redirect: "manual" });

    for (const origin of ["https://spacemountain.live", "https://www.spacemountain.live"]) {
      const response = await post("/v1/auth/browser-login", origin);
      assert.equal(response.status, 200, `${origin} sign-in post must reach the SPMT service`);
      assert.match(await response.text(), /spmt-service/);
    }
    for (const origin of ["https://evil.example", "http://spacemountain.live", "https://spacemountain.live.evil.example", "null"]) {
      assert.equal((await post("/v1/auth/browser-login", origin)).status, 403, `${origin} must stay rejected`);
    }
    for (const path of ["/v1/auth/token", "/v1/auth/register", "/v1/apps", "/v1/auth/browser-login/extra"]) {
      assert.equal((await post(path, "https://spacemountain.live")).status, 403, `${path} from the entrance origin must stay rejected`);
    }
    const native = await post("/v1/auth/browser-login", base);
    assert.equal(native.status, 200, "same-origin sign-in post is unaffected");
  } finally {
    await ingress?.close();
    spmt.closeAllConnections();
    await new Promise((resolve) => spmt.close(resolve));
  }
});
