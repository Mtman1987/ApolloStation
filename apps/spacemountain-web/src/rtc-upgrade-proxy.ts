import { request as httpRequest, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

/** Same-origin ingress for the room's authenticated WebSocket, including audio. */
export function attachHearMeOutRtcProxy(server: Server, originValue?: string) {
  const sockets = new Set<Duplex>();
  server.on('upgrade', (request, socket, head) => {
    try {
      const path = new URL(request.url || '/', 'http://rtc.local');
      if (!originValue || path.pathname !== '/api/hearmeout/rtc') { socket.destroy(); return; }
      if (!request.headers.origin || new URL(request.headers.origin).host !== request.headers.host) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
      }
      const target = new URL(originValue);
      if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error('RTC proxy target must be loopback');
      const upstream = httpRequest({ hostname: target.hostname.replace(/^\[|\]$/g, ''), port: Number(target.port || 80),
        path: path.pathname + path.search, headers: { ...request.headers, host: target.host, origin: target.origin },
      });
      sockets.add(socket);
      socket.once('close', () => { sockets.delete(socket); upstream.destroy(); });
      socket.on('error', () => upstream.destroy());
      upstream.once('upgrade', (response, peer, peerHead) => {
        upstream.setTimeout(0);
        sockets.add(peer);
        peer.once('close', () => { sockets.delete(peer); socket.destroy(); });
        peer.on('error', () => socket.destroy());
        socket.once('close', () => peer.destroy());
        const lines = ['HTTP/1.1 101 Switching Protocols'];
        for (let i = 0; i < response.rawHeaders.length; i += 2) lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
        socket.write(lines.join('\r\n') + '\r\n\r\n');
        if (peerHead.length) socket.write(peerHead);
        if (head.length) peer.write(head);
        socket.pipe(peer).pipe(socket);
      });
      upstream.once('response', response => {
        response.resume(); socket.end(`HTTP/1.1 ${response.statusCode || 502} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      });
      upstream.on('error', () => socket.destroy());
      upstream.setTimeout(10_000, () => upstream.destroy());
      upstream.end();
    } catch { socket.destroy(); }
  });
  return () => { for (const socket of sockets) socket.destroy(); sockets.clear(); };
}
