import {hearMeOutCutoverEnvironment} from './hearmeout-cutover-config.mjs';
import {HearMeOutPreparedMedia,preparedHearMeOutEnvironment,HearMeOutPreparedMediaError} from '../../apps/hearmeout/dist/prepared-media.js';

// Probe a fixed public Blender film through the already configured media
// adapter. This does not request a video in the broadcast or control live rooms.
// Only predefined status categories leave the Sprite, never provider bodies,
// source URLs, owner records, configuration values or credentials.
let result={preparedMediaFixture:'aqz-KE-bpKQ',ready:false,errorCode:'configuration'};
try{
  const env=await hearMeOutCutoverEnvironment('/home/sprite/data/release');
  const options=preparedHearMeOutEnvironment(env);
  if(!options)throw Error('Prepared media is not configured');
  process.env.HEARMEOUT_PREPARED_MEDIA_ENABLED='1';
  process.env.HEARMEOUT_VOICE_BRIDGE_ORIGIN=options.origin;
  await import('../offline-network-guard.mjs');
  await new HearMeOutPreparedMedia(options).upstream('aqz-KE-bpKQ');
  result={preparedMediaFixture:'aqz-KE-bpKQ',ready:true};
}catch(error){
  result.errorCode=error instanceof HearMeOutPreparedMediaError?error.code:/blocked|offline network/i.test(String(error?.message))?'network-policy':'request-failed';
  if(error instanceof HearMeOutPreparedMediaError)result.httpStatus=error.httpStatus;
}
console.log(JSON.stringify(result));
