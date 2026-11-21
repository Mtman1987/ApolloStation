import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const dir = join(root, "tools/apollo-work-resumer/extension");

function loadContentScript(source, {
  composerText = "",
  sendButton = true,
  sendInitiallyDisabled = true,
  busy = false,
  acceptInput = true,
} = {}) {
  const handlers = [];
  let currentText = composerText;
  let clickCount = 0;
  const button = {
    disabled: sendInitiallyDisabled,
    textContent: "Send",
    getAttribute(name) {
      if (name === "aria-label") return "Send";
      if (name === "data-testid") return "send-button";
      return null;
    },
    getClientRects() { return [{}]; },
    click() { clickCount += 1; },
  };
  const composer = {
    tagName: "DIV",
    disabled: false,
    get textContent() { return currentText; },
    set textContent(value) { currentText = value; },
    get innerText() { return currentText; },
    getAttribute() { return null; },
    focus() {},
    dispatchEvent(event) {
      if (event.type === "input" && acceptInput) button.disabled = false;
      return true;
    },
  };
  const document = {
    querySelectorAll(selector) {
      if (selector === "button") return sendButton ? [button] : [];
      return [];
    },
    querySelector(selector) {
      if (selector === '[aria-busy="true"]') return busy ? {} : null;
      if (selector === '[contenteditable="true"][role="textbox"],textarea') return composer;
      return null;
    },
  };
  const chrome = { runtime: { onMessage: { addListener(listener) { handlers.push(listener); } } } };
  class MockInputEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  class MockEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } }

  runInNewContext(source, {
    chrome,
    document,
    location: { href: "https://chatgpt.com/c/test-conversation" },
    window: { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) },
    InputEvent: MockInputEvent,
    Event: MockEvent,
  });

  const listener = handlers[0];
  const dispatch = message => {
    let response;
    listener(message, {}, value => { response = value; });
    return response;
  };
  return {
    dispatch,
    get clickCount() { return clickCount; },
    get composerText() { return currentText; },
  };
}

test("extension manifest grants only ChatGPT UI and the fixed Apollo inbox", async () => {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, [
    "https://chatgpt.com/*",
    "https://github.com/Mtman1987/ApolloStation/pull/553*",
  ]);
  assert.ok(manifest.permissions.includes("storage") && manifest.permissions.includes("alarms") && manifest.permissions.includes("notifications"));
  assert.ok(manifest.content_scripts.some(script =>
    script.matches.includes("https://github.com/Mtman1987/ApolloStation/pull/553*") &&
    script.js.includes("github-bridge.js")
  ));
});

test("extension scripts parse", async () => {
  for (const file of ["background.js", "content.js", "github-bridge.js", "popup.js"]) {
    const result = spawnSync(process.execPath, ["--check", join(dir, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, file + ": " + result.stderr);
  }
});

test("content preflight allows the normal disabled empty-composer Send button and clicks only after it enables", async () => {
  const source = await readFile(join(dir, "content.js"), "utf8");
  const harness = loadContentScript(source);
  const snapshot = harness.dispatch({ type: "APOLLO_SNAPSHOT" });
  assert.equal(snapshot.sendControlPresent, true);
  assert.equal(snapshot.sendControlVisible, false);
  assert.equal(snapshot.composerEmpty, true);

  const result = harness.dispatch({
    type: "APOLLO_SUBMIT",
    targetUrl: "https://chatgpt.com/c/test-conversation",
    prompt: "harmless proof",
  });
  assert.equal(result.clicked, true);
  assert.equal(harness.clickCount, 1);
  assert.equal(harness.composerText, "harmless proof");
});

test("content refuses to overwrite a pre-existing composer draft", async () => {
  const source = await readFile(join(dir, "content.js"), "utf8");
  const harness = loadContentScript(source, {
    composerText: "owner's unsent draft",
    sendInitiallyDisabled: false,
  });
  const result = harness.dispatch({
    type: "APOLLO_SUBMIT",
    targetUrl: "https://chatgpt.com/c/test-conversation",
    prompt: "queued task",
  });
  assert.equal(result.clicked, false);
  assert.equal(result.reason, "preflight-guard-failed");
  assert.equal(harness.composerText, "owner's unsent draft");
  assert.equal(harness.clickCount, 0);
});

test("content fails closed for missing Send, busy UI, wrong URL, or a Send button that stays disabled", async () => {
  const source = await readFile(join(dir, "content.js"), "utf8");

  const missing = loadContentScript(source, { sendButton: false });
  assert.equal(missing.dispatch({
    type: "APOLLO_SUBMIT",
    targetUrl: "https://chatgpt.com/c/test-conversation",
    prompt: "task",
  }).clicked, false);

  const busy = loadContentScript(source, { busy: true });
  assert.equal(busy.dispatch({
    type: "APOLLO_SUBMIT",
    targetUrl: "https://chatgpt.com/c/test-conversation",
    prompt: "task",
  }).clicked, false);

  const mismatch = loadContentScript(source);
  assert.equal(mismatch.dispatch({
    type: "APOLLO_SUBMIT",
    targetUrl: "https://chatgpt.com/c/another-conversation",
    prompt: "task",
  }).clicked, false);

  const disabled = loadContentScript(source, { acceptInput: false });
  const result = disabled.dispatch({
    type: "APOLLO_SUBMIT",
    targetUrl: "https://chatgpt.com/c/test-conversation",
    prompt: "task",
  });
  assert.equal(result.clicked, false);
  assert.equal(result.reason, "post-fill-guard-failed");
  assert.equal(disabled.clickCount, 0);
});

test("background requires a unique active exact tab and uses a serialized runner", async () => {
  const background = await readFile(join(dir, "background.js"), "utf8");
  assert.match(background, /return selectUniqueActiveTab\(matches, url\)/);
  assert.match(background, /createSerialRunner\(\)/);
  assert.match(background, /tick-skipped-uncertain-send-no-retry/);
  assert.match(background, /isTrustedBridgeSender\(sender\)/);
  assert.match(background, /processedCommandIds = \[\.\.\.processed, command\.id\]/);
  assert.doesNotMatch(background, /processedCommandIds = \[\.\.\.processed, command\.id\]\.slice/);
});

test("GitHub bridge marks a command seen only after acceptance or duplicate confirmation", async () => {
  const bridge = await readFile(join(dir, "github-bridge.js"), "utf8");
  const sendIndex = bridge.indexOf("await chrome.runtime.sendMessage");
  const seenIndex = bridge.indexOf("seen.add(command.id)", sendIndex);
  assert.ok(sendIndex >= 0 && seenIndex > sendIndex);
  assert.match(bridge, /result\?\.queued === true \|\| result\?\.duplicate === true/);
});

test("GitHub Actions proof is manual-only and validates exact conversation URLs", async () => {
  const workflow = await readFile(join(root, ".github/workflows/apollo-local-chrome-proof.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /chatgpt\.com/);
  assert.match(workflow, /createComment/);
  assert.match(workflow, /issue_number: 553/);
});
