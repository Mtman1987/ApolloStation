import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBulletinServer } from "../tools/apollo-bulletin/server.mjs";
import { OverlayBayParityController } from "../apps/spacemountain/dist/overlay-bay-ui.js";

const root = { querySelector(){ return null; }, querySelectorAll(){ return []; } };

test("Personal Bulletin is created as a Personal Overlay Bay scene using reusable widget sources", () => {
  const scene = {
    schemaVersion: 1, id: "scene-existing", name: "Existing", canvasWidth: 1920, canvasHeight: 1080,
    sources: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://apollo.test" } };
  const ui = new OverlayBayParityController(root, {
    tenantId: "tenant-a",
    workspace: { revision: 1, overlayScenes: [scene], activePersonalOverlaySceneId: scene.id },
    apps: [
      { appId: "mission-control", name: "Mission Control", launchUrl: "https://apollo.test/mission-control", installed: true, enabled: true, surfaces: ["shell"] },
      { appId: "streamweaver", name: "StreamWeaver", launchUrl: "https://apollo.test/streamweaver", installed: true, enabled: true, surfaces: ["standalone"] },
      { appId: "discord-stream-hub", name: "Discord Stream Hub", launchUrl: "https://apollo.test/discord-stream-hub", installed: true, enabled: true, surfaces: ["shell"] },
    ],
    session: { scopes: ["workspace:write", "overlay:outputs:write"] },
  });
  ui.changed = () => {};
  ui.render = () => {};
  ui.newBulletinScene({});
  const bulletin = ui.scenes.find(item => item.name === "Personal Bulletin");
  assert.ok(bulletin);
  assert.equal(ui.output, "personal");
  assert.equal(ui.activeSceneId, bulletin.id);
  const taskWidgets=bulletin.sources.filter(item=>item.kind==="widget");
  const appFrames=bulletin.sources.filter(item=>item.kind==="web");
  assert.deepEqual(taskWidgets.map(item => item.config.widgetId), ["bulletin:tasks"]);
  assert.equal(appFrames.length, 3);
  assert.deepEqual(appFrames.map(item=>item.config.url), [
    "https://apollo.test/mission-control", "https://apollo.test/streamweaver", "https://apollo.test/discord-stream-hub",
  ]);
  assert.equal(taskWidgets[0].x, 2);
  assert.equal(taskWidgets[0].y, 34);
  assert.ok(bulletin.sources.every(item => item.width > 0 && item.height > 0));
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

test("Bulletin exposes embeddable task components and the task API without a separate dashboard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-test-"));
  const app = createBulletinServer({ port: 0, statePath: join(directory, "state.json") });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const landing = await fetch(origin + "/");
    assert.equal(landing.status, 200);
    assert.match(await landing.text(), /Overlay Bay/);
    for (const component of ["tasks", "active", "reviews", "activity", "scheduler", "history"]) {
      const response = await fetch(origin + "/widgets/" + component);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
      assert.match(await response.text(), /\/bulletin\/api\/tasks/);
    }
    const created = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test task", prompt: "Do one test", schedule: "manual" }),
    });
    assert.equal(created.status, 201);
    const payload = await created.json();
    assert.equal(payload.task.status, "paused");
    assert.ok(payload.task.progressUrl);
    assert.ok(payload.task.completeUrl);
    const progressPath = new URL(payload.task.progressUrl).pathname;
    const progressQuery = new URLSearchParams({
      summary: "Verified the first proof step",
      todo: JSON.stringify(["Connect browser", "Run one prompt"]),
      completed: JSON.stringify(["Connect browser"]),
      next: "Run one prompt",
      blocker: "",
    });
    const progress = await fetch(origin + progressPath + "?" + progressQuery.toString());
    assert.equal(progress.status, 200);
    const progressPayload = await progress.json();
    assert.equal(progressPayload.task.handoff.summary, "Verified the first proof step");
    assert.deepEqual(progressPayload.task.handoff.todo, ["Connect browser", "Run one prompt"]);
    const completePath = new URL(payload.task.completeUrl).pathname;
    const completed = await fetch(origin + completePath);
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).task.status, "completed");
    const list = await (await fetch(origin + "/api/tasks")).json();
    assert.equal(list.tasks.length, 1);
    assert.equal(list.tasks[0].handoff.status, "completed");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
