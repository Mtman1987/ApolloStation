import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CompanionConfigStore,
  DEFAULT_COMPANION_CONFIG,
  buildCompanionSurfaceUrl,
  createCompanionUpdateManager,
  exchangeCompanionTenantBootstrap,
  findCompanionTenantBootstrapUrl,
  parseCompanionTenantBootstrapUrl,
  resolveCompanionPersonalOverlayUrl,
  resolveCompanionSurfaceUrl,
} from "../apps/companion/dist/index.js";

function secureStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${Buffer.from(value).toString("base64")}`),
    decryptString: (value) => Buffer.from(Buffer.from(value).toString().slice(4), "base64").toString(),
  };
}

test("Companion config migrates donor defaults but fails closed on unsafe hosts and URLs", () => {
  const root = mkdtempSync(join(tmpdir(), "apollo-companion-config-"));
  try {
    writeFileSync(join(root, "companion.json"), JSON.stringify({
      schemaVersion: 1,
      server: { host: "0.0.0.0", port: 99_999 },
      relay: { url: "ws://evil.test/relay", enabled: true },
      obs: { url: "ws://evil.test:4455", enabled: true },
      windows: { overlay: { url: "http://127.0.0.1:3100/tts-mixer" } },
      audio: { volume: 5 },
    }));
    const config = new CompanionConfigStore(root, secureStorage()).read();
    assert.equal(config.schemaVersion > 6, true);
    assert.equal(config.server.host, "127.0.0.1");
    assert.equal(config.server.port, DEFAULT_COMPANION_CONFIG.server.port);
    assert.equal(config.relay.url, DEFAULT_COMPANION_CONFIG.relay.url);
    assert.equal(config.obs.url, DEFAULT_COMPANION_CONFIG.obs.url);
    assert.equal(config.windows.overlay.url, "");
    assert.equal(config.audio.volume, DEFAULT_COMPANION_CONFIG.audio.volume);
    assert.equal(config.windows.popouts[0].title, "Nebula Arcade");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Companion config writes atomically and keeps relay/OBS secrets OS-encrypted outside companion.json", () => {
  const root = mkdtempSync(join(tmpdir(), "apollo-companion-secrets-"));
  try {
    const store = new CompanionConfigStore(root, secureStorage());
    const config = store.write({ ...DEFAULT_COMPANION_CONFIG, relay: { ...DEFAULT_COMPANION_CONFIG.relay, deviceId: "pc-1", enabled: true } });
    store.writeSecrets({ relayToken: "relay-secret-123", obsPassword: "obs-secret-456" });
    const configText = readFileSync(store.configPath, "utf8");
    const secretBytes = readFileSync(store.secretPath);
    assert.equal(config.relay.deviceId, "pc-1");
    assert.doesNotMatch(configText, /relay-secret|obs-secret/);
    assert.doesNotMatch(secretBytes.toString(), /relay-secret|obs-secret/);
    assert.deepEqual(store.readSecrets(), { relayToken: "relay-secret-123", obsPassword: "obs-secret-456" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Companion refuses to persist secrets when OS encryption is unavailable", () => {
  const root = mkdtempSync(join(tmpdir(), "apollo-companion-no-crypto-"));
  try {
    const store = new CompanionConfigStore(root, { isEncryptionAvailable: () => false, encryptString: () => new Uint8Array(), decryptString: () => "" });
    assert.throws(() => store.writeSecrets({ relayToken: "secret" }), /encryption is unavailable/i);
    assert.deepEqual(store.readSecrets(), {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Companion custom protocol accepts only bounded bootstrap codes", () => {
  assert.deepEqual(parseCompanionTenantBootstrapUrl("spmt-companion://bootstrap?code=abc_DEF-123"), { code: "abc_DEF-123" });
  assert.equal(parseCompanionTenantBootstrapUrl("https://spmt.live/?code=abc"), undefined);
  assert.equal(parseCompanionTenantBootstrapUrl(`spmt-companion://bootstrap?code=${"a".repeat(513)}`), undefined);
  assert.equal(findCompanionTenantBootstrapUrl(["--minimized", "spmt-companion://bootstrap?code=link-1"]), "spmt-companion://bootstrap?code=link-1");
});

test("Companion bootstrap exchanges one code over credential-free HTTPS and rejects incomplete authority", async () => {
  const calls = [];
  const result = await exchangeCompanionTenantBootstrap(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ sessionToken: "session", pairingToken: "pair", device: { id: "device-1" }, user: { id: "user-1" } }), { status: 200, headers: { "content-type": "application/json" } });
  }, "code-1");
  assert.equal(result.device.id, "device-1");
  assert.equal(calls[0].url, "https://spmt.live/api/companion/bootstrap/exchange");
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: "code-1" });
  await assert.rejects(() => exchangeCompanionTenantBootstrap(async () => new Response(JSON.stringify({ sessionToken: "session" }), { status: 200 }), "code-2"), /incomplete/);
  await assert.rejects(() => exchangeCompanionTenantBootstrap(fetch, "code-3", "http://spmt.live/exchange"), /HTTPS/);
});

test("Companion resolves only canonical same-origin SPMT surfaces and authenticated personal overlay launches", async () => {
  const payload = { surfaces: [
    { id: "worktray", path: "/workspace" },
    { id: "overlays", url: "https://spmt.live/overlays" },
    { id: "bad", url: "https://evil.test/phish" },
  ] };
  assert.equal(buildCompanionSurfaceUrl(payload, "worktray"), "https://spmt.live/workspace?app=companion&mode=panel");
  assert.equal(buildCompanionSurfaceUrl(payload, "overlays"), "https://spmt.live/overlays?app=companion&mode=full&output=personal");
  assert.equal(buildCompanionSurfaceUrl(payload, "bad"), "");
  const calls = [];
  const session = { fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/api/platform/surfaces")) return new Response(JSON.stringify(payload), { status: 200 });
    return new Response(JSON.stringify({ url: "https://spacemountain.live/o/opaque-token" }), { status: 200 });
  } };
  assert.match(await resolveCompanionSurfaceUrl(session, "worktray"), /\/workspace\?app=companion&mode=panel$/);
  assert.equal(await resolveCompanionPersonalOverlayUrl(session), "https://spacemountain.live/o/opaque-token");
  assert.equal(calls.every((call) => call.options.credentials === "include" && call.options.cache === "no-store" && call.options.redirect === "error"), true);
});

class FakeUpdater {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  listeners = new Map();
  checks = 0;
  installs = 0;
  async checkForUpdates() { this.checks += 1; return { ok: true }; }
  quitAndInstall() { this.installs += 1; }
  on(event, listener) { this.listeners.set(event, listener); }
  async emit(event, value) { await this.listeners.get(event)?.(value); }
}

test("Companion updater checks only packaged stable builds and installs signed updates on approval", async () => {
  const developmentUpdater = new FakeUpdater();
  const developmentDialogs = [];
  const development = createCompanionUpdateManager({
    updater: developmentUpdater,
    dialog: { showMessageBox: async (...args) => { developmentDialogs.push(args); return { response: 1 }; } },
    isPackaged: false,
    currentVersion: "1.0.0",
  });
  await development.check({ manual: true });
  assert.equal(developmentUpdater.checks, 0);
  assert.equal(development.snapshot().state, "development");
  assert.equal(developmentDialogs.length, 1);

  const updater = new FakeUpdater();
  const statuses = [];
  const manager = createCompanionUpdateManager({
    updater,
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    isPackaged: true,
    currentVersion: "1.0.0",
    onStatus: (status) => statuses.push(status),
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn: () => {},
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });
  manager.start();
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowPrerelease, false);
  await updater.emit("update-available", { version: "1.1.0" });
  await updater.emit("download-progress", { percent: 41.6 });
  await updater.emit("update-downloaded", { version: "1.1.0" });
  assert.equal(statuses.at(-1).state, "ready");
  assert.equal(statuses.at(-1).percent, 100);
  assert.equal(updater.installs, 1);
});
