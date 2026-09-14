import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {HEARMEOUT_TEST_SOURCE} from './hearmeout-test-source.mjs';

// Remove only the sample seeded by PR #107. A viewer selecting even the same
// URL has a different request key and must keep playing across this deployment.
const operationId='deployment-single-video:a1cbc44f0fa7e5b22c89deae8f42424f5eb5947e';
export function retireHearMeOutDeploymentSample(path) {
  const db=new DatabaseSync(path,{timeout:5000});
  try {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='hmo_program'").get())return {removed:0};
    db.exec('BEGIN IMMEDIATE');
    const ids=new Set();
    for(const row of db.prepare('SELECT id,intent,request_id FROM hmo_program_requests').all()){
      const [requester,query]=JSON.parse(row.intent);
      const expected=createHash('sha256').update(JSON.stringify([requester,operationId])).digest('hex');
      if(query===HEARMEOUT_TEST_SOURCE&&row.id===expected&&row.request_id==='broadcast-request:'+expected)ids.add(row.request_id);
    }
    const row=db.prepare("SELECT body FROM hmo_program WHERE id='main-broadcast'").get();
    let removed=0;
    if(row){
      const session=JSON.parse(row.body),prior=session.queue.length;
      session.queue=session.queue.filter(entry=>!ids.has(entry.requestId));removed+=prior-session.queue.length;
      if(session.current&&ids.has(session.current.requestId)){
        removed++;session.current=session.queue.shift()??null;
        session.playback={...session.playback,status:session.current?'playing':'idle',position:0,updatedAt:new Date().toISOString()};
      }
      if(removed){session.revision++;db.prepare("UPDATE hmo_program SET body=? WHERE id='main-broadcast'").run(JSON.stringify(session));}
    }
    db.exec('COMMIT');return {removed};
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.env.DEPLOY_ROLE!=='release')throw Error('Sample removal requires the approved release target');
  console.log('HearMeOut deployment sample cleanup',retireHearMeOutDeploymentSample('/home/sprite/data/release/hearmeout-room-owner-canary.sqlite'));
}
