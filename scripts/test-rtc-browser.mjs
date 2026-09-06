import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { HearMeOutRoomRtcGateway } from '../apps/hearmeout/dist/rtc-room-gateway.js';
import { attachHearMeOutRtcProxy } from '../apps/spacemountain-web/dist/rtc-upgrade-proxy.js';

const allowed = new Set(['alice', 'bob']);
const internal = createServer();
const gateway = new HearMeOutRoomRtcGateway({
  resolvePrincipal: async request => {
    const userId = String(request.headers.cookie || '').match(/session=(alice|bob)/)?.[1];
    if (!userId) throw new Error('No session');
    return { userId, tenantId: 'rtc-test', displayName: userId, roles: ['member'] };
  },
  requireMembership: (principal, roomId) => { if (roomId !== 'private-room' || !allowed.has(principal.userId)) throw new Error('Not admitted'); },
  livekit: { url: 'wss://127.0.0.1:1', apiKey: 'test-api-key', apiSecret: 'test-only-livekit-signing-key' },
  iceServers: [], membershipCheckMs: 1000,
});
gateway.attach(internal);
await new Promise(resolve => internal.listen(0, '127.0.0.1', resolve));
const bundle = await readFile(new URL('../apps/hearmeout/dist/rtc-client.js', import.meta.url));
const outer = createServer((request, response) => {
  if (request.url === '/rtc-client.js') { response.writeHead(200, { 'content-type': 'application/javascript' }); response.end(bundle); return; }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(`<button id="join">Join room</button><p id="status"></p><script src="/rtc-client.js"></script><script>
  document.querySelector('#join').onclick=async()=>{
    const context=new AudioContext(),oscillator=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
    oscillator.frequency.value=440;gain.gain.value=0.1;oscillator.connect(gain).connect(destination);oscillator.start();await context.resume();
    window.input=destination.stream;window.synth=context;
    window.rtc=new HearMeOutRtc({onStatus:value=>document.querySelector('#status').textContent=value});
    await window.rtc.start('private-room',destination.stream);
  };</script>`);
});
const stopProxy = attachHearMeOutRtcProxy(outer, `http://127.0.0.1:${internal.address().port}`);
await new Promise(resolve => outer.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${outer.address().port}`;
let browser;
try {
  const refused = await new Promise((resolve, reject) => {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/hearmeout/rtc?roomId=private-room', { headers: { Origin: 'https://unrelated.example', Cookie: 'session=alice' } });
    socket.on('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode); });
    socket.on('error', () => {}); socket.on('open', () => { socket.close(); reject(new Error('Cross-origin socket accepted')); });
  });
  assert.equal(refused, 403);
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const pages = [];
  for (const user of ['alice', 'bob']) {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'session', value: user, url: origin }]);
    const page = await context.newPage();
    page.on('pageerror', error => console.error('browser error:', error.message));
    await page.goto(origin); await page.click('#join'); pages.push(page);
    if (user === 'alice') {
      await page.waitForFunction(() => window.rtc?.diagnostics().mode === 'waiting');
      assert.equal(gateway.diagnostics().relay[0].participants.length, 1);
    }
  }
  for (const page of pages) await page.waitForFunction(() => window.rtc?.diagnostics().peers.length === 1 && window.rtc.diagnostics().peers.every(value => value === 'connected'), null, { timeout: 35_000 });
  for (const page of pages) await page.waitForFunction(async () => {
    for (const { pc } of window.rtc.links.values()) for (const report of (await pc.getStats()).values()) {
      if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.packetsReceived > 5 && report.totalAudioEnergy > 0) return true;
    }
    return false;
  });
  console.log('PASS: solo room stays idle; failed LiveKit connection moves both browsers to direct WebRTC; actual audio packets have energy.');
  await pages[0].evaluate(() => {
    const state = window.rtc.diagnostics();
    window.rtc.socket.send(JSON.stringify({ type: 'failed', transport: state.mode, epoch: state.epoch, reason: 'ICE failed during test' }));
  });
  for (const page of pages) await page.waitForFunction(() => window.rtc?.diagnostics().mode === 'wss-relay' && window.rtc.diagnostics().framesReceived > 8);
  for (const page of pages) {
    assert.equal(await page.evaluate(() => window.rtc.diagnostics().inputLive), true);
    await page.evaluate(() => {
      const output = [...window.rtc.playout.values()][0]; window.checkAudio = window.rtc.context.createAnalyser(); output.gain.connect(window.checkAudio);
    });
    await page.waitForFunction(() => {
      const samples = new Float32Array(window.checkAudio.fftSize); window.checkAudio.getFloatTimeDomainData(samples);
      return samples.some(value => Math.abs(value) > 0.005);
    });
  }
  console.log('PASS: coordinated relay fallback carries PCM audio through the real ingress and plays a nonzero waveform on both browsers.');
  await pages[0].evaluate(() => window.input.getAudioTracks()[0].enabled = false);
  const sent = await pages[0].evaluate(() => window.rtc.diagnostics().framesSent);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await pages[0].evaluate(() => window.rtc.diagnostics().framesSent), sent);
  for (const page of pages) await page.evaluate(() => { window.beforeReconnect = window.rtc.diagnostics().framesReceived; window.previousSocket = window.rtc.socket; });
  await pages[0].evaluate(() => { window.input.getAudioTracks()[0].enabled = true; window.rtc.socket.close(); });
  await pages[0].waitForFunction(() => window.rtc.socket && window.rtc.socket !== window.previousSocket && window.rtc.socket.readyState === WebSocket.OPEN);
  for (const page of pages) await page.waitForFunction(() => window.rtc?.diagnostics().mode === 'wss-relay' && window.rtc.diagnostics().framesReceived > window.beforeReconnect + 20);
  allowed.delete('bob');
  await pages[1].waitForFunction(() => document.querySelector('#status').textContent === 'Room access ended.');
  await pages[0].waitForFunction(() => window.rtc?.diagnostics().mode === 'waiting');
  console.log('PASS: mute stops audio transmission, reconnect recovers, and revoked membership disconnects the participant.');
} finally {
  await browser?.close(); stopProxy(); gateway.close();
  await new Promise(resolve => outer.close(resolve)); await new Promise(resolve => internal.close(resolve));
}
