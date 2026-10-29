// Ported from the donor app's src/app/api/watch/xtream/hls/[streamId]/[file]/route.ts.
// Serves the Xtream VOD HLS ladder that the Watch catalog (movie-provider) resolves against.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { ensureXtreamHls, getXtreamHlsFile, waitForXtreamHlsIndex } from './xtream-hls.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, range',
};

export const XTREAM_HLS_PATH = /^\/api\/watch\/xtream\/hls\/([^/]+)\/([^/]+)$/;

function sendJson(response: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...extra });
  response.end(JSON.stringify(body));
}

export async function handleXtreamHlsRequest(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  const match = pathname.match(XTREAM_HLS_PATH);
  if (!match) return false;
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS);
    response.end();
    return true;
  }
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }
  try {
    let streamId: string, file: string;
    try { streamId = decodeURIComponent(match[1]!); file = decodeURIComponent(match[2]!); }
    catch { sendJson(response, 400, { error: 'invalid_hls_reference' }); return true; }
    if (!/^(?:(?:vod|series|live)-\d+|episode-\d+-[a-z0-9]+)$/i.test(streamId) || !/^[A-Za-z0-9_-]+\.(?:m3u8|ts)$/.test(file)) {
      sendJson(response, 400, { error: 'invalid_hls_reference' }); return true;
    }
    if (file === 'index.m3u8') {
      ensureXtreamHls(streamId).catch(() => {});
      const ready = await waitForXtreamHlsIndex(streamId);
      if (!ready) {
        sendJson(response, 202, { error: 'HLS stream is still preparing. Try again in a few seconds.' }, { 'retry-after': '3' });
        return true;
      }
    }
    const hlsFile = await getXtreamHlsFile(streamId, file);
    if (!hlsFile) {
      sendJson(response, 404, { error: 'HLS file not found' });
      return true;
    }
    if (file.endsWith('.m3u8')) {
      const cancelManifest = () => hlsFile.stream.destroy();
      response.once('close', cancelManifest);
      hlsFile.stream.once('close', () => response.off('close', cancelManifest));
      if (hlsFile.contentLength > 1024 * 1024) { hlsFile.stream.destroy(); throw Error('Manifest bound'); }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of hlsFile.stream) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw Error('Manifest bound');
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString('utf8');
      // Generated ladders are flat, same-stream files. Never copy provider
      // URLs, cross-stream paths or key URLs into the browser's manifest.
      if (!body.startsWith('#EXTM3U') || /(?:https?:)?\/\/|\\/.test(body)) throw Error('Invalid manifest');
      const valid = (value: string) => /^[A-Za-z0-9_-]+\.(?:m3u8|ts)$/.test(value);
      for (const line of body.split(/\r?\n/)) {
        if (line.trim() && !line.startsWith('#') && !valid(line.trim())) throw Error('Invalid manifest child');
        for (const child of line.matchAll(/URI="([^"]*)"/g)) if (!valid(child[1]!)) throw Error('Invalid manifest child');
      }
      response.writeHead(200, { ...CORS, 'content-type': hlsFile.contentType, 'content-length': String(Buffer.byteLength(body)), 'cache-control': 'no-store' });
      response.end(body);
      return true;
    }
    let stream = hlsFile.stream;
    let status = 200, length = hlsFile.contentLength;
    const rangeHeaders: Record<string, string> = { 'accept-ranges': 'bytes' };
    if (request.headers.range !== undefined) {
      const range = singleRange(request.headers.range, length);
      stream.destroy();
      if (!range) {
        sendJson(response, 416, { error: 'invalid_byte_range' }, { 'content-range': `bytes */${length}`, ...rangeHeaders });
        return true;
      }
      stream = createReadStream(hlsFile.stream.path, range);
      status = 206;
      rangeHeaders['content-range'] = `bytes ${range.start}-${range.end}/${length}`;
      length = range.end - range.start + 1;
    }
    const cancel = () => stream.destroy();
    response.once('close', cancel);
    stream.once('close', () => response.off('close', cancel));
    stream.once('error', () => response.destroy());
    response.writeHead(status, {
      'content-type': hlsFile.contentType,
      'content-length': String(length),
      'cache-control': file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=3600',
      ...CORS,
      ...rangeHeaders,
    });
    stream.pipe(response);
  } catch {
    if (!response.headersSent) sendJson(response, 502, { error: 'HLS media is unavailable' });
    else response.destroy();
  }
  return true;
}

function singleRange(header: string, total: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || total <= 0) return undefined;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))) return undefined;
  if (first === undefined) {
    if (!last || last <= 0) return undefined;
    return { start: Math.max(0, total - last), end: total - 1 };
  }
  const end = Math.min(total - 1, last ?? total - 1);
  return first < total && end >= first ? { start: first, end } : undefined;
}
