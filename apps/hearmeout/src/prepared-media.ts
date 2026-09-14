import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { HearMeOutResolvedYoutubeV1, HearMeOutYoutubeResolverAdapterV1 } from './youtube-resolver.js';

export interface HearMeOutPreparedMediaOptions {
  origin: string;
  authorization: string;
  tenantId: string;
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

  async upstream(videoId: string): Promise<HearMeOutResolvedYoutubeV1 | null> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw Error('Invalid YouTube video id');
    const url = new URL(`/watch/youtube/hls/${videoId}/index.m3u8`, this.options.origin);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.read(url);
      if (response.status === 202) { await response.body?.cancel(); continue; }
      if (!response.ok) { await response.body?.cancel(); throw Error(`Existing HearMeOut media worker returned HTTP ${response.status}`); }
      const manifest = await boundedManifest(response);
      this.manifest(manifest, url);
      return { videoId, videoUrl: url.href, audioUrl: url.href, stage: 'upstream', resolvedAt: new Date().toISOString() };
    }
    throw Error('Existing HearMeOut media worker is still preparing this video');
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
    return this.fetchImpl(url, { method: 'GET', redirect: 'manual', headers: { authorization: this.options.authorization, 'user-agent': 'HearMeOut/1.0', ...(range ? { range } : {}), ...(machine ? { 'fly-force-instance-id': machine } : {}) }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55000)]) : AbortSignal.timeout(55000) });
  }
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
