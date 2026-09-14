import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { HearMeOutResolvedYoutubeV1, HearMeOutYoutubeResolverAdapterV1 } from './youtube-resolver.js';

export interface HearMeOutPreparedMediaOptions {
  origin: string;
  authorization: string;
  tenantId: string;
}

export class HearMeOutPreparedMediaError extends Error {
  constructor(readonly code:string,message:string,readonly httpStatus?:number){super(message);}
}

export function hearMeOutBrowserCacheUrl(value:string|URL, origin:string){
  let url:URL;try{url=new URL(value);}catch{return undefined;}
  return url.origin===origin&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/watch\/youtube\/browser\/[A-Za-z0-9_-]{11}(?:\/(?:audio|video|prepare))?$/.test(url.pathname)?url:undefined;
}

// The existing DJ worker prepares media. It never receives Apollo room control
// requests through this adapter, and its credential never enters FFmpeg argv.
export function preparedHearMeOutUrl(value: string | URL, origin: string): URL | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.origin !== new URL(origin).origin || url.username || url.password || url.hash) return undefined;
  if (!/^\/watch\/youtube\/hls\/[A-Za-z0-9_-]{11}\/(?:[A-Za-z0-9_-]+\.m3u8|[A-Za-z0-9_-]+\.ts)$/.test(url.pathname)) return undefined;
  if ([...url.searchParams].some(([key, value]) => key !== 'machine' || !/^[A-Za-z0-9]{1,64}$/.test(value)) || [...url.searchParams].length > 1) return undefined;
  return url;
}

export function preparedHearMeOutEnvironment(environment: NodeJS.ProcessEnv): HearMeOutPreparedMediaOptions | undefined {
  if (environment.HEARMEOUT_PREPARED_MEDIA_ENABLED !== '1') return undefined;
  const origin = environment.HEARMEOUT_VOICE_BRIDGE_ORIGIN ?? '';
  const authorization = environment.HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION ?? '';
  const tenantId = environment.HEARMEOUT_MEDIA_TENANT_ID ?? environment.HEARMEOUT_VOICE_BRIDGE_TENANT_ID ?? '';
  if (origin !== 'https://hmo-dj-worker.fly.dev' || !/^Bearer [^\r\n]{16,}$/.test(authorization) || !/^[A-Za-z0-9._:-]{1,160}$/.test(tenantId)) throw Error('Existing HearMeOut prepared-media binding is incomplete');
  return { origin, authorization, tenantId };
}

export class HearMeOutPreparedMedia implements HearMeOutYoutubeResolverAdapterV1 {
  private readonly localPrefix = '/_hmo_prepared/' + randomBytes(32).toString('base64url') + '/';
  constructor(readonly options: HearMeOutPreparedMediaOptions, private readonly fetchImpl: typeof fetch = fetch) {}

  async browserCache(videoId:string,track?:'audio'|'video'|'prepare',body?:Buffer){
    const url=new URL(`/watch/youtube/browser/${videoId}${track?'/'+track:''}`,this.options.origin);
    if(!hearMeOutBrowserCacheUrl(url,this.options.origin))throw Error('Invalid browser media request');
    const upload=track==='audio'||track==='video';
    if(upload&&(!body?.length||body.length>200*1024*1024))throw Error('Invalid browser media size');
    const response=await this.fetchImpl(url,{method:track?'POST':'GET',redirect:'manual',headers:{authorization:this.options.authorization,...(upload?{'content-type':'application/octet-stream'}:{})},...(upload?{body:new Uint8Array(body!)}:{}),signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw await preparedMediaFailure(response);
    return JSON.parse(await boundedManifest(response)) as {audio?:boolean;video?:boolean;hls?:boolean;ok?:boolean};
  }

  async upstream(videoId: string): Promise<HearMeOutResolvedYoutubeV1 | null> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw Error('Invalid YouTube video id');
    // Reuse saved media first. Cold acquisition explicitly starts one shared
    // source player; HLS reads themselves never start the URL extractor.
    const cached=await this.browserCache(videoId);
    if(!cached.audio&&!cached.hls)await this.browserCache(videoId,'prepare');
    const url = new URL(`/watch/youtube/hls/${videoId}/index.m3u8`, this.options.origin);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.read(url);
      if (response.status === 202) { await response.body?.cancel(); continue; }
      if (!response.ok) throw await preparedMediaFailure(response);
      const manifest = await boundedManifest(response);
      this.manifest(manifest, url);
      return { videoId, videoUrl: url.href, audioUrl: url.href, stage: 'upstream', resolvedAt: new Date().toISOString() };
    }
    throw new HearMeOutPreparedMediaError('preparing','Existing HearMeOut media worker is still preparing this video. Retry the request.',202);
  }

  localSource(source: URL, tenantId: string, proxyOrigin: string): URL {
    if (source.origin !== new URL(this.options.origin).origin) return source;
    const remote = preparedHearMeOutUrl(source, this.options.origin);
    if (!remote || tenantId !== this.options.tenantId) throw Error('Prepared media is not available to this room');
    return this.localUrl(remote, proxyOrigin);
  }

  async serve(url: URL, proxyOrigin: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (url.origin !== proxyOrigin || !url.pathname.startsWith(this.localPrefix)) return false;
    const remote = preparedHearMeOutUrl(new URL(url.pathname.replace(this.localPrefix, '/watch/youtube/hls/') + url.search, this.options.origin), this.options.origin);
    if (!remote) throw Error('Invalid prepared media reference');
    const controller = new AbortController();
    response.once('close', () => controller.abort());
    const upstream = await this.read(remote, request.headers.range, controller.signal);
    if (!upstream.ok) {
      await upstream.body?.cancel();
      response.writeHead(upstream.status, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end('Prepared media is not available');
      return true;
    }
    if (remote.pathname.endsWith('.m3u8')) {
      const manifest = await boundedManifest(upstream);
      const body = this.manifest(manifest, remote, proxyOrigin);
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' });
      response.end(body);
      return true;
    }
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const value = upstream.headers.get(key); if (value) headers[key] = value; }
    response.writeHead(upstream.status, headers);
    if (!upstream.body) response.end();
    else Readable.fromWeb(upstream.body as never).on('error', () => response.destroy()).pipe(response);
    return true;
  }

  private localUrl(remote: URL, proxyOrigin: string) {
    return new URL(remote.pathname.replace('/watch/youtube/hls/', this.localPrefix) + remote.search, proxyOrigin);
  }

  private manifest(manifest: string, remote: URL, proxyOrigin?: string) {
    if (!manifest.startsWith('#EXTM3U')) throw Error('Existing HearMeOut media worker did not return HLS');
    const rewrite = (reference: string) => {
      const child = preparedHearMeOutUrl(new URL(reference, remote), this.options.origin);
      if (!child || child.pathname.split('/')[4] !== remote.pathname.split('/')[4]) throw Error('Prepared media contains an unrelated source');
      return proxyOrigin ? this.localUrl(child, proxyOrigin).href : child.href;
    };
    return manifest.split('\n').map(line => line.trim() && !line.startsWith('#') ? rewrite(line.trim()) : line.replace(/URI="([^"]+)"/g, (_match, value: string) => `URI="${rewrite(value)}"`)).join('\n');
  }

  private read(url: URL, range?: string, signal?: AbortSignal) {
    if (!preparedHearMeOutUrl(url, this.options.origin)) throw Error('Invalid prepared media source');
    const machine = url.searchParams.get('machine');
    return this.fetchImpl(url, { method: 'GET', redirect: 'manual', headers: { authorization: this.options.authorization, 'x-hmo-browser-media':'1', 'user-agent': 'HearMeOut/1.0', ...(range ? { range } : {}), ...(machine ? { 'fly-force-instance-id': machine } : {}) }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55000)]) : AbortSignal.timeout(55000) });
  }
}

// Worker responses can contain FFmpeg command lines and signed source URLs.
// Return only known failure categories to viewers and release verification.
async function preparedMediaFailure(response:Response){
  let body='';const reader=response.body?.getReader();
  if(reader)try{let bytes=0;while(bytes<8192){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;body+=Buffer.from(next.value.subarray(0,8192-body.length)).toString('utf8');}}catch{}finally{await reader.cancel().catch(()=>{});}
  const status=response.status;
  if(status===401||status===403)return new HearMeOutPreparedMediaError('worker-auth',`Existing HearMeOut media worker rejected its configured service access (HTTP ${status})`,status);
  if(status===404)return new HearMeOutPreparedMediaError('worker-route','Existing HearMeOut prepared-media endpoint was not found (HTTP 404)',status);
  if(/YouTube (?:refused|did not permit playback)/i.test(body))return new HearMeOutPreparedMediaError('provider-denied','YouTube refused playback in the shared source player. This player does not inherit your browser’s YouTube session.',status);
  if(/shared YouTube|YouTube did not load|YouTube sources are already/i.test(body))return new HearMeOutPreparedMediaError('capture-unavailable','The shared YouTube source could not be saved. Retry the request; the current broadcast is preserved.',status);
  if(/No YouTube video stream resolved/i.test(body))return new HearMeOutPreparedMediaError('video-unavailable','The existing HearMeOut worker could not obtain the YouTube video stream',status);
  if(/No YouTube audio stream resolved/i.test(body))return new HearMeOutPreparedMediaError('audio-unavailable','The existing HearMeOut worker could not obtain the YouTube audio stream',status);
  if(/sign.?in|confirm.*bot|forbidden|(?:HTTP|status|error)[^\n]{0,20}403/i.test(body))return new HearMeOutPreparedMediaError('provider-denied','YouTube refused the media source requested by the existing HearMeOut worker',status);
  return new HearMeOutPreparedMediaError('worker-http',`Existing HearMeOut media worker returned HTTP ${status}`,status);
}

async function boundedManifest(response: Response) {
  if (!response.body) throw Error('Prepared media manifest is empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > 1024 * 1024) throw Error('Prepared media manifest is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
