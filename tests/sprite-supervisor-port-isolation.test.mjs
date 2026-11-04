import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import test from "node:test";
import { isolatedSupervisorArguments } from "../scripts/sprites/supervisor-test-port-isolation.mjs";

const preload = readFileSync(new URL("../scripts/sprites/supervisor-test-port-isolation.mjs", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url), "utf8");

test("protected Sprite validation isolates only nested supervisor app ports", () => {
  assert.match(preload, /run-supervised-sandbox\.mjs/);
  for (const flag of ["hearmeout-web-port", "dsh-web-port", "streamweaver-web-port", "mountainview-web-port", "companion-web-port"]) assert.match(preload, new RegExp(`--${flag}`));
  assert.doesNotMatch(preload, /--spmt-port|--web-port|--nebula-arcade-port/);
  assert.match(deploy, /NODE_OPTIONS="--import=\$release_dir\/scripts\/sprites\/supervisor-test-port-isolation\.mjs"/);
  assert.doesNotMatch(deploy, /cohort_quiesced|Validation failed while the previous supervised cohort was quiesced/);
});

test("supervisor fixture ports avoid occupied listeners and the host ephemeral range", async () => {
  const original = ["node", "run-supervised-sandbox.mjs", "--dsh-web-port", "3201"];
  const first = await isolatedSupervisorArguments(original);
  const occupiedPort = Number(first[first.indexOf("--hearmeout-web-port") + 1]);
  const occupied = createServer(), probes = [];
  const listen = (server, port) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const close = server => new Promise(resolve => server.close(resolve));
  try {
    await listen(occupied, occupiedPort);
    const args = await isolatedSupervisorArguments(original);
    assert.deepEqual(args.slice(0, original.length), original, "Explicit ports remain unchanged");
    const assigned = args.slice(original.length).filter((_, index) => index % 2 === 1).map(Number);
    assert.equal(assigned.length, 4);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.ok(!assigned.includes(occupiedPort), "An occupied candidate must be skipped");
    const [low, high] = process.platform === "linux" ? readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/).map(Number) : [32768, 65535];
    for (const port of assigned) {
      assert.ok(port < low || port > high, "Automatic sockets cannot claim a selected fixture port");
      const probe = createServer(); probes.push(probe);
      await listen(probe, port); // Allocation releases every reservation for the app children.
    }
  } finally { await Promise.all([occupied, ...probes].map(close)); }
});
