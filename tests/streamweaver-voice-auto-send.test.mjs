import assert from "node:assert/strict";
import test from "node:test";
import { streamWeaverBrowserJs } from "../apps/streamweaver/dist/web-client.js";

const browser = streamWeaverBrowserJs();

test("Voice Commander offers opt-in five-second silence auto-send", () => {
  assert.match(browser, /data-sw-auto-send/);
  assert.match(browser, /voiceAutoSend=Boolean\(slots\('voice'\)\.querySelector\('\[data-sw-auto-send\]'\)\?\.checked\)/);
  assert.match(browser, /voiceSilenceTimer=setTimeout/);
  assert.match(browser, /},5000\)/);
  assert.match(browser, /voiceAutoSubmitPending/);
  assert.match(browser, /requestSubmit\(\)/);
});

test("manual stop, send, and recognition errors cancel pending auto-send", () => {
  assert.match(browser, /clearTimeout\(voiceSilenceTimer\)/);
  assert.match(browser, /voiceAutoSubmitPending=false/);
  assert.match(browser, /if\(listening\)\{try\{recognition\?\.stop\(\)\}catch\{\}\}/);
});
