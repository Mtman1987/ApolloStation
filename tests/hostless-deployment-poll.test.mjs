import assert from "node:assert/strict";
import test from "node:test";
import { HostlessDeploymentPollError, waitForHostlessDeployment } from "../scripts/hostless/deployment-poll.mjs";

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const base = {
  api: "https://api.hostless.cloud/v1/",
  token: "existing-hostless-token",
  app: "apollo-node-1",
  deploymentId: "deployment-123",
  timeoutMs: 100,
  intervalMs: 10,
};

test("Hostless deployment polling retries transient API errors and confirms the exact deployment", async () => {
  let now = 0;
  let calls = 0;
  const urls = [];
  const statuses = [];
  const result = await waitForHostlessDeployment({
    ...base,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    onStatus: (status) => statuses.push(status),
    fetchImpl: async (url, init) => {
      calls += 1;
      urls.push(String(url));
      assert.equal(new Headers(init.headers).get("authorization"), base.token);
      if (calls === 1) return response({ message: "temporary outage" }, 503);
      if (calls === 2) return response({ status: "DEPLOYMENT_IN_PROGRESS" });
      return response({ status: "DEPLOYMENT_SUCCESSFUL", id: base.deploymentId });
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.status, "deployment_successful");
  assert.equal(result.deployment.id, base.deploymentId);
  assert.deepEqual(statuses, ["deployment_in_progress", "deployment_successful"]);
  assert.ok(urls.every((url) => url === "https://api.hostless.cloud/v1/apps/apollo-node-1/deployments/deployment-123"));
});

test("Hostless deployment polling stops immediately when the deployment itself failed", async () => {
  let calls = 0;
  await assert.rejects(
    waitForHostlessDeployment({
      ...base,
      fetchImpl: async () => {
        calls += 1;
        return response({ status: "DEPLOYMENT_FAILED" });
      },
    }),
    (error) => error instanceof HostlessDeploymentPollError && error.status === "deployment_failed",
  );
  assert.equal(calls, 1);
});

test("Hostless deployment polling bounds repeated network timeouts and reports the last status", async () => {
  let now = 0;
  let calls = 0;
  await assert.rejects(
    waitForHostlessDeployment({
      ...base,
      timeoutMs: 25,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
      fetchImpl: async () => {
        calls += 1;
        throw new Error("Hostless API unavailable");
      },
    }),
    (error) => error instanceof HostlessDeploymentPollError
      && error.status === "unknown"
      && /last API error: Hostless API unavailable/.test(error.message),
  );
  assert.equal(calls, 3);
});

test("Hostless release uses API polling when the CLI wait does not confirm a deployment", async () => {
  const fs = await import("node:fs");
  const script = fs.readFileSync(new URL("../scripts/hostless/ensure-node-app.mjs", import.meta.url), "utf8");
  assert.match(script, /waitForHostlessDeployment\(/);
  assert.match(script, /--timeout", "60"/);
  assert.match(script, /checking the exact deployment through the Hostless API/);
});
