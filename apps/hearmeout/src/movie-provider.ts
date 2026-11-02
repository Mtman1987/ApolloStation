import type {HearMeOutMediaItemV1} from './room-media-core.js';
import {searchXtreamCatalogRanked} from './xtream-provider.js';
import {xtreamHlsUrl} from './xtream-hls.js';

export interface HearMeOutMovieMatch {itemId:string;title:string;year?:number;overview:string;quality?:string;}

/** Apollo-owned IPTV catalog adapter. Provider credentials remain in Apollo's worker environment. */
export class HearMeOutMovieProvider {
  constructor(_legacyOrigin?:string,_legacyFetch?:typeof fetch,_legacyAuthorization=''){}
  async search(query:string):Promise<HearMeOutMovieMatch[]>{
    if(typeof query!=='string'||query.trim().length<2||query.length>300)throw Error('Enter at least two characters for the movie search');
    const matches=await searchXtreamCatalogRanked(query.trim());
    return matches.filter(({item})=>item.id.startsWith('xtream-vod-')).slice(0,24).map(({item})=>({
      itemId:item.id,title:item.title,overview:item.overview,
      ...(Number.isSafeInteger(item.year)&&item.year>0?{year:item.year}:{}),
      ...(item.metadata?.quality?{quality:item.metadata.quality}:{})
    }));
  }
  async resolve(query:string,itemId:string):Promise<HearMeOutMediaItemV1>{
    const match=(await this.search(query)).find(item=>item.itemId===itemId);
    if(!match)throw Error('That movie is no longer in the search results. Search again and choose a title.');
    const catalogItem=(await searchXtreamCatalogRanked(query)).find(({item})=>item.id===match.itemId)?.item;
    if(!catalogItem||!catalogItem.playbackUrl)throw Error('That movie no longer has a playable Apollo provider route');
    const playbackUrl=xtreamHlsUrl(catalogItem.playbackUrl);
    if(!playbackUrl.startsWith('/api/watch/xtream/hls/vod-'))throw Error('Invalid Apollo IPTV playback route');
    return {itemId:match.itemId,title:match.title,type:'movie',source:'iptv',playbackUrl};
  }
}
