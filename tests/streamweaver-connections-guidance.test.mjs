import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { streamWeaverBrowserJs } from '../apps/streamweaver/dist/web-client.js';

test('Connections guides broadcaster and personal bot separately without prescribing another account', () => {
  const js = streamWeaverBrowserJs();
  const start = js.indexOf('function drawIntegrations()');
  const end = js.indexOf('function drawEconomy()', start);
  assert.ok(start >= 0 && end > start);
  let html;
  vm.runInNewContext(js.slice(start, end) + ';drawIntegrations();', {
    owner: () => true,
    control: { tenantId: 'owner-workspace', providerLinks: [], connections: [] },
    setPage: (id, value) => { assert.equal(id, 'integrations'); html = value; },
    field: () => '', button: () => '', esc: String, encodeURIComponent,
  });
  assert.match(html, /Twitch account that owns your channel/);
  assert.match(html, /Authorize broadcaster permissions with that same broadcaster account/);
  assert.match(html, /enter your personal bot’s Twitch login/);
  assert.match(html, /reserved roles appear only in their configured workspace/);
  assert.doesNotMatch(html, /<strong>mtman1987<\/strong>|<strong>spacemountainlive<\/strong>/);
});

test('Connections status loads immediately after drawing the controls', async () => {
  const js = streamWeaverBrowserJs();
  const start = js.indexOf('async function refresh()');
  const end = js.indexOf('function changeEditor(', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = {
    loading: false, control: null, library: null, editor: null, initialized: false,
    api: async () => ({}), loadAiJobs: async () => {},
    setPage: () => {}, status: () => {},
    twitchBotFleet: () => calls.push('bots'),
    youtubeConnections: () => calls.push('youtube'), drawActivity: () => {},
  };
  for (const name of ['drawSetup', 'drawCommunity', 'drawCommands', 'drawDevices', 'drawVoice', 'drawPersona', 'drawEconomy', 'drawIntegrations', 'drawOverlays', 'drawBuilder']) {
    context[name] = () => calls.push(name);
  }
  await vm.runInNewContext(js.slice(start, end) + ';refresh();', context);
  assert.ok(calls.indexOf('bots') > calls.indexOf('drawIntegrations'));
  assert.ok(calls.indexOf('youtube') > calls.indexOf('drawIntegrations'));
});