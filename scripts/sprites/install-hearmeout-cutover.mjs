import { privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect } from 'node:net';
import { migrateHearMeOutPersistentRoom } from '../../apps/hearmeout/dist/persistent-migration.js';

// Run only after the owner approves the production-data/configuration transfer.
// Nothing imports this module from the release launcher or deployment workflow.
export async function installHearMeOutCutover(capsulePath, dataRoot='/home/sprite/data/release') {
  const root=realpathSync(dataRoot);
  const capsule=JSON.parse(readFileSync(capsulePath,'utf8'));
  if(capsule.schemaVersion!==1)throw Error('Unsupported migration capsule');
  const key=privateDecrypt({key:readFileSync(resolve(root,'hmo-transfer-private.pem')),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(capsule.wrappedKey,'base64'));
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(capsule.iv,'base64'));
  decipher.setAuthTag(Buffer.from(capsule.tag,'base64'));
  const payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(capsule.ciphertext,'base64')),decipher.final()]).toString());
  if(payload.schemaVersion!==1||!Number.isFinite(Date.parse(payload.createdAt))||Math.abs(Date.now()-Date.parse(payload.createdAt))>24*60*60*1000)throw Error('A fresh verified migration capsule is required');
  const {bundle,configuration,recovery}=payload;
  if(bundle.integrity!=='ok'||bundle.sourceDatabaseSha256!==recovery.sha256||configuration.workerOrigin!=='https://hmo-dj-worker.fly.dev'||!/^Bearer [^\r\n]{16,}$/.test(configuration.workerAuthorization)||!/^wss:\/\/[^/]+\/?$/.test(configuration.livekitUrl)||!configuration.livekitApiKey||!configuration.livekitApiSecret)throw Error('Migration capsule failed source/configuration verification');
  const identity=new DatabaseSync(resolve(root,'spmt-empty-catalog-sandbox.sqlite'),{readOnly:true});
  let principal;
  try {
    const rows=identity.prepare('SELECT user_id,body FROM user_profiles WHERE username=?').all('mtman1987');
    if(rows.length!==1)throw Error('Expected one existing owner profile');
    const profile=JSON.parse(rows[0].body),userId=rows[0].user_id;
    if(profile.userId!==userId||profile.username!=='mtman1987')throw Error('Owner profile mismatch');
    const tenants=identity.prepare("SELECT id FROM tenants WHERE owner_user_id=? AND status='active'").all(userId).filter(t=>profile.tenantIds?.includes(t.id));
    if(tenants.length!==1)throw Error('Expected one existing owner workspace');
    principal={tenantId:tenants[0].id,userId,displayName:profile.displayName||'MT',roles:['admin']};
  } finally { identity.close(); }
  await requireStoppedRoomServer();
  const receipt=await migrateHearMeOutPersistentRoom({sourcePath:resolve(root,'hearmeout-room-sandbox.sqlite'),targetPath:resolve(root,'hearmeout-room-owner-canary.sqlite'),recoveryPath:resolve(root,'recovery','hearmeout-before-cutover.sqlite'),sourceDatabaseSha256:bundle.sourceDatabaseSha256,activityRoom:bundle.activityRoom,principal});
  const config={schemaVersion:1,...configuration,tenantId:principal.tenantId,sourceDatabaseSha256:bundle.sourceDatabaseSha256};
  const staged=resolve(root,'hearmeout-cutover.json.next');
  writeFileSync(staged,JSON.stringify(config),{mode:0o600,flag:'wx'});
  renameSync(staged,resolve(root,'hearmeout-cutover.json'));
  writeFileSync(resolve(root,'recovery','hearmeout-cutover-receipt.json'),JSON.stringify({...receipt,blueRecovery:recovery,reconciliation:bundle.reconciliation,legacyConfigExcluded:true},null,2),{mode:0o600});
  return {ok:true,beforeRooms:receipt.beforeRooms,afterRooms:receipt.afterRooms,importedQueueItems:receipt.importedQueueItems,playbackState:receipt.playbackState,voiceBridgeEnabled:false,restartRequired:true};
}

async function requireStoppedRoomServer() {
  await new Promise((resolve, reject) => {
    const socket=connect({host:'127.0.0.1',port:3200});
    socket.once('connect',()=>{socket.destroy();reject(Error('Stop the supervised HearMeOut server before taking the final migration snapshot'));});
    socket.once('error',error=>{socket.destroy();if(error.code==='ECONNREFUSED')resolve();else reject(Error('Cannot verify that the HearMeOut writer is stopped'));});
    socket.setTimeout(2000,()=>{socket.destroy();reject(Error('Cannot verify that the HearMeOut writer is stopped'));});
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try { if(!process.argv[2])throw Error('Usage: node scripts/sprites/install-hearmeout-cutover.mjs <approved-encrypted-capsule.json>');console.log(JSON.stringify(await installHearMeOutCutover(process.argv[2]))); }
  catch(error){console.error(String(error.message||error).replace(/(?:Bearer|FlyV1)\s+\S+/g,'[REDACTED]'));process.exitCode=1;}
}
