// Read-only catalog probe. Searches the same API used by the movie picker.
// Usage: node scripts/search-hearmeout-movies.mjs "Batman" [Apollo origin]
const query=process.argv[2]||'Batman';
const origin=new URL(process.argv[3]||'https://web-terminal-bvesa.sprites.app').origin;
const endpoint=new URL('/api/watch/broadcast/movies',origin);
endpoint.searchParams.set('q',query);
const started=Date.now();
try{
  const response=await fetch(endpoint,{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(150000)});
  const isJson=/application\/(?:[\w.+-]+\+)?json/i.test(response.headers.get('content-type')||'');
  const body=isJson?await response.json():null;
  if(!response.ok||!body)throw Error(`HTTP ${response.status}: ${body?.error||body?.message||'The endpoint did not return JSON'}`);
  if(!Array.isArray(body.items))throw Error('Movie search returned no items array');
  const matches=body.items.map(item=>({id:item.itemId,title:item.title,year:item.year??null,quality:item.quality??null,overview:item.overview??''}));
  console.log(JSON.stringify({query,httpStatus:response.status,elapsedMs:Date.now()-started,count:matches.length,matches},null,2));
}catch(error){
  console.error(JSON.stringify({query,elapsedMs:Date.now()-started,error:error.message}));
  process.exitCode=1;
}
