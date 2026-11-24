import test from "node:test";
import assert from "node:assert/strict";
import { ApolloChatGptBrowserWorker } from "./browser-worker.mjs";

function fakeWorker({ url = "https://chatgpt.com/", pageClosed = false, browserConnected = true } = {}) {
  const worker = new ApolloChatGptBrowserWorker();
  worker.context = { browser: () => ({ isConnected: () => browserConnected }) };
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
