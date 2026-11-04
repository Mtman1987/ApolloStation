import assert from "node:assert/strict";
import test from "node:test";
import { createCompanionRelayHandlers } from "../apps/companion/dist/index.js";

function fixture({ mediaRelay = true } = {}) {
  const calls = [];
  const mediaJobs = {
    cacheStatus: () => ({ enabled: mediaRelay, bytes: 4 }),
    hardware: () => ({ selectedEngine: "cpu" }),
    transcode: (inputName, preset) => { calls.push(["transcode", inputName, preset]); return { id: "transcode-1" }; },
    download: (input) => { calls.push(["download", input]); return { id: "download-1" }; },
    cancel: (jobId) => { calls.push(["cancel", jobId]); return { id: jobId, cancelled: true }; },
    pruneDownloads: (targetBytes) => { calls.push(["prune", targetBytes]); return { removed: [] }; },
  };
  const workflowJobs = { runApproved: async (workflowId, input, source) => { calls.push(["workflow", workflowId, input, source]); return { id: "workflow-1" }; } };
  const diagnosticsStore = { writeSnapshot: (payload) => { calls.push(["diagnostics", payload]); return { filename: "snapshot.json", path: "/diagnostics/snapshot.json", bytes: 10, logCount: 1, capturedAt: "2026-08-25T04:20:00.000Z" }; } };
  const handlers = createCompanionRelayHandlers({
    windows: {
      showOverlay: () => calls.push(["overlay.show"]),
      hideOverlay: () => calls.push(["overlay.hide"]),
      showPopout: (id) => calls.push(["popout.show", id]),
      hidePopout: (id) => calls.push(["popout.hide", id]),
    },
    obs: {
      setScene: (scene) => calls.push(["scene", scene]),
      playMedia: (payload) => calls.push(["obs.media", payload]),
    },
    audio: { apply: (input) => calls.push(["audio", input]) },
    mediaJobs,
    workflowJobs,
    diagnosticsStore,
    getStatus: () => ({ server: { state: "running" }, relay: { state: "connected" }, obs: { state: "connected" } }),
    localMediaRelayEnabled: () => mediaRelay,
  });
  return { handlers, calls };
}

test("Companion donor handlers expose status, diagnostics, windows, OBS, and audio through one local boundary", async () => {
  const { handlers, calls } = fixture();
  const status = await handlers["companion.status"]({});
  assert.equal(status.server.state, "running");
  assert.equal(status.media.bytes, 4);
  await handlers["diagnostics.snapshot.write"]({ snapshotId: "snap" });
  await handlers["overlay.show"]({});
  await handlers["popout.show"]({ id: "chat" });
  await handlers["obs.scene.set"]({ sceneName: "BRB" });
  await handlers["audio.mute"]({ muted: true });
  await handlers["audio.volume"]({ volume: 0.35 });
  assert.deepEqual(calls.slice(0, 6), [
    ["diagnostics", { snapshotId: "snap" }],
    ["overlay.show"],
    ["popout.show", "chat"],
    ["scene", "BRB"],
    ["audio", { muted: true }],
    ["audio", { volume: 0.35 }],
  ]);
});

test("Companion media handlers preserve donor validation and local relay opt-in", async () => {
  const disabled = fixture({ mediaRelay: false });
  await assert.rejects(() => disabled.handlers["media.download"]({ url: "https://media.test/video.mp4" }), /disabled/);
  await assert.rejects(() => disabled.handlers["media.cache.prune"]({ targetBytes: 0 }), /disabled/);

  const { handlers, calls } = fixture();
  await handlers["media.transcode"]({ inputName: "clip.mov", preset: "mp4-web" });
  await handlers["media.download"]({ url: "https://media.test/video.mp4", fileName: "video.mp4", expectedSha256: "a".repeat(64), maxBytes: 1000 });
  await handlers["media.download.cancel"]({ jobId: "download-1" });
  await handlers["media.cache.prune"]({ targetBytes: 500 });
  assert.equal(calls.some((entry) => entry[0] === "download"), true);
  assert.deepEqual(calls.find((entry) => entry[0] === "transcode"), ["transcode", "clip.mov", "mp4-web"]);
  await assert.rejects(() => handlers["media.download"]({ url: "https://media.test/video.mp4", expectedSha256: "bad" }), /SHA-256/);
});

test("Companion workflow handler cannot escape the allowlist", async () => {
  const { handlers, calls } = fixture();
  await handlers["workflow.run"]({ workflowId: "test.echo", input: { message: "hello" } });
  assert.deepEqual(calls.at(-1), ["workflow", "test.echo", { message: "hello" }, "relay"]);
  await assert.rejects(() => handlers["workflow.run"]({ workflowId: "shell.exec", input: { command: "whoami" } }), /allowlisted/);
});
