import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('controlled bridge permits only persona POST endpoints without breaking loopback sockets',()=>{
 const script=`import assert from 'node:assert/strict';import net from 'node:net';
 globalThis.fetch=async()=>({ok:true});
 await import('./scripts/offline-network-guard.mjs');
 for(const path of ['/persona','/persona/speak','/voice-bridge'])assert.equal((await fetch('https://hmo-dj-worker.fly.dev'+path,{method:'POST'})).ok,true);
 for(const [url,method] of [['https://hmo-dj-worker.fly.dev/persona','GET'],['https://hmo-dj-worker.fly.dev/persona/delete','POST'],['https://other.example/persona','POST'],['https://hmo-dj-worker.fly.dev/provider-secret','POST']])assert.throws(()=>fetch(url,{method}),/OFFLINE_NETWORK_BLOCKED/);
 assert.throws(()=>net.connect({host:'other.example',port:80}),/OFFLINE_NETWORK_BLOCKED/);
 const server=net.createServer(s=>s.end());await new Promise(r=>server.listen(0,'127.0.0.1',r));await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port:server.address().port},()=>{socket.destroy();resolve()});socket.on('error',reject)});await new Promise(r=>server.close(r));`;
 assert.doesNotThrow(()=>execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,HEARMEOUT_CONTROLLED_BRIDGE:'1',HEARMEOUT_VOICE_BRIDGE_ORIGIN:'https://hmo-dj-worker.fly.dev'},timeout:10000,stdio:'pipe'}));
});
