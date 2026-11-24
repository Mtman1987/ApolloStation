import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { createNode2Ingress, isHearMeOutPath } from "../scripts/hostless/node2-ingress.mjs";

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

test("Node 2 ingress tunnels authenticated HearMeOut RTC WebSocket upgrades", async () => {
  const upstream = createServer();
  const sockets = new WebSocketServer({ noServer: true });
  upstream.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://localhost").pathname !== "/api/hearmeout/rtc") return socket.destroy();
    sockets.handleUpgrade(req, socket, head, ws => ws.send("rtc-through"));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const ingress = createNode2Ingress({ hearMeOutPort: upstream.address().port, streamweaverPort: 1, nebulaPort: 2 });
  ingress.listen(0, "127.0.0.1");
  await once(ingress, "listening");
  const origin = "http://127.0.0.1:" + ingress.address().port;
  const client = new WebSocket(origin.replace("http:", "ws:") + "/api/hearmeout/rtc?roomId=room-a", { headers: { origin } });
  try {
    await once(client, "open");
    const [message] = await once(client, "message");
    assert.equal(message.toString(), "rtc-through");
  } finally {
    client.close();
    await once(client, "close").catch(() => {});
    await new Promise(resolve => ingress.close(resolve));
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
  }
});
