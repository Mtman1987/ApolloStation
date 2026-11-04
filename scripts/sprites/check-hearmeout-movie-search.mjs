import {hearMeOutCutoverEnvironment} from './hearmeout-cutover-config.mjs';
import {HearMeOutMovieProvider} from '../../apps/hearmeout/dist/movie-provider.js';

// A fixed title checks only the existing search endpoint. No selection, queue
// request or media preparation occurs. Catalog entries never enter release logs.
let result={iptvSearchEndpoint:false,errorCode:'configuration'};
try{
  const env=await hearMeOutCutoverEnvironment('/home/sprite/data/release');
  if(!env.HEARMEOUT_MOVIE_PROVIDER_ORIGIN)throw Error('Movie provider is not configured');
  process.env.HEARMEOUT_MOVIE_PROVIDER_ORIGIN=env.HEARMEOUT_MOVIE_PROVIDER_ORIGIN;
  await import('../offline-network-guard.mjs');
  await new HearMeOutMovieProvider(env.HEARMEOUT_MOVIE_PROVIDER_ORIGIN,fetch,env.HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION).search('Big Buck Bunny');
  result={iptvSearchEndpoint:true};
}catch(error){
  result.errorCode=/HTTP \d{3}/.exec(String(error?.message))?.[0]??'request-failed';
}
console.log(JSON.stringify(result));
