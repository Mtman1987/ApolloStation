import assert from "node:assert/strict";
import test from "node:test";
import { parseExecutionTargetV1 } from "../packages/contracts/dist/index.js";
import { StreamWeaverImageWorker } from "../apps/streamweaver/dist/image-worker.js";
import { StreamWeaverAvatarWorker } from "../apps/streamweaver/dist/avatar-worker.js";
import { DshSuiteActionWorker } from "../apps/discord-stream-hub/dist/suite-action-worker.js";
import { SimulationRoomWorker } from "../apps/chat-gateway/dist/simulation-runtime.js";
import { validateChatGatewayWorkerEnvironment } from "../apps/chat-gateway/dist/service.js";

test("shared execution target parser accepts hosted and rejects unknown providers", () => {
  assert.equal(parseExecutionTargetV1("hosted"), "hosted");
  assert.equal(parseExecutionTargetV1(undefined), "sprite");
  assert.throws(() => parseExecutionTargetV1("unknown", "sprite", "STELLAR_EXECUTION_TARGET"), /STELLAR_EXECUTION_TARGET is invalid/);
});

test("Chat Gateway validates and returns the shared hosted execution target", () => {
  const config = validateChatGatewayWorkerEnvironment({
    SPMT_ORIGIN: "http://127.0.0.1:3000",
    CHAT_GATEWAY_DATABASE_PATH: "/tmp/chat-gateway-hosted.sqlite",
    CHAT_GATEWAY_WORKER_CREDENTIAL: "chat-gateway-test-credential-123456",
    CHAT_GATEWAY_CONNECTIONS: "[]",
    STELLAR_EXECUTION_TARGET: "hosted",
  });
  assert.equal(config.executionTarget, "hosted");
});

test("Chat Gateway accepts credential-free remote HTTPS SPMT origins but rejects remote HTTP and URL credentials", () => {
  const base = {
    CHAT_GATEWAY_DATABASE_PATH: "/tmp/chat-gateway-hosted.sqlite",
    CHAT_GATEWAY_WORKER_CREDENTIAL: "chat-gateway-test-credential-123456",
    CHAT_GATEWAY_CONNECTIONS: "[]",
  };
  assert.equal(validateChatGatewayWorkerEnvironment({ ...base, SPMT_ORIGIN: "https://spmt.example" }).spmtOrigin, "https://spmt.example");
  assert.equal(validateChatGatewayWorkerEnvironment({ ...base, SPMT_ORIGIN: "http://127.0.0.1:3000" }).spmtOrigin, "http://127.0.0.1:3000");
  assert.throws(() => validateChatGatewayWorkerEnvironment({ ...base, SPMT_ORIGIN: "http://spmt.example" }), /HTTPS origin or loopback HTTP origin/);
  assert.throws(() => validateChatGatewayWorkerEnvironment({ ...base, SPMT_ORIGIN: "https://user:pass@spmt.example" }), /HTTPS origin or loopback HTTP origin/);
});

test("StreamWeaver image and avatar workers report and claim the configured hosted target", async () => {
  const calls = [];
  const client = {
    async reportExecutionWorker(input) { calls.push(["report", input]); },
    async claimAnyExecutionJob(workerId, target, options) { calls.push(["claim", workerId, target, options]); return null; },
  };
  await new StreamWeaverImageWorker(client, {}, { workerId: "hosted-image", modelNo: "", modelVerNo: "", executionTarget: "hosted" }).runOnce();
  await new StreamWeaverAvatarWorker(client, {}, { workerId: "hosted-avatar", executionTarget: "hosted", activate: async () => {} }).runOnce();
  assert.deepEqual(calls.filter(call => call[0] === "report").map(call => call[1].executionTarget), ["hosted", "hosted"]);
  assert.deepEqual(calls.filter(call => call[0] === "claim").map(call => call[2]), ["hosted", "hosted"]);
});

test("DSH suite-action and Simulation Room workers claim hosted jobs", async () => {
  const calls = [];
  const client = {
    async reportExecutionWorker(input) { calls.push(["report", input]); },
    async claimAnyExecutionJob(workerId, target, options) { calls.push(["claim", workerId, target, options]); return null; },
  };
  await new DshSuiteActionWorker(client, {}, { workerId: "hosted-dsh", tenantIds: ["tenant-a"], executionTarget: "hosted" }).runOnce();
  await new SimulationRoomWorker(client, {}, "hosted-simulation", "hosted").runOnce();
  assert.deepEqual(calls.filter(call => call[0] === "report").map(call => call[1].executionTarget), ["hosted", "hosted"]);
  assert.deepEqual(calls.filter(call => call[0] === "claim").map(call => call[2]), ["hosted", "hosted"]);
});
