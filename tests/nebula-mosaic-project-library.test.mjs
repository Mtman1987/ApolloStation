import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { mosaicTemplatePng, NEBULA_MOSAIC_LIBRARY_JS } from "../apps/nebula-arcade/dist/index.js";
import { createNebulaArcadeSandboxHost } from "../apps/nebula-arcade/dist/nebula-runtime-host-base.js";

const template = {
  format: "nebula-mosaic", version: 1, width: 40, height: 50,
  theme: "Aurora over the lake", paletteId: "ocean", target: Array(2_000).fill("C"),
};

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "nebula-mosaic-library-"));
  const host = createNebulaArcadeSandboxHost({
    databasePath: join(directory, "nebula.sqlite"), tenantId: "tenant-a", channelId: "room-a", channels: ["room-b"],
    authenticate: async (request) => {
      const cookie = String(request.headers.cookie || "");
      if (cookie.includes("member-session")) return { userId: "member-1", username: "member", moderator: false };
      if (cookie.includes("owner-session")) return { userId: "owner-1", username: "owner", moderator: true };
      throw new Error("Sign in to Nebula Arcade");
    },
  });
  try {
    await host.listen();
    const origin = "http://127.0.0.1:" + host.server.address().port;
    await run({ origin, host });
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("Mosaic PNG export is a real 800x1000 PNG rendered from the selected palette", () => {
  const png = mosaicTemplatePng(template);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 1000);
  assert.ok(png.length > 1_000);
});

test("Mosaic library supports private saves, publish, public gallery, JSON/PNG export and fresh cross-room copies", async () => {
  await fixture(async ({ origin }) => {
    const endpoint = origin + "/apps/nebula-arcade?action=mosaic-projects";
    const owner = { cookie: "owner-session", origin, "content-type": "application/json" };
    const imported = await fetch(endpoint, { method: "POST", headers: owner, body: JSON.stringify({ action: "import", channel: "room-a", template }) });
    const importedBody = await imported.json();
    assert.equal(imported.status, 200, JSON.stringify(importedBody));
    const library = await (await fetch(endpoint + "&channel=room-a", { headers: { cookie: "owner-session" } })).json();
    assert.equal(library.canManage, true);
    assert.equal(library.own.length, 1);
    const artworkId = library.own[0].id;
    const published = await fetch(endpoint, { method: "POST", headers: owner, body: JSON.stringify({ action: "publish", channel: "room-a", artworkId }) });
    assert.equal(published.status, 200);
    const gallery = await (await fetch(endpoint + "&scope=gallery", { headers: {} })).json();
    assert.equal(gallery.gallery.length, 1);
    const sharedId = gallery.gallery[0].id;
    const json = await fetch(endpoint + "&shared=" + encodeURIComponent(sharedId) + "&format=json");
    assert.equal(json.status, 200);
    assert.equal((await json.json()).theme, template.theme);
    const png = await fetch(endpoint + "&shared=" + encodeURIComponent(sharedId) + "&format=png");
    assert.equal(png.status, 200);
    assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const copied = await fetch(endpoint, { method: "POST", headers: owner, body: JSON.stringify({ action: "start", channel: "room-b", shared: sharedId }) });
    assert.equal(copied.status, 200);
    const otherRoom = await (await fetch(endpoint + "&channel=room-b", { headers: { cookie: "owner-session" } })).json();
    assert.equal(otherRoom.own.length, 1);
    assert.equal(otherRoom.own[0].theme, template.theme);
    const privateRoom = await (await fetch(endpoint + "&channel=room-a", { headers: { cookie: "owner-session" } })).json();
    assert.equal(privateRoom.own[0].sharedId, sharedId);
  });
});

test("Mosaic library keeps public gallery read-only and denies member mutations", async () => {
  await fixture(async ({ origin }) => {
    const endpoint = origin + "/apps/nebula-arcade?action=mosaic-projects";
    const publicGallery = await fetch(endpoint + "&scope=gallery");
    assert.equal(publicGallery.status, 200);
    const memberRead = await fetch(endpoint + "&channel=room-a", { headers: { cookie: "member-session" } });
    assert.equal(memberRead.status, 200);
    assert.equal((await memberRead.json()).canManage, false);
    const denied = await fetch(endpoint, { method: "POST", headers: { cookie: "member-session", origin, "content-type": "application/json" }, body: JSON.stringify({ action: "import", channel: "room-a", template }) });
    assert.equal(denied.status, 403);
    const unconfigured = await fetch(endpoint + "&channel=not-configured", { headers: { cookie: "owner-session" } });
    assert.equal(unconfigured.status, 404);
  });
});

test("Mosaic library page and browser script expose import, resume, share and export controls", () => {
  new vm.Script(NEBULA_MOSAIC_LIBRARY_JS);
  assert.match(NEBULA_MOSAIC_LIBRARY_JS, /Resume saved progress/);
  assert.match(NEBULA_MOSAIC_LIBRARY_JS, /Share to gallery/);
  assert.match(NEBULA_MOSAIC_LIBRARY_JS, /Download PNG/);
  assert.match(NEBULA_MOSAIC_LIBRARY_JS, /Import a downloaded project/);
  assert.match(NEBULA_MOSAIC_LIBRARY_JS, /Copy share link/);
  assert.match(NEBULA_MOSAIC_LIBRARY_JS, /Open share page/);
});
