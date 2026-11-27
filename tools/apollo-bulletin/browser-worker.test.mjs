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

test("a missing page blocks before send and always releases the browser busy lock", async () => {
  const worker = new ApolloChatGptBrowserWorker({});
  const result = await worker.sendTask({ prompt: "Do not send", conversationUrl: "https://chatgpt.com/c/pre-send-recovery" });
  assert.equal(result.submitted, false);
  assert.match(result.reason, /^browser-dispatch-blocked: Dedicated ChatGPT browser is not started/);
  assert.equal(worker.busy, false);
});

test("browser status exposes health separately from ChatGPT login state", async () => {
  for (const url of ["https://chatgpt.com/auth/login", "https://chatgpt.com/auth/signin", "https://chatgpt.com/login", "https://auth.openai.com/log-in", "https://auth.openai.com/sign-in"]) {
    const status = await fakeWorker({ url }).status();
    assert.equal(status.healthy, true);
    assert.equal(status.connected, true);
    assert.equal(status.loginRequired, true, url);
  }
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
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-browser-session-"));
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
    close: async () => {},
  };
  const worker = new ApolloChatGptBrowserWorker({
    profilePath: join(directory, "profile"),
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
    await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HMO_TEST_BROWSER_PATH; else process.env.HMO_TEST_BROWSER_PATH = previous;
  }
});

test("browser session persistence failure is visible and not reported ready", async () => {
  const previous = process.env.HMO_TEST_BROWSER_PATH;
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-browser-session-failure-"));
  process.env.HMO_TEST_BROWSER_PATH = process.execPath;
  let currentUrl = "about:blank";
  const page = {
    isClosed: () => false,
    url: () => currentUrl,
    title: async () => "ChatGPT",
    goto: async url => { currentUrl = url; },
    getByRole: () => ({ first: () => ({ isVisible: async () => false }) }),
  };
  const context = { pages: () => [page], browser: () => ({ isConnected: () => true }), storageState: async () => ({ cookies: [], origins: [] }), close: async () => {} };
  const worker = new ApolloChatGptBrowserWorker({
    profilePath: join(directory, "profile"),
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
    await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HMO_TEST_BROWSER_PATH; else process.env.HMO_TEST_BROWSER_PATH = previous;
  }
});
test("browser startup restores the stored ChatGPT session state from Turso", async () => {
  const previous = process.env.HMO_TEST_BROWSER_PATH;
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-browser-session-restore-"));
  process.env.HMO_TEST_BROWSER_PATH = process.execPath;
  const storedState = { cookies: [{ name: "test-session-cookie", value: "test-only", domain: "chatgpt.com", path: "/" }], origins: [] };
  let launchOptions;
  const page = { isClosed: () => false, url: () => "https://chatgpt.com/", title: async () => "ChatGPT", getByRole: () => ({ first: () => ({ isVisible: async () => false }) }) };
  const context = { pages: () => [page], browser: () => ({ isConnected: () => true }), close: async () => {} };
  const worker = new ApolloChatGptBrowserWorker({
    profilePath: join(directory, "profile"),
    launch: async (_path, options) => { launchOptions = options; return context; },
    sessionStore: { async loadBrowserState() { return storedState; }, async saveBrowserState() {} },
  });
  try {
    await worker.start();
    assert.deepEqual(launchOptions.storageState, storedState);
    assert.equal((await worker.status()).healthy, true);
  } finally {
    await worker.close();
    await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HMO_TEST_BROWSER_PATH; else process.env.HMO_TEST_BROWSER_PATH = previous;
  }
});

test("completion marker is detected before a long assistant reply is truncated for storage", async () => {
  const marker = "APOLLO_BULLETIN_COMPLETE_LONG_REPLY";
  const fullReply = "Progress detail. ".repeat(900) + "\n" + marker;
  const targetUrl = "https://chatgpt.com/c/long-reply-marker";
  const response = { async waitFor() {}, async innerText() { return fullReply; } };
  const composer = {
    async waitFor() {},
    async evaluate() { return ""; },
    async fill() {},
  };
  const sendButton = {
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() {},
  };
  const worker = new ApolloChatGptBrowserWorker({
    sessionStore: { async saveBrowserState() {} },
  });
  worker.context = { async storageState() { return { cookies: [], origins: [] }; } };
  worker.page = {
    async goto() {},
    url() { return targetUrl; },
    locator(selector) {
      if (selector.includes("data-message-author-role")) {
        return { async count() { return 0; }, last() { return response; } };
      }
      return { last() { return composer; } };
    },
    getByRole() { return { last() { return sendButton; } }; },
    async waitForFunction() {},
  };

  const result = await worker.sendTask({
    prompt: "Complete the task",
    conversationUrl: targetUrl,
    completionMarker: marker,
  });
  assert.equal(result.submitted, true);
  assert.equal(result.receipt.reply.length, 12000);
  assert.equal(result.receipt.reply.includes(marker), false, "the marker is beyond the stored receipt limit");
  assert.equal(result.receipt.completionMarkerObserved, true);
  assert.equal(worker.busy, false);
});
