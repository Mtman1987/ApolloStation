// Ported from the donor app's src/app/api/watch/xtream/hls/[streamId]/[file]/route.ts.
// Serves the Xtream VOD HLS ladder that the Watch catalog (movie-provider) resolves against.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureXtreamHls, getXtreamHlsFile, waitForXtreamHlsIndex } from './xtream-hls.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, range',
};

export const XTREAM_HLS_PATH = /^\/api\/watch\/xtream\/hls\/([^/]+)\/([^/]+)$/;

function sendJson(response: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra });
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
  const streamId = decodeURIComponent(match[1]!);
  const file = decodeURIComponent(match[2]!);
  try {
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
    response.writeHead(200, {
      'content-type': hlsFile.contentType,
      'content-length': String(hlsFile.contentLength),
      'cache-control': file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=3600',
      ...CORS,
    });
    hlsFile.stream.pipe(response);
  } catch (error: any) {
    if (!response.headersSent) sendJson(response, 502, { error: error?.message || 'HLS conversion failed' });
    else response.destroy();
  }
  return true;
}
