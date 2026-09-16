/**
 * Client-side YouTube stream URL resolver.
 * Runs in the user's browser (real residential IP), calls the InnerTube
 * player API, and posts the resolved CDN URLs to the server so the DJ worker
 * can transcode to HLS without needing yt-dlp on the datacenter IP.
 *
 * We prefer InnerTube clients that return plain, unciphered `url` fields
 * (ANDROID_VR, then IOS) so the browser never has to run YouTube's player JS
 * to decipher signatures. The WEB client is kept only as a last resort because
 * its formats are usually signature-ciphered and unusable here.
 */

const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

export type ResolvedStream = {
  videoUrl: string;
  audioUrl: string;
  videoId: string;
  title?: string;
  duration?: number;
};

type InnertubeClient = {
  name: string;
  context: Record<string, unknown>;
};

const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {name:'ANDROID_VR',context:{clientName:'ANDROID_VR',clientVersion:'1.60.19',deviceMake:'Oculus',deviceModel:'Quest 3',androidSdkVersion:32,osName:'Android',osVersion:'12L',hl:'en',gl:'US'}},
  {name:'IOS',context:{clientName:'IOS',clientVersion:'19.45.4',deviceMake:'Apple',deviceModel:'iPhone16,2',osName:'iPhone',osVersion:'18.1.0.22B83',hl:'en',gl:'US'}},
  {name:'WEB',context:{clientName:'WEB',clientVersion:'2.20240101.00.00',hl:'en',gl:'US'}},
];

async function fetchInnertubePlayer(videoId: string, client: InnertubeClient): Promise<any> {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`, {
    method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({videoId,context:{client:client.context},contentCheckOk:true,racyCheckOk:true}),
  });
  if (!response.ok) throw new Error(`YouTube API returned ${response.status}`);
  return response.json();
}

function pickBestFormat(formats: any[], type: 'video' | 'audio'): string | null {
  if (!Array.isArray(formats)) return null;
  const candidates = formats.filter((f) => {
    if (!f.url || (type === 'video' && Number(f.height) > 720)) return false;
    const mime = String(f.mimeType || '');
    return type === 'video' ? mime.startsWith('video/') : mime.startsWith('audio/');
  }).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return candidates[0]?.url || null;
}

async function resolveWithClient(videoId: string, client: InnertubeClient): Promise<ResolvedStream | null> {
  const data = await fetchInnertubePlayer(videoId, client),status = data?.playabilityStatus?.status;
  if (status !== 'OK') {console.warn(`[YT Resolve] ${client.name} playability:`, status, data?.playabilityStatus?.reason);return null;}
  const streamingData=data?.streamingData,formats=[...(streamingData?.formats||[]),...(streamingData?.adaptiveFormats||[])],videoUrl=pickBestFormat(formats,'video'),audioUrl=pickBestFormat(formats,'audio');
  if(!audioUrl){console.warn(`[YT Resolve] ${client.name} returned no usable audio URL (likely ciphered)`);return null;}
  const title=data?.videoDetails?.title,duration=Number(data?.videoDetails?.lengthSeconds||0)*1000;
  return {videoUrl:videoUrl||audioUrl,audioUrl,videoId,title,duration};
}

export async function resolveYoutubeStream(videoId: string): Promise<ResolvedStream | null> {
  for(const client of INNERTUBE_CLIENTS){try{const resolved=await resolveWithClient(videoId,client);if(resolved){console.log(`[YT Resolve] Resolved ${videoId} via ${client.name}`);return resolved;}}catch{console.warn(`[YT Resolve] ${client.name} did not resolve in this browser`);}}
  console.error(`[YT Resolve] All InnerTube clients failed for ${videoId}`);return null;
}

const MAX_TRACK_BYTES=200*1024*1024;
function scopedCachePath(path:string){
  if(typeof location==='undefined')return path;
  const source=new URLSearchParams(location.search),target=new URL(path,location.origin);
  for(const key of ['roomId','appRoomId','guildId','channelId']){const value=source.get(key);if(value)target.searchParams.set(key,value);}
  if(!target.searchParams.has('guildId')&&source.get('guild_id'))target.searchParams.set('guildId',source.get('guild_id')!);
  if(!target.searchParams.has('channelId')&&source.get('channel_id'))target.searchParams.set('channelId',source.get('channel_id')!);
  return target.pathname+target.search;
}
async function cacheApi(path:string,body?:Blob,signal?:AbortSignal){
  const response=await fetch(scopedCachePath(path),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'content-type':'application/octet-stream'},body}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data)throw Error(data?.error||'The media cache did not accept this request');
  return data;
}
async function downloadTrack(value:string,signal:AbortSignal){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='googlevideo.com'||url.hostname.endsWith('.googlevideo.com')))throw Error('YouTube returned an invalid media source');
  const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
  if(!response.ok||!response.body)throw Error('YouTube did not allow this browser to download the media (HTTP '+response.status+')');
  const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_TRACK_BYTES)throw Error('This media track is too large to cache');chunks.push(new Uint8Array(part.value));}}
  finally{await reader.cancel().catch(()=>{});}
  if(!bytes)throw Error('YouTube returned empty media');
  return new Blob(chunks,{type:'application/octet-stream'});
}
export async function prepareHearMeOutYoutube(videoId:string,lane:'music'|'movie',progress:(message:string)=>void){
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))throw Error('Invalid YouTube video');
  const base='/api/watch/broadcast/youtube/'+videoId,cached=await cacheApi(base+'/status');
  if(cached.hls||(cached.audio&&(lane==='music'||cached.video)))return;
  progress('Preparing YouTube in your browser…');const resolved=await resolveYoutubeStream(videoId);
  if(!resolved)throw Error('YouTube could not resolve this video in your browser. The worker has not retried it.');
  const hasVideo=resolved.videoUrl!==resolved.audioUrl;if(lane==='movie'&&!hasVideo)throw Error('YouTube did not return a video track for this browser');
  const controller=new AbortController(),tracks:Array<{name:'video'|'audio';url:string}>=[];
  if(hasVideo&&!cached.video)tracks.push({name:'video',url:resolved.videoUrl});if(!cached.audio)tracks.push({name:'audio',url:resolved.audioUrl});
  progress('Preparing '+tracks.map(track=>track.name).join(' and ')+'…');
  const transfers=tracks.map(async track=>{const body=await downloadTrack(track.url,controller.signal);controller.signal.throwIfAborted();await cacheApi(base+'/'+track.name,body,controller.signal);});
  try{await Promise.all(transfers);}catch(error){controller.abort();await Promise.allSettled(transfers);throw error;}
  progress('Starting playback from the media cache…');
}
if(typeof window!=='undefined')Object.assign(window,{prepareHearMeOutYoutube});
