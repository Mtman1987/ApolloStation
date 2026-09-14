import type {HearMeOutMediaItemV1} from './room-media-core.js';

export const HEARMEOUT_MOVIE_PROVIDER_ORIGIN='https://hearmeout-main.fly.dev';
export interface HearMeOutMovieMatch {itemId:string;title:string;year?:number;overview:string;quality?:string;}

// Reuse the live application's configured IPTV account. Its existing routes
// retain provider credentials and prepare HLS; Apollo owns selection and playout.
export function hearMeOutMovieProviderUrl(value:string|URL,origin=HEARMEOUT_MOVIE_PROVIDER_ORIGIN){
  let url:URL;try{url=new URL(value);}catch{return undefined;}
  if(url.origin!==origin||url.username||url.password||url.hash)return undefined;
  if(url.pathname==='/api/watch/search')return [...url.searchParams].length===1&&url.searchParams.has('q')?url:undefined;
  if(!/^\/api\/watch\/xtream\/hls\/vod-\d+\/[A-Za-z0-9_-]+\.(?:m3u8|ts)$/.test(url.pathname))return undefined;
  if([...url.searchParams].some(([key,value])=>key!=='machine'||!/^[A-Za-z0-9]{1,64}$/.test(value))||[...url.searchParams].length>1)return undefined;
  return url;
}

export class HearMeOutMovieProvider {
  constructor(private readonly origin=HEARMEOUT_MOVIE_PROVIDER_ORIGIN,private readonly fetchImpl:typeof fetch=fetch){}
  async search(query:string):Promise<HearMeOutMovieMatch[]>{
    if(typeof query!=='string'||query.trim().length<2||query.length>300)throw Error('Enter at least two characters for the movie search');
    const url=new URL('/api/watch/search',this.origin);url.searchParams.set('q',query.trim());
    const response=await this.read(url,30000);
    if(!response.ok)throw Error(`The IPTV movie search returned HTTP ${response.status}`);
    const body=JSON.parse(await boundedText(response)) as {results?:Array<Record<string,unknown>>};
    if(!Array.isArray(body.results))throw Error('The IPTV movie search returned an invalid result');
    return body.results.filter(item=>item&&/^xtream-vod-\d+$/.test(String(item.id))).slice(0,24).map(item=>({itemId:String(item.id),title:String(item.title||'Untitled movie').slice(0,300),overview:String(item.overview||'').slice(0,700),...(Number.isSafeInteger(item.year)?{year:Number(item.year)}:{}),...(typeof item.quality==='string'?{quality:item.quality.slice(0,50)}:{})}));
  }
  async resolve(query:string,itemId:string):Promise<HearMeOutMediaItemV1>{
    const match=(await this.search(query)).find(item=>item.itemId===itemId);
    if(!match)throw Error('That movie is no longer in the search results. Search again and choose a title.');
    const url=new URL(`/api/watch/xtream/hls/${itemId.replace(/^xtream-/,'')}/index.m3u8`,this.origin);
    for(let attempt=0;attempt<2;attempt++){
      const response=await this.read(url,60000);
      if(response.status===202){await response.body?.cancel();continue;}
      if(!response.ok){await response.body?.cancel();throw Error(`The IPTV provider could not prepare that movie (HTTP ${response.status})`);}
      const manifest=await boundedText(response);
      if(!manifest.startsWith('#EXTM3U'))throw Error('The IPTV provider did not return playable movie media');
      return {itemId:match.itemId,title:match.title,type:'movie',source:'iptv',playbackUrl:url.href};
    }
    throw Error('The IPTV provider is still preparing that movie. Retry your selection.');
  }
  private read(url:URL,timeout:number){
    if(!hearMeOutMovieProviderUrl(url,this.origin))throw Error('Invalid IPTV provider route');
    return this.fetchImpl(url,{method:'GET',redirect:'manual',headers:{accept:'application/json, application/vnd.apple.mpegurl','user-agent':'HearMeOut/1.0'},signal:AbortSignal.timeout(timeout)});
  }
}
async function boundedText(response:Response){
  if(!response.body)throw Error('The IPTV provider returned an empty response');
  const chunks:Uint8Array[]=[];let size=0;
  for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.byteLength;if(size>1024*1024)throw Error('The IPTV provider response is too large');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}
