import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = name => readFileSync(new URL('../apps/hearmeout/src/' + name, import.meta.url), 'utf8');
const browserModule = name => {
  const value = source(name);
  const start = value.indexOf('String.raw`') + 'String.raw`'.length;
  assert.ok(start >= 'String.raw`'.length);
  return value.slice(start, value.lastIndexOf('`;'));
};

// Exercise the actual browser code with deterministic media/DOM boundaries;
// no camera, microphone, cloud room, inference provider, or Discord is contacted.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.style = {}; this.attributes = {}; this.listeners = new Map();
    this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false;
    this.value = ''; this.srcObject = null; this.playCount = 0; this.pauseCount = 0;
  }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; } }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    const data = selector.match(/^\[data-([a-z-]+)\]$/);
    if (data) return Object.hasOwn(this.dataset, data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
    return this.tagName === selector.toUpperCase();
  }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentElement; } return null; }
  querySelectorAll(selector) {
    const nodes = this.children.flatMap(node => [node, ...node.querySelectorAll('*')]);
    if (selector === '*') return nodes;
    if (selector === '.hmo-persona-actions textarea') return nodes.filter(node => node.tagName === 'TEXTAREA' && node.closest('.hmo-persona-actions'));
    return nodes.filter(node => node.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback, options = {}) {
    const handlers = this.listeners.get(type) || [];
    handlers.push({ callback, capture: options === true || options.capture === true }); this.listeners.set(type, handlers);
  }
  fire(type, props = {}) {
    const event = { ...props, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    const handlers = [...(this.listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const { callback } of handlers) { callback(event); if (event.stopped) break; }
    return event;
  }
  click() { if (!this.disabled) this.fire('click'); }
  focus() { this.focused = true; }
  play() { this.playCount++; return Promise.resolve(); }
  pause() { this.pauseCount++; }
}
function dom() {
  const body = new Element('body'), grid = new Element('div'), head = new Element('header');
  grid.className = 'hmo-console-grid'; head.className = 'hmo-console-head'; body.append(head, grid);
  return { body, grid, head, createElement: tag => new Element(tag), querySelector: selector => body.querySelector(selector) };
}
function controls(popup = { focus() { this.focused = true; } }) {
  const document = dom(), calls = [], window = { open(...args) { calls.push(args); return popup; } };
  vm.runInNewContext(browserModule('room-controls-client.ts'), { document, window, URL, location: { origin: 'https://example.test' } });
  return { document, calls, popup, ...window.HearMeOutRoomControls };
}
function personaFixture() {
  const panel = new Element(), status = new Element(), input = new Element('textarea'), submit = new Element('button'), calls = [];
  panel.className = 'hmo-persona-actions'; status.className = 'hmo-status'; submit.textContent = 'Call Stella';
  panel.append(status, input, submit); submit.addEventListener('click', () => calls.push(input.value.trim()));
  const root = new Element(); root.append(panel);
  return { root, panel, status, input, submit, calls };
}

test('Commlink opens the shared service surface without navigating away', () => {
  const value = controls(); value.openCommlink({ origin: 'https://workspace.example', tenantId: 'tenant/one' });
  const [url, name, features] = value.calls[0], parsed = new URL(url);
  assert.equal(parsed.origin, 'https://workspace.example'); assert.equal(parsed.pathname, '/apps/commlink');
  assert.equal(parsed.searchParams.get('surface'), 'workspace-service'); assert.equal(parsed.searchParams.get('tenantId'), 'tenant/one');
  assert.equal(name, 'spmt-commlink'); assert.match(features, /popup/); assert.notEqual(name, '_top');
  assert.equal(value.popup.opener, null); assert.equal(value.popup.focused, true);
});
test('blocked Commlink popups show feedback and never navigate the room', () => {
  const value = controls(null); value.openCommlink(); value.openCommlink();
  const statuses = value.document.body.querySelectorAll('[data-hmo-commlink-status]');
  assert.equal(statuses.length, 1); assert.match(statuses[0].textContent, /voice room is still connected/);
  assert.equal(statuses[0].getAttribute('role'), 'status'); assert.equal(value.calls.length, 2);
});
test('persona Call becomes an accessible Send without replacing the working request handler', () => {
  const value = controls(), fixture = personaFixture(); value.enhancePersonas(fixture.root);
  assert.equal(fixture.submit.textContent, 'Send'); assert.equal(fixture.submit.getAttribute('aria-label'), 'Send message to Stella');
  fixture.input.value = 'Hello Stella'; fixture.submit.click(); assert.deepEqual(fixture.calls, ['Hello Stella']);
});
test('empty Send focuses the input and reports the choice of text or microphone', () => {
  const value = controls(), fixture = personaFixture(); value.enhancePersonas(fixture.root);
  fixture.input.value = '   '; fixture.submit.click(); assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.input.focused, true); assert.match(fixture.status.textContent, /Type a message for Stella/);
});
test('Ctrl/Command+Enter sends once; normal Enter and IME composition do not send', () => {
  const value = controls(), fixture = personaFixture(); value.enhancePersonas(fixture.root); value.enhancePersonas(fixture.root);
  fixture.input.value = 'Hello'; fixture.input.fire('keydown', { key: 'Enter' });
  fixture.input.fire('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }); assert.equal(fixture.calls.length, 0);
  fixture.input.fire('keydown', { key: 'Enter', ctrlKey: true }); assert.equal(fixture.calls.length, 1);
  fixture.submit.disabled = true; fixture.input.fire('keydown', { key: 'Enter', metaKey: true }); assert.equal(fixture.calls.length, 1);
  fixture.submit.disabled = false; fixture.input.fire('keydown', { key: 'Enter', metaKey: true }); assert.equal(fixture.calls.length, 2);
});
test('the existing surface loads the helper and hooks dynamically rendered persona controls', () => {
  const surface = source('surface-client.ts');
  assert.match(surface, /HEARMEOUT_ROOM_CONTROLS_BROWSER_JS \+ String\.raw/);
  assert.match(surface, /HearMeOutRoomControls\.enhancePersonas\(room\)/);
  assert.match(surface, /HearMeOutRoomControls\.openCommlink/);
  assert.doesNotMatch(surface, /window\.open\('\/\?app=commlink','_top'\)/);
});

class MediaTrack extends EventTarget {
  constructor(kind = 'video') { super(); this.kind = kind; this.id = Math.random().toString(); this.readyState = 'live'; this.enabled = true; }
  stop() { this.readyState = 'ended'; }
  end() { this.stop(); this.dispatchEvent(new Event('ended')); }
}
class Stream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
}
function rtcFixture() {
  const document = dom(), events = [], statuses = [], messages = [], rooms = [];
  class Room {
    constructor() { rooms.push(this); this.handlers = new Map(); this.localParticipant = { trackPublications: new Map(), publishTrack: async () => {}, unpublishTrack: async () => {} }; }
    on(name, handler) { this.handlers.set(name, handler); }
    async connect() {} async disconnect() {}
  }
  const livekit = { Room, RoomEvent: { TrackSubscribed: 'subscribed', TrackUnsubscribed: 'unsubscribed', Disconnected: 'disconnected' }, Track: { Kind: { Audio: 'audio', Video: 'video' }, Source: { Microphone: 'microphone', ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' } } };
  const window = { dispatchEvent(event) { events.push(event); } }, exports = {}, navigator = { mediaDevices: {} };
  const compiled = ts.transpileModule(source('rtc-browser.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.deepEqual(compiled.diagnostics, []);
  vm.runInNewContext(compiled.outputText, { exports, require(name) { assert.equal(name, 'livekit-client'); return livekit; }, window, document, navigator,
    MediaStream: Stream, WebSocket: { OPEN: 1 }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    setTimeout, clearTimeout, localStorage: { getItem() { return null; } } });
  const rtc = new exports.HearMeOutRtc({ onStatus(message) { statuses.push(message); } });
  rtc.roomId = 'room'; rtc.socket = { readyState: 1, send(value) { messages.push(JSON.parse(value)); }, close() {} };
  rtc.snapshot = { type: 'room', id: 1, mode: 'waiting', epoch: 0, peers: [{ id: 1, userId: 'self', name: 'You' }, { id: 2, userId: 'viewer', name: 'Viewer', screenSharing: true }], iceServers: [] };
  return { rtc, document, events, statuses, messages, rooms, navigator };
}

test('screen capture immediately creates a muted local preview even in an idle room', async () => {
  const { rtc, document, messages } = rtcFixture(), track = new MediaTrack(), stream = new Stream([track, new MediaTrack('audio')]);
  await rtc.setScreen(stream);
  const video = document.querySelector('[data-hmo-local-screen]'), host = document.querySelector('[data-hmo-screens]');
  assert.ok(video); assert.equal(video.muted, true); assert.equal(video.playsInline, true);
  assert.equal(video.srcObject.getTracks().length, 1); assert.equal(video.srcObject.getTracks()[0], track); assert.equal(host.hidden, false); assert.equal(host.parentElement, document.grid);
  assert.equal(rtc.diagnostics().screenSharing, true); assert.equal(messages.at(-1).sharing, true);
  rtc.close(); assert.equal(track.readyState, 'ended'); assert.equal(document.querySelector('[data-hmo-local-screen]'), null); assert.equal(host.hidden, true);
});
test('browser stop-sharing clears the preview and sharing controls', async () => {
  const { rtc, document, events } = rtcFixture(), track = new MediaTrack(); await rtc.setScreen(new Stream([track]));
  track.end(); await Promise.resolve();
  assert.equal(document.querySelector('[data-hmo-local-screen]'), null); assert.equal(rtc.diagnostics().screenSharing, false);
  assert.equal(events.at(-1).detail.sharing, false);
});
test('transport changes and room re-render retain the live local preview', async () => {
  const { rtc, document } = rtcFixture(), track = new MediaTrack(); await rtc.setScreen(new Stream([track]));
  const video = document.querySelector('[data-hmo-local-screen]'); rtc.stopTransport();
  assert.equal(document.querySelector('[data-hmo-local-screen]'), video); assert.equal(track.readyState, 'live');
  document.querySelector('[data-hmo-screens]').remove(); rtc.updateScreens();
  assert.equal(document.querySelector('[data-hmo-local-screen]'), video); assert.equal(video.parentElement.hidden, false); rtc.close();
});
test('waiting-room snapshots restore preview after the UI is replaced', async () => {
  const { rtc, document } = rtcFixture(), track = new MediaTrack(); await rtc.setScreen(new Stream([track]));
  document.querySelector('[data-hmo-screens]').remove(); await rtc.applySnapshot(rtc.snapshot);
  assert.ok(document.querySelector('[data-hmo-local-screen]')); rtc.close();
});
test('ending an old remote track cannot delete its replacement', () => {
  const { rtc, document } = rtcFixture(), oldTrack = new MediaTrack(), nextTrack = new MediaTrack();
  rtc.attachScreen(2, oldTrack); rtc.attachScreen(2, nextTrack); const next = rtc.screens.get(2); oldTrack.end();
  assert.equal(rtc.screens.get(2), next); assert.equal(next.srcObject.getVideoTracks()[0], nextTrack);
  assert.equal(document.querySelector('[data-hmo-screens]').hidden, false);
  nextTrack.end(); assert.equal(rtc.screens.size, 0); assert.equal(document.querySelector('[data-hmo-screens]').hidden, true);
});
test('receive-only screen viewers obey server mute and explicit visibility flags', () => {
  const { rtc, document } = rtcFixture(); rtc.attachScreen(2, new MediaTrack()); const video = rtc.screens.get(2);
  assert.equal(video.style.display, 'block'); rtc.snapshot.peers[1].serverMuted = true; rtc.updateScreens();
  assert.equal(video.hidden, true); assert.equal(video.style.display, 'none'); assert.equal(document.querySelector('[data-hmo-screens]').hidden, true);
  rtc.snapshot.peers[1].serverMuted = false; rtc.updateScreens(); assert.equal(video.style.display, 'block');
  rtc.snapshot.peers[1].screenSharing = false; rtc.updateScreens(); assert.equal(video.style.display, 'none');
});
test('LiveKit unsubscribe removes the matching remote screen without waiting for track ended', async () => {
  const { rtc, rooms, document } = rtcFixture(), track = new MediaTrack();
  await rtc.connectLiveKit({ ...rtc.snapshot, livekit: { url: 'wss://example.test', token: 'test-only' } }, rtc.generation);
  const room = rooms[0], remote = { kind: 'video', mediaStreamTrack: track };
  room.handlers.get('subscribed')(remote, {}, { identity: '2' }); assert.equal(rtc.screens.size, 1);
  room.handlers.get('unsubscribed')(remote, {}, { identity: '2' }); assert.equal(rtc.screens.size, 0);
  assert.equal(document.querySelector('[data-hmo-screens]').hidden, true); rtc.close();
});
test('failed screen publication stops capture and clears the local preview', async () => {
  const { rtc, document, navigator } = rtcFixture(), track = new MediaTrack();
  navigator.mediaDevices.getDisplayMedia = async () => new Stream([track]);
  rtc.livekit = { localParticipant: { trackPublications: new Map(), publishTrack: async () => { throw new Error('publish failed'); } } };
  await assert.rejects(rtc.shareScreen(), /publish failed/); assert.equal(track.readyState, 'ended');
  assert.equal(rtc.diagnostics().screenSharing, false); assert.equal(document.querySelector('[data-hmo-local-screen]'), null);
});
test('unsupported screen capture reports a useful error rather than a TypeError', async () => {
  const { rtc } = rtcFixture(); await assert.rejects(rtc.shareScreen(), /supported desktop browser/);
});

test('the combined surface and room-control browser bundle parses', () => {
  const evaluate = (name, require) => {
    const result = ts.transpileModule(source(name), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
    assert.deepEqual(result.diagnostics, []); const exports = {};
    vm.runInNewContext(result.outputText, { exports, require }); return exports;
  };
  const controls = evaluate('room-controls-client.ts', () => assert.fail('Unexpected dependency'));
  const surface = evaluate('surface-client.ts', name => {
    if (name === './room-controls-client.js') return controls;
    assert.equal(name, '@spmt/contracts/surface'); return { assertAppSurfaceManifestV1: value => value };
  });
  assert.doesNotThrow(() => new vm.Script(surface.HEARMEOUT_SURFACE_BROWSER_JS));
});
