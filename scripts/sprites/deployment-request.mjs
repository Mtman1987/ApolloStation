export function isTransientDeploymentError(error){
 return error instanceof TypeError||error?.name==='TimeoutError'||error?.name==='AbortError'||error?.code==='ABORT_ERR';
}

/** Retry only idempotent deployment reads. Writes must never be replayed here. */
export async function deploymentRequest(origin,path,init={},options={}){
 const fetchImpl=options.fetchImpl??fetch,attempts=options.attempts??3,timeoutMs=options.timeoutMs??15000,sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 const method=String(init.method??'GET').toUpperCase(),canRetry=method==='GET'||method==='HEAD';
 for(let attempt=0;;attempt++){
  try{return await fetchImpl(origin+path,{redirect:'manual',signal:AbortSignal.timeout(timeoutMs),...init});}
  catch(error){if(!canRetry||attempt>=attempts-1||!isTransientDeploymentError(error))throw error;await sleep(Math.min(4000,1000*2**attempt));}
 }
}
