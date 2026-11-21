import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const dir = join(root, "tools/apollo-work-resumer/extension");

test("extension manifest is valid and only grants ChatGPT host access", async () => {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*"]);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.permissions.includes("notifications"));
});

test("extension scripts parse", () => {
  for (const file of ["background.js", "content.js", "popup.js"]) {
    const result = spawnSync(process.execPath, ["--check", join(dir, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, file + ": " + result.stderr);
  }
});

function fakeElement({
  tagName = "BUTTON",
  ariaLabel = null,
  testId = null,
  text = "",
  visible = true,
  disabled = false
} = {}) {
  const attributes = {
    "aria-label": ariaLabel,
    "data-testid": testId,
    "aria-disabled": disabled ? "true" : "false"
  };
  return {
    tagName,
    textContent: text,
    innerText: text,
    disabled,
    hidden: false,
    value: "",
    parentElement: null,
    clicked: 0,
    getAttribute(name) { return attributes[name] ?? null; },
    getClientRects() { return visible ? [{}] : []; },
    focus() {},
    dispatchEvent() {},
    click() { this.clicked += 1; }
  };
}

async function loadContent({ url, buttons = [], composers = [], busy = [], assistants = [], visibility = "visible" }) {
  const source = await readFile(join(dir, "content.js"), "utf8");
  let listener;
  const document = {
    visibilityState: visibility,
    querySelectorAll(selector) {
      if (selector === "button") return buttons;
      if (selector.includes("contenteditable")) return composers;
      if (selector.includes("aria-busy")) return busy;
      if (selector.includes("data-message-author-role")) return assistants;
      return [];
    }
  };
  const context = {
    document,
    location: { href: url },
    chrome: { runtime: { onMessage: { addListener(callback) { listener = callback; } } } },
    getComputedStyle(element) {
      return {
        display: element.getClientRects().length ? "block" : "none",
        visibility: "visible",
        opacity: "1"
      };
    },
    InputEvent: class InputEvent { constructor(type, options) { this.type = type; this.options = options; } },
    Event: class Event { constructor(type, options) { this.type = type; this.options = options; } }
  };
  runInNewContext(source, context);
  return { listener };
}

test("content snapshot treats hidden controls as absent and unknown idle state as ambiguous", async () => {
  const url = "https://chatgpt.com/c/abc";
  const hiddenSend = fakeElement({ ariaLabel: "Send prompt", visible: false });
  const composer = fakeElement({ tagName: "DIV" });
  const { listener } = await loadContent({ url, buttons: [hiddenSend], composers: [composer] });
  let snapshot;
  listener({ type: "APOLLO_SNAPSHOT" }, {}, value => { snapshot = value; });
  assert.equal(snapshot.sendControlVisible, false);
  assert.equal(snapshot.busy, null);
  assert.equal(snapshot.composerReady, true);
});

test("content snapshot recognizes only a visible enabled send control plus composer as idle", async () => {
  const url = "https://chatgpt.com/c/abc";
  const send = fakeElement({ ariaLabel: "Send prompt" });
  const composer = fakeElement({ tagName: "DIV" });
  const { listener } = await loadContent({ url, buttons: [send], composers: [composer] });
  let snapshot;
  listener({ type: "APOLLO_SNAPSHOT" }, {}, value => { snapshot = value; });
  assert.equal(snapshot.busy, false);
  assert.equal(snapshot.pageVisible, true);
  assert.equal(snapshot.sendControlVisible, true);
});

test("content submission refuses hidden send controls and exact-URL mismatches", async () => {
  const url = "https://chatgpt.com/c/abc";
  const hiddenSend = fakeElement({ ariaLabel: "Send prompt", visible: false });
  const composer = fakeElement({ tagName: "DIV" });
  const hidden = await loadContent({ url, buttons: [hiddenSend], composers: [composer] });
  let hiddenResult;
  hidden.listener({ type: "APOLLO_SUBMIT", targetUrl: url, prompt: "test prompt" }, {}, value => { hiddenResult = value; });
  assert.equal(hiddenResult.clicked, false);
  assert.equal(hiddenSend.clicked, 0);

  const send = fakeElement({ ariaLabel: "Send prompt" });
  const visibleComposer = fakeElement({ tagName: "DIV" });
  const exact = await loadContent({ url, buttons: [send], composers: [visibleComposer] });
  let mismatchResult;
  exact.listener({ type: "APOLLO_SUBMIT", targetUrl: url + "?other=1", prompt: "test prompt" }, {}, value => { mismatchResult = value; });
  assert.equal(mismatchResult.clicked, false);
  assert.equal(send.clicked, 0);
});

test("content submission fills and clicks one visible send button only on the exact visible page", async () => {
  const url = "https://chatgpt.com/c/abc";
  const send = fakeElement({ ariaLabel: "Send prompt" });
  const composer = fakeElement({ tagName: "DIV" });
  const { listener } = await loadContent({ url, buttons: [send], composers: [composer] });
  let result;
  listener({ type: "APOLLO_SUBMIT", targetUrl: url, prompt: "safe test prompt" }, {}, value => { result = value; });
  assert.equal(result.clicked, true);
  assert.equal(composer.textContent, "safe test prompt");
  assert.equal(send.clicked, 1);
});
