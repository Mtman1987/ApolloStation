import test from "node:test";
import assert from "node:assert/strict";
import { ApolloChatGptBrowserWorker } from "./browser-worker.mjs";

function fakeWorker({ url = "https://chatgpt.com/", pageClosed = false, browserConnected = true } = {}) {
  const worker = new ApolloChatGptBrowserWorker({});
  worker.context = { browser: () => browserConnected ? ({ isConnected: () => true }) : null };
  worker.page = {
    isClosed: () => pageClosed,
    url: () => url,
    title: async () => "ChatGPT",
    getByRole: () => ({ first: () => ({ isVisible: async () => false }) }),
  };
  return worker;
}

test("browser health requires a live page on an approved OpenAI origin", async () => {
  assert.equal(await fakeWorker().isHealthy(), true);
  assert.equal(await fakeWorker({ url: "https://auth.openai.com/log-in" }).isHealthy(), true);
  assert.equal(await fakeWorker({ url: "about:blank" }).isHealthy(), false);
  assert.equal(await fakeWorker({ url: "https://example.com/" }).isHealthy(), false);
});

test("browser health fails when the page or Chromium process has closed", async () => {
  assert.equal(await fakeWorker({ pageClosed: true }).isHealthy(), false);
  assert.equal(await fakeWorker({ browserConnected: false }).isHealthy(), false);
});

test("browser status exposes health separately from ChatGPT login state", async () => {
  const worker = fakeWorker({ url: "https://chatgpt.com/auth/login" });
  const status = await worker.status();
  assert.equal(status.healthy, true);
  assert.equal(status.connected, true);
  assert.equal(status.loginRequired, true);
});

test("browser health fails closed when the context has no connected browser", async () => {
  assert.equal(await fakeWorker({ browserConnected: false }).isHealthy(), false);
});
test("browser status remains inspectable after the page closes", async () => {
  const worker = fakeWorker({ pageClosed: true });
  const status = await worker.status();
  assert.equal(status.healthy, false);
  assert.equal(status.connected, false);
});

test("browser startup records that the session state was persisted to Turso", async () => {
  const previous = process.env.HMO_TEST_BROWSER_PATH;
  process.env.HMO_TEST_BROWSER_PATH = process.execPath;
  let saved = 0;
  let currentUrl = "about:blank";
  const page = {
    isClosed: () => false,
    url: () => currentUrl,
    title: async () => "ChatGPT",
    goto: async url => { currentUrl = url; },
    getByRole: () => ({ first: () => ({ isVisible: async () => false }) }),
  };
  const context = {
    pages: () => [page],
    browser: () => ({ isConnected: () => true }),
    storageState: async options => { assert.equal(options.indexedDB, true); return { cookies: [], origins: [] }; },
  };
  const worker = new ApolloChatGptBrowserWorker({
    profilePath: "/tmp/apollo-bulletin-browser-session-test",
    launch: async () => context,
    sessionStore: { async loadBrowserState() { return null; }, async saveBrowserState() { saved += 1; } },
  });
  try {
    await worker.start();
    assert.equal((await worker.status()).sessionPersistenceReady, false);
    await worker.openLogin();
    const status = await worker.status();
    assert.equal(saved, 1);
    assert.equal(status.sessionPersistenceReady, true);
    assert.ok(Number.isFinite(status.lastSessionPersistedAt));
  } finally {
    await worker.close();
    if (previous === undefined) delete process.env.HMO_TEST_BROWSER_PATH; else process.env.HMO_TEST_BROWSER_PATH = previous;
  }
});

test("browser session persistence failure is visible and not reported ready", async () => {
  const previous = process.env.HMO_TEST_BROWSER_PATH;
  process.env.HMO_TEST_BROWSER_PATH = process.execPath;
  let currentUrl = "about:blank";
  const page = {
    isClosed: () => false,
    url: () => currentUrl,
    title: async () => "ChatGPT",
    goto: async url => { currentUrl = url; },
    getByRole: () => ({ first: () => ({ isVisible: async () => false }) }),
  };
  const context = { pages: () => [page], browser: () => ({ isConnected: () => true }), storageState: async () => ({ cookies: [], origins: [] }) };
  const worker = new ApolloChatGptBrowserWorker({
    profilePath: "/tmp/apollo-bulletin-browser-session-failure-test",
    launch: async () => context,
    sessionStore: { async loadBrowserState() { return null; }, async saveBrowserState() { throw new Error("simulated Turso write failure"); } },
  });
  try {
    await worker.start();
    await assert.rejects(worker.openLogin(), /simulated Turso write failure/);
    const status = await worker.status();
    assert.equal(status.healthy, true);
    assert.equal(status.sessionPersistenceReady, false);
  } finally {
    await worker.close();
    if (previous === undefined) delete process.env.HMO_TEST_BROWSER_PATH; else process.env.HMO_TEST_BROWSER_PATH = previous;
  }
});
