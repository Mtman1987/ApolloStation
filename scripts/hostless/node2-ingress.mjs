import { createServer, request as httpRequest } from 'node:http';
import { pathToFileURL } from 'node:url';

export function isNebulaPath(path) {
  if (path === '/api/quackverse/art/canon') return true;
  return /^\/(?:apps\/nebula-arcade(?:\/|$)|api\/nebula-arcade(?:\/|$)|v1\/nebula(?:-arcade)?(?:\/|$)|assets\/nebula(?:\/|-[^/]+)(?:\/|\.|$)|overlay(?:\/|$)|mosaic(?:-overlay)?$|health\/nebula-arcade$)/.test(path);
}

// Route to real app processes, retaining cookies and bearer credentials. Each
// upstream remains responsible for authentication and mutation validation.
export function createNode2Ingress({ streamweaverPort = 3202, nebulaPort = 3100 } = {}) {
  return createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const nebula = isNebulaPath(url.pathname);
    const path = url.pathname === '/health/nebula-arcade' ? '/health/ready' + url.search : req.url;
    const upstream = httpRequest({ hostname: '127.0.0.1', port: nebula ? nebulaPort : streamweaverPort, path, method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'app_unavailable', appId: nebula ? 'nebula-arcade' : 'streamweaver' }));
      } else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createNode2Ingress({ streamweaverPort: Number(process.env.STREAMWEAVER_WEB_PORT || 3202), nebulaPort: Number(process.env.NEBULA_ARCADE_PORT || 3100) });
  server.listen(Number(process.env.PORT || 8000), '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
}