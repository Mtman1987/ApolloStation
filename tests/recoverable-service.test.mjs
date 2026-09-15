import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startRecoverableService} from '../scripts/sprites/recoverable-service.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(read, check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const value = await read(); if (check(value)) return value; await delay(25); }
  assert.fail('Service did not reach the expected lifecycle state');
}

test('a media crash restarts only its service and removes orphan encoders before replacement', {skip:process.platform !== 'linux',timeout:15000}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hmo-service-'));
  const records = join(root, 'starts.jsonl');
  const events = [];
  const script = `
    const {spawn}=require('node:child_process'),{appendFileSync}=require('node:fs');
    const encoder=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    appendFileSync(process.argv[1],JSON.stringify({pid:process.pid,encoder:encoder.pid})+'\\n');
    setInterval(()=>{},1000);
  `;
  const service = startRecoverableService({label:'media',command:process.execPath,args:['-e',script,records],env:process.env,restartDelayMs:100,maximumDelayMs:200,report:line=>events.push(line)});
  const sibling = startRecoverableService({label:'shell',command:process.execPath,args:['-e','setInterval(()=>{},1000)'],env:process.env,report:line=>events.push(line)});
  const readStarts = async () => {try{return (await readFile(records,'utf8')).trim().split('\n').map(JSON.parse)}catch{return []}};
  try {
    const [first] = await waitFor(readStarts, rows=>rows.length===1);
    const siblingPid = sibling.current.pid;
    process.kill(first.pid,'SIGKILL');
    const rows = await waitFor(readStarts, rows=>rows.length===2);
    assert.notEqual(rows[1].pid,first.pid);
    assert.equal(sibling.current.pid,siblingPid,'The shell must survive the media crash');
    await waitFor(async()=>{try{return (await readFile(`/proc/${first.encoder}/stat`,'utf8')).split(' ')[2]}catch{return 'gone'}},state=>state==='gone'||state==='Z');
    assert.match(events[0],/SIGKILL.*restarting/);
    await service.close();
    await delay(300);
    assert.equal((await readStarts()).length,2,'Shutdown must cancel automatic restart');
    assert.equal(sibling.current.pid,siblingPid);
  } finally { await Promise.all([service.close(),sibling.close()]); await rm(root,{recursive:true,force:true}); }
});

test('spawn failures use bounded backoff and shutdown cancels pending retries', {timeout:5000}, async () => {
  const events=[];
  const service=startRecoverableService({label:'media',command:'/missing-hmo-binary',args:[],restartDelayMs:20,maximumDelayMs:40,report:line=>events.push(line)});
  try {
    await waitFor(()=>events,rows=>rows.length>=3);
    assert.match(events[0],/ENOENT.*20ms/);
    assert.match(events[1],/ENOENT.*40ms/);
    assert.match(events[2],/ENOENT.*40ms/);
    await service.close();const count=events.length;await delay(100);assert.equal(events.length,count);
  } finally {await service.close();}
});
