import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { isAllowedHearMeOutYoutubeMediaUrl } from "./watch-hls-policy.js";

export const HEARMEOUT_YOUTUBE_INFO_TTL_MS = 5 * 60 * 60 * 1000;
export const HEARMEOUT_YOUTUBE_COOKIE_PATH = "/data/youtube-cookies.txt";
export const HEARMEOUT_DIRECT_VOD_CHUNK_BYTES = 8 * 1024 * 1024;
export type HearMeOutYoutubeResolverStageV1 = "cache"|"yt-dlp"|"yt-dlp-anonymous"|"upstream"|"youtubei"|"browser-resolved"|"chromium";
export interface HearMeOutResolvedYoutubeV1 { videoId:string; videoUrl:string; audioUrl:string; title?:string; durationMs?:number; stage:HearMeOutYoutubeResolverStageV1; resolvedAt:string }
export interface HearMeOutYoutubeResolverAdapterV1 {
  cache?(videoId:string):Promise<HearMeOutResolvedYoutubeV1|null>;
  ytDlp?(videoId:string,input:{useCookies:boolean}):Promise<HearMeOutResolvedYoutubeV1|null>;
  upstream?(videoId:string):Promise<HearMeOutResolvedYoutubeV1|null>;
  youtubei?(videoId:string):Promise<HearMeOutResolvedYoutubeV1|null>;
  browserResolved?(videoId:string):Promise<HearMeOutResolvedYoutubeV1|null>;
  chromium?(videoId:string):Promise<HearMeOutResolvedYoutubeV1|null>;
}
export interface HearMeOutYoutubeResolveAttemptV1 { stage:HearMeOutYoutubeResolverStageV1; outcome:"hit"|"miss"|"error"; message?:string }

export class HearMeOutYoutubeResolverCoordinator {
  constructor(private readonly adapter:HearMeOutYoutubeResolverAdapterV1,private readonly options:{now?:()=>string;cookiesAvailable?:()=>boolean}={}){}
  async resolve(videoIdValue:string){
    const videoId=cleanVideoId(videoIdValue),attempts:HearMeOutYoutubeResolveAttemptV1[]=[];
    const cached=await this.tryStage("cache",()=>this.adapter.cache?.(videoId)??Promise.resolve(null),attempts);if(cached)return{result:cached,attempts};
    const cookies=this.options.cookiesAvailable?.()??false;
    const primary=await this.tryStage("yt-dlp",()=>this.adapter.ytDlp?.(videoId,{useCookies:cookies})??Promise.resolve(null),attempts);if(primary)return{result:primary,attempts};
    if(cookies){const anonymous=await this.tryStage("yt-dlp-anonymous",()=>this.adapter.ytDlp?.(videoId,{useCookies:false})??Promise.resolve(null),attempts);if(anonymous)return{result:{...anonymous,stage:"yt-dlp-anonymous" as const},attempts};}
    const upstream=await this.tryStage("upstream",()=>this.adapter.upstream?.(videoId)??Promise.resolve(null),attempts);if(upstream)return{result:upstream,attempts};
    const youtubei=await this.tryStage("youtubei",()=>this.adapter.youtubei?.(videoId)??Promise.resolve(null),attempts);if(youtubei)return{result:youtubei,attempts};
    const browser=await this.tryStage("browser-resolved",()=>this.adapter.browserResolved?.(videoId)??Promise.resolve(null),attempts);if(browser)return{result:browser,attempts};
    const chromium=await this.tryStage("chromium",()=>this.adapter.chromium?.(videoId)??Promise.resolve(null),attempts);if(chromium)return{result:chromium,attempts};
    return{result:null,attempts};
  }
  private async tryStage(stage:HearMeOutYoutubeResolverStageV1,run:()=>Promise<HearMeOutResolvedYoutubeV1|null>,attempts:HearMeOutYoutubeResolveAttemptV1[]){try{const value=await run();if(!value){attempts.push({stage,outcome:"miss"});return null;}const normalized=normalizeHearMeOutResolvedYoutube({...value,stage},this.options.now?.()??new Date().toISOString());attempts.push({stage,outcome:"hit"});return normalized;}catch(error){attempts.push({stage,outcome:"error",message:safeError(error)});return null;}}
}

export function normalizeHearMeOutResolvedYoutube(input:Partial<HearMeOutResolvedYoutubeV1>&{videoId:string;videoUrl:string;audioUrl:string},now=new Date().toISOString()):HearMeOutResolvedYoutubeV1{
  const videoId=cleanVideoId(input.videoId),videoUrl=allowedMediaUrl(input.videoUrl,"videoUrl"),audioUrl=allowedMediaUrl(input.audioUrl,"audioUrl"),durationMs=input.durationMs===undefined?undefined:Math.max(0,Math.min(24*60*60*1000,Math.trunc(Number(input.durationMs)||0))),stage=input.stage??"browser-resolved";return{videoId,videoUrl,audioUrl,...(input.title?{title:String(input.title).trim().slice(0,300)}:{}),...(durationMs!==undefined?{durationMs}:{}),stage,resolvedAt:timestamp(input.resolvedAt??now)};
}
export function acceptHearMeOutBrowserResolvedStream(input:{videoId:string;videoUrl:string;audioUrl:string;title?:string;durationMs?:number},now=new Date().toISOString()){return normalizeHearMeOutResolvedYoutube({...input,stage:"browser-resolved",resolvedAt:now},now);}
export function writeHearMeOutYoutubeCookiesBase64(base64Value:string,path=HEARMEOUT_YOUTUBE_COOKIE_PATH){const clean=String(base64Value??"").trim();if(!clean)throw new Error("YouTube cookies are empty");let decoded:Buffer;try{decoded=Buffer.from(clean,"base64");}catch{throw new Error("YouTube cookies are invalid base64");}if(!decoded.length||decoded.length>2*1024*1024)throw new Error("YouTube cookies are invalid");const text=decoded.toString("utf8");if(!/\t/.test(text)&&!/cookie/i.test(text))throw new Error("YouTube cookies do not look like a cookie file");mkdirSync(dirname(path),{recursive:true});writeFileSync(path,decoded,{mode:0o600});return{path,bytes:decoded.length,mode:0o600};}
export function parseHearMeOutByteRange(rangeHeader:string|undefined,totalBytes:number,chunkBytes=HEARMEOUT_DIRECT_VOD_CHUNK_BYTES){const total=Math.max(0,Math.trunc(totalBytes));if(total<=0)throw new Error("Media size is invalid");if(!rangeHeader){const end=Math.min(total-1,chunkBytes-1);return{start:0,end,length:end+1,status:206 as const,contentRange:`bytes 0-${end}/${total}`};}const match=/^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());if(!match)throw new Error("Invalid byte range");let start=match[1]?Number(match[1]):NaN,end=match[2]?Number(match[2]):NaN;if(!Number.isFinite(start)&&Number.isFinite(end)){const suffix=Math.max(1,Math.trunc(end));start=Math.max(0,total-suffix);end=total-1;}else{start=Math.max(0,Math.trunc(start));end=Number.isFinite(end)?Math.min(total-1,Math.trunc(end)):Math.min(total-1,start+chunkBytes-1);}if(!Number.isFinite(start)||start<0||start>=total||end<start)throw new Error("Unsatisfiable byte range");return{start,end,length:end-start+1,status:206 as const,contentRange:`bytes ${start}-${end}/${total}`};}
export function isHearMeOutYoutubeInfoFresh(resolvedAt:string,nowMs=Date.now()){const at=Date.parse(resolvedAt);return Number.isFinite(at)&&nowMs-at>=0&&nowMs-at<HEARMEOUT_YOUTUBE_INFO_TTL_MS;}
function cleanVideoId(value:string){const clean=String(value??"").trim();if(!/^[A-Za-z0-9_-]{11}$/.test(clean))throw new Error("Invalid YouTube video id");return clean;}
function allowedMediaUrl(value:string,name:string){if(!isAllowedHearMeOutYoutubeMediaUrl(value))throw new Error(`${name} host is not allowed`);return new URL(value).toString();}
function timestamp(value:string){const parsed=Date.parse(value);if(!Number.isFinite(parsed))throw new Error("Resolved timestamp is invalid");return new Date(parsed).toISOString();}
function safeError(error:unknown){return(error instanceof Error?error.message:String(error??"resolver failed")).replace(/((?:token|authorization|secret|password|cookie))\s*[:=]\s*\S+/gi,"$1=[redacted]").slice(0,240);}
