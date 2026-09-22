import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { DshLoungeProgramScheduler, dshLoungeBroadcastClock, DSH_LOUNGE_RECOMMENDED_RESTART_HOURS } from '../apps/discord-stream-hub/dist/lounge-program.js';
import {DshLoungeOverlayWeb} from '../apps/discord-stream-hub/dist/lounge-overlay.js';

const base={schemaVersion:1,tenantId:'tenant',channel:{providerUserId:'system:spacemountainlive',twitchLogin:'spacemountainlive',displayName:'SpaceMountainLive'},mode:'lounge',headline:'Community Lounge',features:[{id:'live',kind:'creator',title:'Live Now',detail:'Creator is live'},{id:'event',kind:'event',title:'Event',detail:'Tonight'},{id:'game',kind:'nebula',title:'Nebula',detail:'Play now'}],raidReturnPending:false,pileIds:[],updatedAt:'2026-09-17T00:00:00.000Z'};

test('Lounge clock defaults below Restream 24 hour maintenance recommendation',()=>{
 const clock=dshLoungeBroadcastClock('2026-09-17T00:00:00.000Z','2026-09-17T23:40:00.000Z');
 assert.equal(clock.targetHours,DSH_LOUNGE_RECOMMENDED_RESTART_HOURS);assert.equal(clock.warning,true);assert.equal(clock.due,false);
 assert.equal(dshLoungeBroadcastClock('2026-09-17T00:00:00.000Z','2026-09-17T23:46:00.000Z').due,true);
});

test('Raid and maintenance states override the ordinary Lounge rotation',()=>{
 const scheduler=new DshLoungeProgramScheduler();
 const normal=scheduler.select(base,'2026-09-17T01:00:00.000Z');assert.equal(normal.priority,'normal');
 const raid=scheduler.select({...base,mode:'raid-pile',headline:'Raid Pile incoming'},'2026-09-17T01:00:00.000Z');assert.equal(raid.priority,'raid');assert.equal(raid.mode,'raid-pile');
 const clock=dshLoungeBroadcastClock('2026-09-16T00:00:00.000Z','2026-09-17T01:00:00.000Z');
 const maintenance=scheduler.select(base,'2026-09-17T01:00:00.000Z',clock);assert.equal(maintenance.priority,'maintenance');assert.equal(maintenance.mode,'maintenance');
});


test('Lounge main panel embeds the permanent Spotlight Media source instead of rotating URLs',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-lounge-overlay-')),overlay=new DshLoungeOverlayWeb(join(dir,'state.sqlite')),server=createServer((req,res)=>{const url=new URL(req.url,'http://local');if(!overlay.handle(req,res,url)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{overlay.close();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+server.address().port,response=await fetch(base+'/apps/discord-stream-hub/overlay/lounge?tenant=tenant'),html=await response.text();
 assert.equal(response.status,200);assert.match(html,/src="\/spotlight-media\/player"/);assert.match(html,/class="spotlight-media"/);assert.doesNotMatch(html,/system-spacemountainlive-lounge&amp;roomId|streamweaver-new\.fly\.dev|spotlight-lab\/player/);
});
