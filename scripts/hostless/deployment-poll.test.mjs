import test from "node:test";
import assert from "node:assert/strict";
import { waitForHostlessDeployment } from "./deployment-poll.mjs";

test("Hostless deployment polling stops at the ten-minute default deadline", async () => {
  let clock = 0;
  let polls = 0;
  await assert.rejects(
    waitForHostlessDeployment({
      api: "https://api.hostless.invalid/v1",
      token: "test-token",
      app: "apollo-node-1",
      deploymentId: "deployment-test",
      fetchImpl: async () => {
        polls += 1;
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: "DEPLOYMENT_STARTED" }) };
      },
      now: () => clock,
      sleep: async milliseconds => { clock += milliseconds; },
      intervalMs: 60_000,
    }),
    error => error.status === "DEPLOYMENT_STARTED" && /600000ms/.test(error.message),
  );
  assert.equal(clock, 600_000);
  assert.equal(polls, 10);
});
