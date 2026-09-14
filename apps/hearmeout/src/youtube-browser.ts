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

// Ordered by reliability for returning unciphered, non-throttled direct URLs.
const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {
    name: 'ANDROID_VR',
    context: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.60.19',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12L',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    name: 'IOS',
    context: {
      clientName: 'IOS',
      clientVersion: '19.45.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.1.0.22B83',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    name: 'WEB',
    context: {
      clientName: 'WEB',
      clientVersion: '2.20240101.00.00',
      hl: 'en',
      gl: 'US',
    },
  },
];

async function fetchInnertubePlayer(videoId: string, client: InnertubeClient): Promise<any> {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      context: { client: client.context },
      // Required by some clients to return streaming data instead of a
      // "content check" placeholder.
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });

  if (!response.ok) throw new Error(`YouTube API returned ${response.status}`);
  return response.json();
}

function pickBestFormat(formats: any[], type: 'video' | 'audio'): string | null {
  if (!Array.isArray(formats)) return null;

  const candidates = formats
    .filter((f) => {
      // Only formats with a plain, ready-to-use URL. Ciphered formats expose
      // `signatureCipher`/`cipher` instead and cannot be used without running
      // YouTube's player JS, so we skip them.
      if (!f.url || (type === 'video' && Number(f.height) > 720)) return false;
      const mime = String(f.mimeType || '');
      return type === 'video' ? mime.startsWith('video/') : mime.startsWith('audio/');
    })
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return candidates[0]?.url || null;
}

async function resolveWithClient(videoId: string, client: InnertubeClient): Promise<ResolvedStream | null> {
  const data = await fetchInnertubePlayer(videoId, client);

  const status = data?.playabilityStatus?.status;
  if (status !== 'OK') {
    console.warn(`[YT Resolve] ${client.name} playability:`, status, data?.playabilityStatus?.reason);
    return null;
  }

  const streamingData = data?.streamingData;
  const formats = [...(streamingData?.formats || []), ...(streamingData?.adaptiveFormats || [])];

  const videoUrl = pickBestFormat(formats, 'video');
  const audioUrl = pickBestFormat(formats, 'audio');

  if (!audioUrl) {
    console.warn(`[YT Resolve] ${client.name} returned no usable audio URL (likely ciphered)`);
    return null;
  }

  const title = data?.videoDetails?.title;
  const duration = Number(data?.videoDetails?.lengthSeconds || 0) * 1000;

  // Fall back to the audio URL for video when a client only exposes audio; the
  // worker still gets a playable stream for audio-only DJ playback.
  return { videoUrl: videoUrl || audioUrl, audioUrl, videoId, title, duration };
}

export async function resolveYoutubeStream(videoId: string): Promise<ResolvedStream | null> {
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const resolved = await resolveWithClient(videoId, client);
      if (resolved) {
        console.log(`[YT Resolve] Resolved ${videoId} via ${client.name}`);
        return resolved;
      }
    } catch (error) {
      console.warn(`[YT Resolve] ${client.name} did not resolve in this browser`);
    }
  }

  console.error(`[YT Resolve] All InnerTube clients failed for ${videoId}`);
  return null;
}


const MAX_TRACK_BYTES = 200 * 1024 * 1024;

async function cacheApi(path:string,body?:Blob){
  const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'content-type':'application/octet-stream'},body}:{}),signal:AbortSignal.timeout(180000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data)throw Error(data?.error||'The media cache did not accept this request');
  return data;
}
async function downloadTrack(value:string){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='googlevideo.com'||url.hostname.endsWith('.googlevideo.com')))throw Error('YouTube returned an invalid media source');
  // This fetch deliberately runs in the viewer's browser. Never send the URL
  // to an app endpoint to have a server fetch it instead.
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw Error('YouTube did not allow this browser to download the media (HTTP '+response.status+')');
  const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_TRACK_BYTES)throw Error('This media track is too large to cache');chunks.push(new Uint8Array(part.value));}}
  finally{await reader.cancel().catch(()=>{});}
  if(!bytes)throw Error('YouTube returned empty media');
  return new Blob(chunks,{type:'application/octet-stream'});
}
export async function prepareHearMeOutYoutube(videoId:string,lane:'music'|'movie',progress:(message:string)=>void){
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))throw Error('Invalid YouTube video');
  const base='/api/watch/broadcast/youtube/'+videoId;
  const cached=await cacheApi(base+'/status');
  if(cached.hls||(cached.audio&&(lane==='music'||cached.video)))return;
  progress('Preparing YouTube in your browser…');
  const resolved=await resolveYoutubeStream(videoId);
  if(!resolved)throw Error('YouTube could not resolve this video in your browser. The worker has not retried it.');
  const hasVideo=resolved.videoUrl!==resolved.audioUrl;
  if(lane==='movie'&&!hasVideo)throw Error('YouTube did not return a video track for this browser');
  if(hasVideo&&!cached.video){progress('Downloading video in your browser…');await cacheApi(base+'/video',await downloadTrack(resolved.videoUrl));}
  if(!cached.audio){progress('Downloading audio in your browser…');await cacheApi(base+'/audio',await downloadTrack(resolved.audioUrl));}
  progress('Starting playback from the media cache…');
}
if(typeof window!=='undefined')Object.assign(window,{prepareHearMeOutYoutube});
