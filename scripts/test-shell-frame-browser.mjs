import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSpaceMountainWebHost } from '../apps/spacemountain-web/dist/server.js';

const phase = process.argv[2] ?? 'after';
const out = '/home/user/apollo-frame-proof';
await mkdir(out, { recursive: true });
const host = createSpaceMountainWebHost({ spmtOrigin: 'http://127.0.0.1:1', host: '127.0.0.1', port: 0,
  fetchImpl: async () => new Response('{}', { status: 401 }) });
await host.listen();
const origin = `http://127.0.0.1:${host.server.address().port}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(`${origin}/frame-test`, route => route.fulfill({ contentType: 'text/html', body:
    `<html><body style="margin:0;background:#111827;color:white;font:16px system-ui"><header style="padding:16px">Apollo local frame test · ${phase}<br><small>Real app response · test session unauthenticated</small></header><iframe title="Stellar Core" src="/apps/stellar-core?surface=shell" style="border:0;width:100%;height:820px"></iframe></body></html>` }));
  await page.goto(`${origin}/frame-test`);
  if (phase === 'after') await page.frameLocator('iframe').locator('#spacemountain-root').waitFor({ state: 'attached', timeout: 15000 });
  else await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${out}/${phase}.png`, fullPage: true });
  for (const path of ['/?surface=shell', '/apps/stellar-core?surface=shell', '/apps/mission-control?surface=shell', '/apps/streamweaver?surface=shell', '/apps/hearmeout?surface=shell', '/apps/discord-stream-hub?surface=shell', '/']) {
    const r = await fetch(origin + path);
    results.push({ path, status: r.status, finalUrl: new URL(r.url).pathname + new URL(r.url).search });
  }
  else assert.ok(blocked.length, 'Baseline should reproduce browser frame denial');
  await writeFile(`${out}/${phase}.json`, JSON.stringify({ phase, results, frameErrors: blocked, otherConsoleErrors: errors.filter(e => !blocked.includes(e)) }, null, 2));
  console.log(JSON.stringify({ phase, frameErrors: blocked, screenshot: `${out}/${phase}.png`, checks: results.length }));
} finally { await browser.close(); await host.close(); }