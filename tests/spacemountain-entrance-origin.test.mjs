import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createIntegratedSpaceMountainWebHost } from "../apps/spacemountain-web/dist/integrated-server.js";

// The spacemountain.live and spmt.live entrances are static GitHub Pages pages whose sign-in
// form posts cross-origin to Node 1. Three layers must line up for it to work:
// the ingress cross-origin guard lets exactly that one post through, the SPMT
// API proxy forwards it WITHOUT rewriting the Origin header, and the SPMT
// service itself allowlists the entrance origin before issuing a session.
// The stub below stands in for the service and enforces the same allowlist,
// so this test covers the whole chain.
test("the entrance origin may post only the browser sign-in through Apollo ingress", async () => {
  const spmt = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub.invalid");
    if (url.pathname === "/v1/auth/browser-login") {
      if (["https://spacemountain.live", "https://www.spacemountain.live", "https://spmt.live", "https://www.spmt.live"].includes(req.headers.origin ?? "")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"stub":"spmt-service"}');
      } else {
        res.writeHead(403, { "content-type": "application/json" });
        res.end('{"error":"invalid_origin"}');
      }
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"stub":"spmt-service"}');
  });
  let ingress;
  try {
    await new Promise((resolve) => spmt.listen(0, "127.0.0.1", resolve));
    const spmtOrigin = `http://127.0.0.1:${spmt.address().port}`;
    ingress = createIntegratedSpaceMountainWebHost({ spmtOrigin, host: "127.0.0.1", port: 0 });
    await ingress.listen();
    const base = `http://127.0.0.1:${ingress.server.address().port}`;
    const post = (path, origin) => fetch(base + path, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "username=probe&password=probe", redirect: "manual" });

    for (const origin of ["https://spacemountain.live", "https://www.spacemountain.live", "https://spmt.live", "https://www.spmt.live"]) {
      const response = await post("/v1/auth/browser-login", origin);
      assert.equal(response.status, 200, `${origin} sign-in post must reach the SPMT service with its origin intact`);
      assert.match(await response.text(), /spmt-service/);
    }
    for (const origin of ["https://evil.example", "http://spacemountain.live", "https://spacemountain.live.evil.example", "http://spmt.live", "https://spmt.live.evil.example", "null"]) {
      assert.equal((await post("/v1/auth/browser-login", origin)).status, 403, `${origin} must stay rejected`);
    }
    for (const path of ["/v1/auth/token", "/v1/auth/register", "/v1/apps", "/v1/auth/browser-login/extra"]) {
      assert.equal((await post(path, "https://spacemountain.live")).status, 403, `${path} from the entrance origin must stay rejected`);
    }
    const native = await post("/v1/auth/session/bridge-login", base);
    assert.equal(native.status, 200, "same-origin API posts still proxy to the SPMT service");
    assert.match(await native.text(), /spmt-service/);
  } finally {
    await ingress?.close();
    spmt.closeAllConnections();
    await new Promise((resolve) => spmt.close(resolve));
  }
});
