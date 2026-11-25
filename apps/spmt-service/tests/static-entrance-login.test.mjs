import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../dist/index.js";

test("static SpaceMountain entrance creates the normal Apollo browser session and redirects to Node 1", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-static-entrance-"));
  const service = createSpmtService({
    databasePath: join(directory, "spmt.sqlite"),
    webhookKey: Buffer.alloc(32, 73),
    host: "127.0.0.1",
    port: 0,
    runtimeMode: "production",
  });

  try {
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;

    const registration = await fetch(`${base}/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "static-entrance-test",
        displayName: "Static Entrance Test",
        password: "static-entrance-test-password",
      }),
    });
    assert.equal(registration.status, 201);

    const response = await fetch(`${base}/v1/auth/browser-login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: "https://spacemountain.live",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        username: "static-entrance-test",
        password: "static-entrance-test-password",
      }),
    });

    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location"));
    const expectedHome = new URL(process.env.SPMT_PUBLIC_URL ?? "https://apollo-node-1.hostless.app");
    assert.equal(location.origin, expectedHome.origin);
    assert.equal(location.pathname, "/");

    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /spmt_token=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.doesNotMatch(cookie, /access_token|refresh_token/i);
  } finally {
    await service.close().catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("static SpaceMountain entrance rejects foreign origins and returns failed logins to the static page", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-static-entrance-reject-"));
  const service = createSpmtService({
    databasePath: join(directory, "spmt.sqlite"),
    webhookKey: Buffer.alloc(32, 74),
    host: "127.0.0.1",
    port: 0,
    runtimeMode: "production",
  });

  try {
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const payload = new URLSearchParams({ username: "nobody", password: "invalid-password" });

    const rejected = await fetch(`${base}/v1/auth/browser-login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: "https://untrusted.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: payload,
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("set-cookie"), null);

    const failed = await fetch(`${base}/v1/auth/browser-login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: "https://spacemountain.live",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: payload,
    });
    assert.equal(failed.status, 303);
    const location = new URL(failed.headers.get("location"));
    assert.equal(location.origin, "https://spacemountain.live");
    assert.equal(location.searchParams.get("loginError"), "1");
    assert.equal(failed.headers.get("set-cookie"), null);
  } finally {
    await service.close().catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
});
