import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deployScript = readFileSync(new URL("../scripts/hostless/ensure-node-app.mjs", import.meta.url), "utf8");
const hostlessConfig = readFileSync(new URL("../hostless.yaml", import.meta.url), "utf8");

test("Hostless deployment tracking uses the deployment API and terminal states", () => {
  assert.match(deployScript, /\/apps\/\$\{encodeURIComponent\(appName\)\}\/deployments/);
  assert.match(deployScript, /method: "POST"/);
  assert.match(deployScript, /DEPLOYMENT_SUCCESSFUL/);
  assert.doesNotMatch(deployScript, /\["deploy", "--wait", "--timeout", "1800"/);
  assert.match(deployScript, /after 20 minutes/);
});

test("Hostless readiness probes use the documented 10-second interval", () => {
  assert.match(hostlessConfig, /interval_in_seconds: 10\b/);
  assert.doesNotMatch(hostlessConfig, /interval_in_seconds: 30\b/);
});
