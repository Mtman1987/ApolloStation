import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Media proxy and Xtream diagnostic routes. They run in the web process so provider
// credentials and provider URLs never leave it. Every route requires an SPMT session,
// every outbound hop is checked against an exact host allowlist, and every error body
// is a fixed string. Provider URLs, cookies, and credentials are never echoed back.

export const MEDIA_PROXY_MAX_REDIRECTS = 3;
const MAX_POST_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 8_000;

// archive.org is deliberately absent. It is excluded from playback origins (HMO-009.01b).
const DEFAULT_WATCH_HOSTS = [
  'test-streams.mux.dev',
  'storage.googleapis.com',
  'commondatastorage.googleapis.com',
  'test-videos.co.uk',
];

const YOUTUBE_EXACT_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtubei.googleapis.com',
];

// Suffixes must match on a dot boundary so "evilgooglevideo.com" does not pass.
const YOUTUBE_SUFFIXES = ['.googlevideo.com', '.ytimg.com'];

export interface MediaProxyDeps {
  // Resolves the SPMT session or throws. Failures become a 401.
  authenticate(request: IncomingMessage): Promise<unknown>;
  // Extra watch hosts, normally from WATCH_PROXY_ALLOWED_HOSTS.
  watchAllowedHosts?: string[];
  // Provider status. Only whitelisted fields are returned to the client.
  xtreamStatus?: () => Promise<Record<string, unknown>>;
  // Provider VOD URL. It stays in this process and is never returned.
  xtreamVodUrl?: (streamId: string) => Promise<URL>;
  fetchImpl?: typeof fetch;
  // Registered YouTube CDN URLs. Defaults to the module-level registry.
  youtubeStreams?: YoutubeStreamRegistry;
}

export const YOUTUBE_STREAM_TTL_MS = 2 * 60 * 60 * 1000;
export const YOUTUBE_STREAM_WINDOW_BYTES = 1024 * 1024;
export const YOUTUBE_STREAM_MAX_ENTRIES = 256;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export type YoutubeStreamKind = 'audio' | 'video';

interface YoutubeStreamEntry {
  url: URL;
  expiresAt: number;
}

// In-memory map of registered CDN URLs, keyed by video and kind. Entries expire after
// the TTL and the oldest entry is dropped when the cap is reached. The CDN URL never
// leaves this map; clients only receive a proxy path.
export class YoutubeStreamRegistry {
  private readonly entries = new Map<string, YoutubeStreamEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  put(videoId: string, kind: YoutubeStreamKind, url: URL): void {
    this.sweep();
    const key = `${kind}:${videoId}`;
    this.entries.delete(key);
    while (this.entries.size >= YOUTUBE_STREAM_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { url, expiresAt: this.now() + YOUTUBE_STREAM_TTL_MS });
  }

  get(videoId: string, kind: YoutubeStreamKind): URL | undefined {
    const key = `${kind}:${videoId}`;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.url;
  }

  size(): number {
    this.sweep();
    return this.entries.size;
  }

  private sweep(): void {
    const current = this.now();
    for (const [key, entry] of this.entries) {
      if (current >= entry.expiresAt) this.entries.delete(key);
    }
  }
}

const youtubeStreams = new YoutubeStreamRegistry();

type Handler = (request: IncomingMessage, response: ServerResponse, url: URL, deps: MediaProxyDeps) => Promise<void>;

export function watchAllowedHosts(extra: string[] = []): Set<string> {
  const hosts = new Set([...DEFAULT_WATCH_HOSTS, ...extra.map(host => host.trim().toLowerCase()).filter(Boolean)]);
  hosts.delete('archive.org');
  return hosts;
}

export function isAllowedYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (YOUTUBE_EXACT_HOSTS.includes(host)) return true;
  return YOUTUBE_SUFFIXES.some(suffix => host.endsWith(suffix) && host.length > suffix.length);
}

// Returns the handler for a route, or undefined when the path is not a media route.
export async function handleMediaProxyRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: MediaProxyDeps,
): Promise<boolean> {
  const route = matchRoute(request.method ?? 'GET', url.pathname);
  if (!route) return false;
  let session: unknown;
  try {
    session = await deps.authenticate(request);
  } catch {
    sendJson(response, 401, { error: 'Sign in before using media routes' });
    return true;
  }
  if (!session) {
    sendJson(response, 401, { error: 'Sign in before using media routes' });
    return true;
  }
  await route(request, response, url, deps);
  return true;
}

function matchRoute(method: string, pathname: string): Handler | undefined {
  if (method === 'GET' && pathname === '/api/watch/proxy') return watchProxy;
  if (method === 'POST' && pathname === '/api/hearmeout/youtube-proxy') return youtubeProxy;
  if (method === 'POST' && pathname === '/api/hearmeout/youtube-stream/register') return youtubeStreamRegister;
  if (method === 'GET' && pathname === '/api/hearmeout/youtube-audio/proxy') return youtubeStreamProxy('audio');
  if (method === 'GET' && pathname === '/api/hearmeout/youtube-video/proxy') return youtubeStreamProxy('video');
  if (method === 'GET' && pathname === '/api/watch/xtream/status') return xtreamStatus;
  if (method === 'GET' && /^\/api\/watch\/xtream\/direct-test\/[^/]+$/.test(pathname)) return xtreamDirectTest;
  return undefined;
}

// Opens an upstream URL. Each redirect hop is re-checked against the allowlist, and
// only the range header is forwarded. Cookies and authorization are never forwarded.
async function fetchChecked(
  start: URL,
  allowed: (host: string) => boolean,
  init: { range?: string | null; method?: 'GET' | 'HEAD'; signal?: AbortSignal },
  fetchImpl: typeof fetch,
): Promise<Response> {
  let current = start;
  for (let hop = 0; hop <= MEDIA_PROXY_MAX_REDIRECTS; hop += 1) {
    if (current.protocol !== 'https:' || !allowed(current.hostname.toLowerCase())) {
      throw new MediaProxyError(403, 'Playback host is not allowed');
    }
    const headers: Record<string, string> = { 'user-agent': 'HearMeOut-Media-Proxy/1.0' };
    if (init.range) headers.range = init.range;
    const upstream = await fetchImpl(current, {
      method: init.method ?? 'GET',
      headers,
      cache: 'no-store',
      redirect: 'manual',
      ...(init.signal ? { signal: init.signal } : {}),
    });
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
      await upstream.body?.cancel().catch(() => {});
      current = new URL(upstream.headers.get('location') as string, current);
      continue;
    }
    return upstream;
  }
  throw new MediaProxyError(502, 'Too many redirects');
}

class MediaProxyError extends Error {
  constructor(readonly status: number, readonly publicMessage: string) {
    super(publicMessage);
  }
}

function isManifest(url: URL, contentType: string | null): boolean {
  return url.pathname.endsWith('.m3u8') || Boolean(contentType?.includes('mpegurl')) || Boolean(contentType?.includes('application/vnd.apple'));
}

function rewriteManifest(manifest: string, upstreamUrl: URL, proxyPath: string): string {
  const proxied = (value: string) => {
    if (!value || value.startsWith('data:')) return value;
    const absolute = new URL(value, upstreamUrl).toString();
    return `${proxyPath}?url=${encodeURIComponent(absolute)}`;
  };
  return manifest
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, value: string) => `URI="${proxied(value)}"`);
      return proxied(trimmed);
    })
    .join('\n');
}

function downloadFilename(url: URL): string {
  const leaf = url.pathname.split('/').filter(Boolean).pop() || 'watch-media';
  return leaf.replace(/[^a-zA-Z0-9._-]/g, '-') || 'watch-media';
}

function safeContentType(value: string | null): string {
  return String(value || 'unknown').split(';')[0]!.trim().slice(0, 100);
}

const watchProxy: Handler = async (request, response, url, deps) => {
  const rawUrl = url.searchParams.get('url');
  const download = url.searchParams.get('download') === '1';
  if (!rawUrl) return sendJson(response, 400, { error: 'Missing url' });
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(rawUrl);
  } catch {
    return sendJson(response, 400, { error: 'Invalid url' });
  }
  const allowed = watchAllowedHosts(deps.watchAllowedHosts);
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const upstream = await fetchChecked(
      upstreamUrl,
      host => allowed.has(host),
      { range: request.headers.range ?? null, signal: controller.signal },
      deps.fetchImpl ?? fetch,
    );
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {});
      return sendJson(response, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, { error: 'Upstream request failed' });
    }
    const contentType = upstream.headers.get('content-type');
    const finalUrl = upstreamUrl;
    if (isManifest(finalUrl, contentType)) {
      const manifest = rewriteManifest(await upstream.text(), finalUrl, url.pathname);
      const headers: Record<string, string> = {
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      };
      if (download) headers['content-disposition'] = `attachment; filename="${downloadFilename(finalUrl)}"`;
      response.writeHead(200, headers);
      return void response.end(manifest);
    }
    const headers: Record<string, string> = {
      'content-type': contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    };
    for (const name of ['accept-ranges', 'content-length', 'content-range', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    if (download) headers['content-disposition'] = `attachment; filename="${downloadFilename(finalUrl)}"`;
    response.writeHead(upstream.status, headers);
    if (!upstream.body) return void response.end();
    Readable.fromWeb(upstream.body as never).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    sendProxyError(response, error);
  }
};

const youtubeProxy: Handler = async (request, response, _url, deps) => {
  if (!sameOrigin(request)) return sendJson(response, 403, { error: 'Cross-origin request refused' });
  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_POST_BYTES);
  } catch (error) {
    return sendProxyError(response, error);
  }
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const rawUrl = typeof value.url === 'string' ? value.url : '';
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return sendJson(response, 400, { error: 'Invalid or disallowed url' });
  }
  if (!isAllowedYoutubeHost(target.hostname)) return sendJson(response, 400, { error: 'Invalid or disallowed url' });
  // Only GET and HEAD are forwarded. The body and caller headers are dropped.
  const method = value.method === 'HEAD' ? 'HEAD' : 'GET';
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const range = Array.isArray(value.headers)
      ? (value.headers as unknown[]).find((entry): entry is [string, string] =>
          Array.isArray(entry) && String(entry[0]).toLowerCase() === 'range' && typeof entry[1] === 'string')?.[1] ?? null
      : null;
    const upstream = await fetchChecked(target, isAllowedYoutubeHost, { range, method, signal: controller.signal }, deps.fetchImpl ?? fetch);
    const headers: Record<string, string> = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    for (const name of ['content-type', 'content-length', 'cache-control', 'accept-ranges', 'content-range']) {
      const found = upstream.headers.get(name);
      if (found) headers[name] = found;
    }
    response.writeHead(upstream.status, headers);
    if (!upstream.body || method === 'HEAD') {
      await upstream.body?.cancel().catch(() => {});
      return void response.end();
    }
    Readable.fromWeb(upstream.body as never).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    sendProxyError(response, error);
  }
};

// Registers a checked CDN URL for one video. The client gets back a proxy path, never the URL.
const youtubeStreamRegister: Handler = async (request, response, _url, deps) => {
  if (!sameOrigin(request)) return sendJson(response, 403, { error: 'Cross-origin request refused' });
  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_POST_BYTES);
  } catch (error) {
    return sendProxyError(response, error);
  }
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const videoId = typeof value.videoId === 'string' ? value.videoId : '';
  const rawKind = value.kind;
  const kind: YoutubeStreamKind | undefined = rawKind === 'audio' ? 'audio' : rawKind === 'video' ? 'video' : undefined;
  if (!YOUTUBE_VIDEO_ID_RE.test(videoId) || !kind) return sendJson(response, 400, { error: 'Invalid videoId or kind' });
  let target: URL;
  try {
    target = new URL(typeof value.url === 'string' ? value.url : '');
  } catch {
    return sendJson(response, 400, { error: 'Invalid or disallowed url' });
  }
  if (target.protocol !== 'https:' || !isAllowedYoutubeHost(target.hostname)) {
    return sendJson(response, 400, { error: 'Invalid or disallowed url' });
  }
  const mime = target.searchParams.get('mime') ?? '';
  if (kind === 'audio' && mime.startsWith('video/')) return sendJson(response, 415, { error: 'Audio stream required' });
  if (kind === 'video' && mime.startsWith('audio/')) return sendJson(response, 415, { error: 'Video stream required' });
  (deps.youtubeStreams ?? youtubeStreams).put(videoId, kind, target);
  sendJson(response, 200, { ok: true, proxyPath: `/api/hearmeout/youtube-${kind}/proxy?videoId=${videoId}` });
};

// Serves one bounded byte window of a registered stream. Every hop is checked, the
// response must be a 206 of the expected media type, and cookies are never forwarded.
function youtubeStreamProxy(kind: YoutubeStreamKind): Handler {
  return async (request, response, url, deps) => {
    const videoId = url.searchParams.get('videoId') ?? '';
    if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) return sendJson(response, 400, { error: 'Invalid videoId' });
    const stored = (deps.youtubeStreams ?? youtubeStreams).get(videoId, kind);
    if (!stored) return sendJson(response, 404, { error: 'No stream registered for this video' });
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    try {
      const upstream = await fetchChecked(
        stored,
        isAllowedYoutubeHost,
        { range: windowedRange(request.headers.range ?? null), signal: controller.signal },
        deps.fetchImpl ?? fetch,
      );
      const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase();
      const contentRange = upstream.headers.get('content-range');
      const typeOk = kind === 'audio' ? contentType.startsWith('audio/') : contentType.startsWith('video/');
      if (upstream.status !== 206 || !upstream.body || !contentRange || !typeOk) {
        await upstream.body?.cancel().catch(() => {});
        return sendJson(response, 502, { error: 'Upstream did not return a valid media window' });
      }
      const headers: Record<string, string> = {
        'content-type': contentType,
        'content-range': contentRange,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      };
      const length = upstream.headers.get('content-length');
      if (length) headers['content-length'] = length;
      response.writeHead(206, headers);
      Readable.fromWeb(upstream.body as never).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      sendProxyError(response, error);
    }
  };
}

// Turns any Range header into one window of at most YOUTUBE_STREAM_WINDOW_BYTES.
function windowedRange(header: string | null): string {
  const match = header ? /^bytes=(\d+)-(\d*)$/i.exec(header.trim()) : null;
  const start = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(start)) return `bytes=0-${YOUTUBE_STREAM_WINDOW_BYTES - 1}`;
  const windowEnd = start + YOUTUBE_STREAM_WINDOW_BYTES - 1;
  const end = match?.[2] ? Math.min(Number(match[2]), windowEnd) : windowEnd;
  return `bytes=${start}-${end}`;
}

const xtreamStatus: Handler = async (_request, response, _url, deps) => {
  if (!deps.xtreamStatus) return sendJson(response, 503, { error: 'Provider status is unavailable' });
  try {
    const status = await deps.xtreamStatus();
    // Whitelist only the fields the client needs. Server and playlist URLs are dropped.
    const user = status.userInfo && typeof status.userInfo === 'object' ? status.userInfo as Record<string, unknown> : {};
    const server = status.serverInfo && typeof status.serverInfo === 'object' ? status.serverInfo as Record<string, unknown> : {};
    sendJson(response, 200, {
      configured: status.configured === true,
      ...(status.mock === true ? { mock: true } : {}),
      userInfo: status.userInfo ? {
        status: typeof user.status === 'string' ? user.status : undefined,
        expDate: user.exp_date ?? undefined,
        isTrial: user.is_trial ?? undefined,
        maxConnections: user.max_connections ?? undefined,
      } : null,
      serverInfo: status.serverInfo ? {
        timezone: typeof server.timezone === 'string' ? server.timezone : undefined,
        timeNow: typeof server.time_now === 'string' ? server.time_now : undefined,
      } : null,
    });
  } catch {
    sendJson(response, 502, { configured: true, error: 'Provider status failed; check provider configuration.' });
  }
};

const xtreamDirectTest: Handler = async (_request, response, url, deps) => {
  const streamId = decodeURIComponent(url.pathname.slice('/api/watch/xtream/direct-test/'.length)).trim();
  if (!/^\d{1,20}$/.test(streamId)) return sendJson(response, 400, { ok: false, error: 'Use a numeric VOD stream ID.' });
  if (!deps.xtreamVodUrl) return sendJson(response, 503, { ok: false, error: 'Provider probe is unavailable' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let upstream: Response | null = null;
  try {
    const source = await deps.xtreamVodUrl(streamId);
    // The provider host is the only host this probe may touch, including on redirect.
    const providerHost = source.hostname.toLowerCase();
    upstream = await fetchChecked(source, host => host === providerHost, { range: 'bytes=0-63', signal: controller.signal }, deps.fetchImpl ?? fetch);
    const contentType = safeContentType(upstream.headers.get('content-type'));
    const contentRange = upstream.headers.get('content-range');
    let firstBytes = 0;
    if (upstream.body) {
      const reader = upstream.body.getReader();
      try {
        const chunk = await reader.read();
        if (!chunk.done && chunk.value) firstBytes = Math.min(chunk.value.byteLength, 64);
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    const streamReturned = upstream.ok && firstBytes > 0;
    const looksLikePlaylist = contentType.includes('mpegurl') || contentType.includes('vnd.apple');
    const looksLikeVideo = contentType.startsWith('video/') || contentType === 'application/octet-stream';
    sendJson(response, 200, {
      ok: streamReturned,
      streamId,
      upstreamStatus: upstream.status,
      contentType,
      contentRange,
      rangeHonored: upstream.status === 206 && Boolean(contentRange),
      firstBytesRead: firstBytes,
      formatHint: looksLikePlaylist ? 'playlist/HLS' : looksLikeVideo ? 'video-or-binary' : 'unknown-content-type',
      directPlaybackSignal: streamReturned && !looksLikePlaylist && looksLikeVideo,
      notes: ['Provider URL and credentials are deliberately not returned.', 'The probe reads at most the first chunk and cancels the stream.'],
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const refused = error instanceof MediaProxyError;
    sendJson(response, 502, {
      ok: false,
      streamId,
      error: timedOut ? 'Provider probe timed out after 8 seconds.' : refused ? 'Provider redirected to a host that is not allowed.' : 'Provider probe failed; check provider configuration and stream ID.',
      notes: ['No provider URL or credentials are returned.'],
    });
  } finally {
    clearTimeout(timer);
  }
};

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host ?? '';
  return origin === `https://${host}` || origin === `http://${host}`;
}

async function readBoundedJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) throw new MediaProxyError(413, 'Request body too large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new MediaProxyError(400, 'Invalid JSON body');
  }
}

// Only MediaProxyError messages reach the client. Anything else becomes a fixed string.
function sendProxyError(response: ServerResponse, error: unknown) {
  if (response.headersSent) { response.destroy(); return; }
  if (error instanceof MediaProxyError) return sendJson(response, error.status, { error: error.publicMessage });
  sendJson(response, 502, { error: 'Upstream request failed' });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}
