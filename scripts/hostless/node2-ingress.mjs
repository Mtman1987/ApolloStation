import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { pathToFileURL } from 'node:url';

export function isNebulaPath(path) {
  if (path === '/api/quackverse/art/canon') return true;
  return /^\/(?:apps\/nebula-arcade(?:\/|$)|api\/nebula-arcade(?:\/|$)|v1\/nebula(?:-arcade)?(?:\/|$)|assets\/nebula(?:\/|-[^/]+)(?:\/|\.|$)|overlay(?:\/|$)|mosaic(?:-overlay)?$|health\/nebula-arcade$)/.test(path);
}

// Route to real app processes, retaining cookies and bearer credentials. Each
// upstream remains responsible for authentication and mutation validation.
export function isHearMeOutPath(path) {
  return path === '/apps/hearmeout' || path.startsWith('/apps/hearmeout/') ||
    path === '/api/hearmeout' || path.startsWith('/api/hearmeout/') || path === '/health/hearmeout';
}

export function createNode2Ingress({ streamweaverPort = 3202, nebulaPort = 3100, hearMeOutPort = 3203 } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const hearMeOut = isHearMeOutPath(url.pathname);
    const nebula = !hearMeOut && isNebulaPath(url.pathname);
    const path = url.pathname === '/health/nebula-arcade' || url.pathname === '/health/hearmeout' ? '/health/ready' + url.search : req.url;
    const port = hearMeOut ? hearMeOutPort : nebula ? nebulaPort : streamweaverPort;
    const upstream = httpRequest({ hostname: '127.0.0.1', port, path, method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'app_unavailable', appId: hearMeOut ? 'hearmeout' : nebula ? 'nebula-arcade' : 'streamweaver' }));
      } else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
  // HearMeOut RTC uses an authenticated WebSocket on the same app origin.
  // Preserve the original upgrade headers and tunnel bytes without decoding audio.
  server.on('upgrade', (req, client, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/api/hearmeout/rtc') return client.destroy();
    const upstream = netConnect(hearMeOutPort, '127.0.0.1', () => {
      const headers = Object.entries(req.headers).map(([key, value]) =>
        value === undefined ? '' : key + ': ' + (Array.isArray(value) ? value.join(', ') : value)).filter(Boolean);
      upstream.write(req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\\r\\n' + headers.join('\\r\\n') + '\\r\\n\\r\\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createNode2Ingress({ streamweaverPort: Number(process.env.STREAMWEAVER_WEB_PORT || 3202), nebulaPort: Number(process.env.NEBULA_ARCADE_PORT || 3100), hearMeOutPort: Number(process.env.HEARMEOUT_WEB_PORT || 3203) });
  server.listen(Number(process.env.PORT || 8000), '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
}