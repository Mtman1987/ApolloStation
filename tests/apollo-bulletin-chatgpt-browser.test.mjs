import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatGPTBrowserAdapter, browserControlPage } from "../tools/apollo-bulletin/chatgpt-browser-adapter.mjs";

function fakeBrowser() {
  let currentUrl = "about:blank";
  let prompt = "";
  let sent = 0;
  const page = {
    isClosed: () => false,
    url: () => currentUrl,
    goto: async url => { currentUrl = url; },
    setDefaultTimeout() {},
    on() {},
    evaluate: async fn => fn.toString().includes("location.href") ? ({
      url: currentUrl, loggedIn: true, composerReady: true,
      sendControlVisible: true, busy: false, stopControlVisible: false,
    }) : true,
    locator: () => ({
      first() { return this; },
      async fill(value) { prompt = value; },
      async click() { sent++; prompt = ""; },
      async evaluate() { return prompt === ""; },
    }),
    waitForTimeout: async () => {},
    screenshot: async () => Buffer.from("png"),
    mouse: { click: async () => {} },
    keyboard: { type: async () => {}, press: async () => {} },
  };
  const context = { pages: () => [page], newPage: async () => page, close: async () => {} };
  return { page, context, sent: () => sent };
}

test("Bulletin ChatGPT browser opens the requested conversation and submits one prompt without reading replies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-chatgpt-browser-"));
  const fake = fakeBrowser();
  let launchOptions;
  const adapter = createChatGPTBrowserAdapter({
    profileDir: directory,
    browserPath: async () => "/fake/chromium",
    launch: async (_profile, options) => { launchOptions = options; return fake.context; },
  });
  try {
    const result = await adapter.dispatch({
      conversationUrl: "https://chatgpt.com/c/test-conversation",
      prompt: "Run the Bulletin proof task",
    });
    assert.equal(result.submitted, true);
    assert.equal(fake.sent(), 1);
    assert.equal(fake.page.url(), "https://chatgpt.com/c/test-conversation");
    assert.equal(launchOptions.headless, true);
    assert.equal((await adapter.status()).loggedIn, true);
  } finally {
    await adapter.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser adapter refuses non-ChatGPT navigation and bounds remote keyboard input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-chatgpt-browser-"));
  const fake = fakeBrowser();
  const adapter = createChatGPTBrowserAdapter({
    profileDir: directory, browserPath: async () => "/fake/chromium",
    launch: async () => fake.context,
  });
  try {
    await assert.rejects(adapter.input({ action: "navigate", url: "https://example.com/" }), /only open ChatGPT/);
    await assert.rejects(adapter.input({ action: "type", text: "x".repeat(2001) }), /1–2000/);
  } finally {
    await adapter.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser control page clearly identifies the development-only prompt sender", () => {
  const html = browserControlPage();
  assert.match(html, /Sign in to ChatGPT here once/);
  assert.match(html, /does not read or monitor replies/);
  assert.match(html, /bulletin\/browser\/screenshot/);
});
