import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";

export const HEARMEOUT_WATCH_HLS_SEGMENT_SECONDS: number = 6;
export const HEARMEOUT_WATCH_HLS_LIST_SIZE: number = 90;
export const HEARMEOUT_WATCH_HLS_DELETE_THRESHOLD: number = 12;
export const HEARMEOUT_WATCH_HLS_BUDGET_BYTES: number = 1_536 * 1024 * 1024;
export const HEARMEOUT_WATCH_HLS_FAILURE_TTL_MS: number = 2 * 60 * 1000;
export const HEARMEOUT_WATCH_HLS_INDEX_WAIT_MS: number = 45_000;
export const HEARMEOUT_WATCH_HLS_FILE_WAIT_MS: number = 10_000;
export const HEARMEOUT_WATCH_PROXY_MAX_WAIT_MS: number = 55_000;
export const HEARMEOUT_WATCH_PROXY_POLL_MS: number = 2_500;

export interface HearMeOutWatchAudioTrackV1 { sourceIndex:number; sourceSpecifier?:string; language?:string; title?:string; index:number }
export interface HearMeOutWatchMediaProbeV1 { hasVideo:boolean; audio:HearMeOutWatchAudioTrackV1[] }
export interface HearMeOutWatchHlsEntryV1 { streamId:string; bytes:number; files:number; ready:boolean; active:boolean; updatedAt:string|null }
export interface HearMeOutWatchHlsSnapshotV1 { root:"worker-managed"; bytes:number; budgetBytes:number; segmentSeconds:number; playlistWindow:string; entries:HearMeOutWatchHlsEntryV1[] }
export interface HearMeOutWatchHlsPruneResultV1 { bytes:number; removed:Array<{streamId:string;bytes:number}> }
export interface HearMeOutWatchHlsFfmpegOptionsV1 { segmentSeconds?:number; listSize?:number; deleteThreshold?:number }

export function cleanHearMeOutWatchStreamId(value:unknown):string{
  const raw=String(value??"").trim();
  const youtube=raw.match(/^yt-([A-Za-z0-9_-]{11})$/)??raw.match(/^youtube-([A-Za-z0-9_-]{11})$/);
  if(youtube)return `yt-${youtube[1]}`;
  const typed=raw.toLowerCase().match(/^(vod|series|live)-(\d+)$/)??raw.toLowerCase().match(/^(episode)-(\d+)-([a-z0-9]+)$/);
  if(typed)return `${typed[1]}-${typed[2]}${typed[3]?`-${typed[3]}`:""}-multiaudio-v2`;
  const numeric=raw.replace(/[^0-9]/g,"");
  if(!numeric)throw new Error("Invalid stream id");
  return `vod-${numeric}-multiaudio-v2`;
}
export function hearMeOutYoutubeWatchHlsId(value:unknown){const id=String(value??"").trim();if(!/^[A-Za-z0-9_-]{11}$/.test(id))throw new Error("Invalid YouTube video id");return `yt-${id}`;}
export function cleanHearMeOutHlsFileName(value:unknown){const clean=String(value??"").replace(/[^a-zA-Z0-9_.-]/g,"");if(!clean||clean.includes(".."))throw new Error("Invalid HLS file");return clean;}
export function cleanHearMeOutFlyMachineId(value:unknown){const clean=String(value??"").replace(/[^a-zA-Z0-9]/g,"");return clean||null;}
export function isAllowedHearMeOutYoutubeMediaUrl(value:unknown){if(!value)return false;try{const u=new URL(String(value));if(u.protocol!=="https:")return false;const h=u.hostname.toLowerCase();return ["googlevideo.com","youtube.com","ytimg.com"].some((b)=>h===b||h.endsWith(`.${b}`));}catch{return false;}}
export function firstHearMeOutHlsMediaReference(manifest:string){return String(manifest??"").split(/\r?\n/).map((l)=>l.trim()).find((l)=>l&&!l.startsWith("#"))??null;}
export function isLegacyHearMeOutEventPlaylist(manifest:string){return String(manifest??"").includes("#EXT-X-PLAYLIST-TYPE:EVENT");}
export function pinHearMeOutHlsManifestToMachine(manifest:string,machineId:unknown){
  const machine=cleanHearMeOutFlyMachineId(machineId);if(!machine)return String(manifest??"");const param=`machine=${encodeURIComponent(machine)}`;
  return String(manifest??"").split(/\r?\n/).map((line)=>{const t=line.trim();if(/^#EXT-X-MEDIA:/i.test(t)&&/URI="[^"]+"/i.test(line))return line.replace(/URI="([^"]+)"/i,(_m,uri:string)=>`URI="${uri}${/[?&]machine=/.test(uri)?"":`${uri.includes("?")?"&":"?"}${param}`}`);if(!t||t.startsWith("#")||/[?&]machine=/.test(t))return line;return `${line}${line.includes("?")?"&":"?"}${param}`;}).join("\n");
}
export function hearMeOutHlsContentType(value:unknown){const f=cleanHearMeOutHlsFileName(value);return f.endsWith(".m3u8")?"application/vnd.apple.mpegurl":f.endsWith(".ts")?"video/mp2t":"application/octet-stream";}
export function hearMeOutHlsCacheControl(value:unknown){return cleanHearMeOutHlsFileName(value).endsWith(".m3u8")?"no-store":"public, max-age=3600";}
export function isHearMeOutEnglishAudioTrack(track:Pick<HearMeOutWatchAudioTrackV1,"language"|"title">){return /^(?:en|eng|english)$/i.test(String(track.language??""))||/\benglish\b/i.test(String(track.title??""));}
export function hearMeOutAudioTrackName(track:HearMeOutWatchAudioTrackV1){const lang=String(track.language??"").toLowerCase(),title=String(track.title??"").trim(),fallback=lang||`track-${track.index+1}`;return(title||fallback).replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,40)||`track-${track.index+1}`;}
export function hearMeOutDefaultAudioTrackIndex(tracks:readonly HearMeOutWatchAudioTrackV1[]){return Math.max(0,tracks.findIndex(isHearMeOutEnglishAudioTrack));}
export function buildHearMeOutXtreamVariantMap(media:HearMeOutWatchMediaProbeV1){const tracks=media.audio??[],d=hearMeOutDefaultAudioTrackIndex(tracks);return[...(media.hasVideo?[tracks.length?"v:0,agroup:audio,name:video":"v:0,name:video"]:[]),...tracks.map((t,i)=>[`a:${i}`,"agroup:audio",`name:${hearMeOutAudioTrackName(t)}`,t.language?`language:${String(t.language).replace(/[^a-z0-9-]/gi,"").toLowerCase()}`:"",i===d?"default:yes":""].filter(Boolean).join(","))].join(" ");}
export function buildHearMeOutXtreamHlsFfmpegArgs(sourceUrl:string,media:HearMeOutWatchMediaProbeV1,outputDir:string,options:HearMeOutWatchHlsFfmpegOptionsV1={}){
  const seconds=positive(options.segmentSeconds??HEARMEOUT_WATCH_HLS_SEGMENT_SECONDS),size=nonnegative(options.listSize??HEARMEOUT_WATCH_HLS_LIST_SIZE),threshold=positive(options.deleteThreshold??HEARMEOUT_WATCH_HLS_DELETE_THRESHOLD),tracks=media.audio??[],map=[...(media.hasVideo?["-map","0:v:0?"]:[]),...tracks.flatMap((t)=>["-map",`0:${t.sourceSpecifier||t.sourceIndex}?`])],variants=buildHearMeOutXtreamVariantMap(media);
  return["-hide_banner","-loglevel","warning","-threads","2","-y","-user_agent","DiscordStreamHub/1.0","-reconnect","1","-reconnect_streamed","1","-reconnect_at_eof","1","-reconnect_delay_max","5","-i",sourceUrl,...map,"-c:v","copy","-c:a","aac","-ac","2","-f","hls","-hls_time",String(seconds),"-hls_list_size",String(size),...(size>0?["-hls_delete_threshold",String(threshold)]:[]),"-hls_flags",size>0?"delete_segments+independent_segments":"independent_segments",...(variants?["-var_stream_map",variants,"-master_pl_name","index.m3u8"]:[]),"-hls_segment_filename",join(outputDir,"stream_%v_seg_%05d.ts"),variants?join(outputDir,"stream_%v.m3u8"):join(outputDir,"index.m3u8")];
}
export function planHearMeOutWatchHlsPrune(entries:readonly{streamId:string;bytes:number;mtimeMs:number;active?:boolean}[],targetBytes=HEARMEOUT_WATCH_HLS_BUDGET_BYTES):HearMeOutWatchHlsPruneResultV1{
  if(!Number.isFinite(targetBytes)||targetBytes<0)return{bytes:0,removed:[]};const inactive=entries.filter((e)=>!e.active).map((e)=>({...e,bytes:Math.max(0,Number(e.bytes)||0),mtimeMs:Number(e.mtimeMs)||0}));let total=entries.reduce((s,e)=>s+Math.max(0,Number(e.bytes)||0),0);const removed:Array<{streamId:string;bytes:number}>=[];for(const e of inactive.sort((a,b)=>a.mtimeMs-b.mtimeMs)){if(total<=targetBytes)break;total-=e.bytes;removed.push({streamId:e.streamId,bytes:e.bytes});}return{bytes:total,removed};
}
export class HearMeOutWatchHlsCache{
  private readonly failures=new Map<string,{at:number;message:string}>();
  constructor(private readonly root:string,private readonly activeJobs:ReadonlySet<string>=new Set(),private readonly budgetBytes=HEARMEOUT_WATCH_HLS_BUDGET_BYTES,private readonly nowMs:()=>number=Date.now){if(!root)throw new Error("HearMeOut HLS cache root is required");}
  paths(streamId:unknown){const clean=cleanHearMeOutWatchStreamId(streamId),dir=join(this.root,clean);return{clean,dir,indexPath:join(dir,"index.m3u8")};}
  hasUsableIndex(streamId:unknown){const{dir,indexPath}=this.paths(streamId);if(!existsSync(indexPath))return false;const s=statSync(indexPath);if(!s.isFile()||s.size<=0)return false;const manifest=readFileSync(indexPath,"utf8");if(isLegacyHearMeOutEventPlaylist(manifest)){try{unlinkSync(indexPath);}catch{}return false;}const first=firstHearMeOutHlsMediaReference(manifest);if(!first)return false;const p=join(dir,cleanHearMeOutHlsFileName(first));if(!existsSync(p))return false;const ps=statSync(p);return ps.isFile()&&ps.size>0;}
  touch(streamId:unknown){const{indexPath}=this.paths(streamId);if(existsSync(indexPath)){const now=new Date(this.nowMs());try{utimesSync(indexPath,now,now);}catch{}}}
  recordFailure(streamId:unknown,error:unknown){this.failures.set(cleanHearMeOutWatchStreamId(streamId),{at:this.nowMs(),message:safeError(error)});}
  clearFailure(streamId:unknown){this.failures.delete(cleanHearMeOutWatchStreamId(streamId));}
  recentFailure(streamId:unknown){const k=cleanHearMeOutWatchStreamId(streamId),f=this.failures.get(k);if(!f)return null;if(this.nowMs()-f.at>HEARMEOUT_WATCH_HLS_FAILURE_TTL_MS){this.failures.delete(k);return null;}return{...f};}
  snapshot():HearMeOutWatchHlsSnapshotV1{mkdirSync(this.root,{recursive:true});const entries:HearMeOutWatchHlsEntryV1[]=[];for(const e of readdirSync(this.root,{withFileTypes:true})){if(!e.isDirectory())continue;const dir=join(this.root,e.name);let bytes=0,files=0,updated=0;for(const n of readdirSync(dir)){try{const s=statSync(join(dir,n));if(!s.isFile())continue;bytes+=s.size;files++;updated=Math.max(updated,s.mtimeMs);}catch{}}entries.push({streamId:e.name,bytes,files,ready:this.hasUsableIndex(e.name),active:this.activeJobs.has(e.name),updatedAt:updated?new Date(updated).toISOString():null});}entries.sort((a,b)=>String(b.updatedAt??"").localeCompare(String(a.updatedAt??"")));return{root:"worker-managed",bytes:entries.reduce((s,e)=>s+e.bytes,0),budgetBytes:this.budgetBytes,segmentSeconds:HEARMEOUT_WATCH_HLS_SEGMENT_SECONDS,playlistWindow:HEARMEOUT_WATCH_HLS_LIST_SIZE===0?"full":`${HEARMEOUT_WATCH_HLS_LIST_SIZE} segments`,entries};}
  prune(targetBytes=this.budgetBytes){mkdirSync(this.root,{recursive:true});const candidates:Array<{streamId:string;bytes:number;mtimeMs:number;active:boolean}>=[];for(const e of readdirSync(this.root,{withFileTypes:true})){if(!e.isDirectory())continue;const dir=join(this.root,e.name);let bytes=0,mtimeMs=0;for(const n of readdirSync(dir)){try{const s=statSync(join(dir,n));if(!s.isFile())continue;bytes+=s.size;mtimeMs=Math.max(mtimeMs,s.mtimeMs);}catch{}}candidates.push({streamId:e.name,bytes,mtimeMs,active:this.activeJobs.has(e.name)});}const plan=planHearMeOutWatchHlsPrune(candidates,targetBytes);for(const item of plan.removed){try{rmSync(join(this.root,item.streamId),{recursive:true,force:true});}catch{}}return plan;}
}
function positive(value:number){const n=Math.trunc(Number(value));if(!Number.isSafeInteger(n)||n<1||n>10000)throw new Error("HLS positive setting is invalid");return n;}
function nonnegative(value:number){const n=Math.trunc(Number(value));if(!Number.isSafeInteger(n)||n<0||n>100000)throw new Error("HLS nonnegative setting is invalid");return n;}
function safeError(error:unknown){const m=error instanceof Error?error.message:String(error??"HLS conversion failed");return m.replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi,"$1=[redacted]").replace(/[\r\n\0]/g," ").slice(0,300);}
