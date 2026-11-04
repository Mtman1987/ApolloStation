import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMountainViewWebServer } from "../apps/mountainview/dist/index.js";

test("MountainView serves the Commander MT listener with bounded cycles and explicit routing controls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mountainview-commander-browser-"));
  const host = createMountainViewWebServer({
    spmtOrigin: "http://127.0.0.1:39001",
    databasePath: join(dir, "mountainview.sqlite"),
    port: 0,
    host: "127.0.0.1",
  });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Commander MT · Athena/);
    assert.match(html, /CYCLE_MS=10000/);
    assert.match(html, /WINDOW_MS=60000/);
    assert.match(html, /data-commander-start/);
    assert.match(html, /data-commander-confirm/);
    assert.match(html, /\/api\/mountainview\/voice\/route/);
    assert.match(html, /nothing is sent until you tap a send button/i);
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
