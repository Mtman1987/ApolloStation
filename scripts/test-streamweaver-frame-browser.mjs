import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createStreamWeaverWebServer } from '../apps/streamweaver/dist/web-server.js';
import { createIntegratedSpaceMountainWebHost } from '../apps/spacemountain-web/dist/integrated-server.js';
import { SpaceMountainShellUi } from '../apps/spacemountain/dist/shell-ui-base.js';

const phase=process.argv[2]??'after',out='/home/user/streamweaver-frame-proof';
await mkdir(out,{recursive:true});
const app=createStreamWeaverWebServer({spmtOrigin:'http://127.0.0.1:1',host:'127.0.0.1',port:0});
await app.listen();
const appOrigin=`http://127.0.0.1:${app.server.address().port}`;
const shell=createIntegratedSpaceMountainWebHost({spmtOrigin:'http://127.0.0.1:1',greenAppOrigins:{streamweaver:appOrigin},host:'127.0.0.1',port:0});
await shell.listen();
const origin=`http://127.0.0.1:${shell.server.address().port}`;
globalThis.window={location:{origin}};
const launch=SpaceMountainShellUi.prototype.shellLaunchUrl.call({}, {appId:'streamweaver',launchUrl:appOrigin+'/?view=integrations#integrations'});
delete globalThis.window;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:430,height:932}}),errors=[];
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.route(origin+'/frame-test',r=>r.fulfill({contentType:'text/html; charset=utf-8',headers:{'content-security-policy':"frame-src 'self'"},body:`<html><body style="margin:0;background:#101827;color:white;font:16px system-ui"><header style="padding:12px">StreamWeaver real app frame - ${phase}<br><small>Local test; no account credentials supplied</small></header><iframe src="${launch}" title="StreamWeaver" style="width:100%;height:830px;border:0"></iframe></body></html>`}));
 await page.goto(origin+'/frame-test');
 if(phase==='after') {
  assert.equal(new URL(launch).origin,origin);assert.equal(new URL(launch).pathname,'/apps/streamweaver');
  assert.equal(new URL(launch).searchParams.get('view'),'integrations');
  await page.frameLocator('iframe').getByText('StreamWeaver',{exact:true}).first().waitFor({timeout:15000});
 } else await page.waitForLoadState('networkidle');
 await page.screenshot({path:out+'/'+phase+'.png',fullPage:true});
 const r=await fetch(origin+'/apps/streamweaver?surface=shell',{redirect:'manual'});
 assert.equal(r.status,phase==='after'?200:302);
 await writeFile(out+'/'+phase+'.json',JSON.stringify({phase,launch,statusWithoutCookie:r.status,frameErrors:blocked,otherErrors:errors.filter(e=>!blocked.includes(e))},null,2));
 console.log(JSON.stringify({phase,launch,statusWithoutCookie:r.status,frameErrors:blocked}));
} finally {await browser.close();await shell.close();await app.close()}