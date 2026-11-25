import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import WebSocket from "ws";
import { createNode2Ingress, isHearMeOutPath, isNebulaPath } from "../scripts/hostless/node2-ingress.mjs";

test("Nebula ingress matcher includes app, API, and browser assets", () => {
  for (const path of ["/apps/nebula-arcade", "/api/nebula-arcade/health", "/v1/nebula/game-actions", "/assets/nebula-game-mix.js", "/assets/nebula/logo.svg"]) assert.equal(isNebulaPath(path), true, path);
  assert.equal(isNebulaPath("/assets/streamweaver/logo.svg"), false);
});

test("HearMeOut ingress matcher is limited to its app, API, and health paths", () => {
  for (const path of ["/apps/hearmeout", "/apps/hearmeout/room/abc", "/api/hearmeout/rooms", "/api/hearmeout/rtc", "/api/watch/search", "/api/internal/watch/search", "/health/hearmeout"]) {
    assert.equal(isHearMeOutPath(path), true, path);
  }
  for (const path of ["/", "/api/streamweaver", "/api/nebula-arcade", "/api/internal/lounge/media", "/health/ready", "/hearmeout"]) {
    assert.equal(isHearMeOutPath(path), false, path);
  }
});

test("Node 2 ingress forwards HearMeOut app and health requests to its own service", async (t) => {
  const seen = [];
  const hearMeOut = createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "hearmeout", path: req.url }));
  });
  hearMeOut.listen(0, "127.0.0.1");
  await once(hearMeOut, "listening");
  const hearMeOutPort = hearMeOut.address().port;
  const ingress = createNode2Ingress({ hearMeOutPort, streamweaverPort: 1, nebulaPort: 2 });
  ingress.listen(0, "127.0.0.1");
  await once(ingress, "listening");
  t.after(async () => {
    await new Promise(resolve => ingress.close(resolve));
    await new Promise(resolve => hearMeOut.close(resolve));
  });
  const port = ingress.address().port;
  const get = path => new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => body += chunk);
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on("error", reject).end();
  });
  const app = await get("/apps/hearmeout");
  assert.equal(app.status, 200);
  assert.equal(app.body.service, "hearmeout");
  assert.equal(app.body.path, "/apps/hearmeout");
  const health = await get("/health/hearmeout?check=ready");
  assert.equal(health.status, 200);
  assert.equal(health.body.path, "/health/ready?check=ready");
  assert.deepEqual(seen, ["/apps/hearmeout", "/health/ready?check=ready"]);
});

test("Node 2 ingress tunnels authenticated HearMeOut RTC WebSocket upgrades", { timeout: 8000 }, async () => {
  const upstreamSockets = new Set();
  const ingressSockets = new Set();
  const upstream = createNetServer(socket => {
    upstreamSockets.add(socket);
    socket.on("close", () => upstreamSockets.delete(socket));
    let handshake = "";
    let upgraded = false;
    socket.on("data", chunk => {
      if (upgraded) return;
      handshake += chunk.toString("latin1");
      if (!handshake.includes("\r\n\r\n")) return;
      const key = handshake.match(/sec-websocket-key:\s*([^\r\n]+)/i)?.[1]?.trim();
      if (!key) return socket.destroy();
      upgraded = true;
      const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
      socket.write(Buffer.concat([Buffer.from([0x81, 0x0b]), Buffer.from("rtc-through")]));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const ingress = createNode2Ingress({ hearMeOutPort: upstream.address().port, streamweaverPort: 1, nebulaPort: 2 });
  ingress.on("connection", socket => {
    ingressSockets.add(socket);
    socket.on("close", () => ingressSockets.delete(socket));
  });
  ingress.listen(0, "127.0.0.1");
  await once(ingress, "listening");
  const origin = "http://127.0.0.1:" + ingress.address().port;
  const client = new WebSocket(origin.replace("http:", "ws:") + "/api/hearmeout/rtc?roomId=room-a", { headers: { origin } });
  client.on("error", () => {});
  const messagePromise = once(client, "message");
  const waitFor = (promise, label) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 3000); })]).finally(() => clearTimeout(timer));
  };
  try {
    await waitFor(once(client, "open"), "RTC WebSocket handshake timed out");
    const [message] = await waitFor(messagePromise, "RTC WebSocket payload timed out");
    assert.equal(message.toString(), "rtc-through");
  } finally {
    client.terminate();
    for (const socket of ingressSockets) socket.destroy();
    for (const socket of upstreamSockets) socket.destroy();
    ingress.close();
    upstream.close();
  }
});
