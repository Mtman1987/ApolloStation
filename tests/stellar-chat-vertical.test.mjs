import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { stellarCoreCatalogRegistration } from "../apps/stellar-core/dist/index.js";
import { StellarChatWorker } from "../apps/stellar-core/dist/worker.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

test("Stella uses one metered durable job path for hosted Qwen and eligible Companion routing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-stellar-vertical-"));
  const credential = "stellar-worker-test-credential-1234567890";
  const service = createSpmtService({ databasePath: join(directory, "stellar.sqlite"), webhookKey: Buffer.alloc(32, 4), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.test", stellarChatEnabled: true, stellarWorkerCredential: credential });
  try {
    service.control.registerApp(stellarCoreCatalogRegistration("https://spmt.test"));
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const registered = await fetch(`${baseUrl}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "stellar-user", displayName: "Stellar User", password: "correct-horse-battery-staple" }) });
    assert.equal(registered.status, 201);
    const account = await registered.json();
    const tenantId = account.tenantId, userId = account.profile.userId;
    service.control.installApp(tenantId, "stellar-core");
    const login = await fetch(`${baseUrl}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "stellar-user", password: "correct-horse-battery-staple" }) });
    assert.equal(login.status, 200);
    const session = await login.json();
    const user = new SpmtClient({ baseUrl, appId: "spacemountain", getAccessToken: () => session.tokens.accessToken });
    const workerToken = service.auth.issueServiceAccess("stellar-core", credential).accessToken;
    const workerClient = new SpmtClient({ baseUrl, appId: "stellar-core", getAccessToken: () => workerToken });
    await user.upsertStellarContext(tenantId, { kind: "preference", text: "The user prefers concise answers.", tags: ["style"] });
    const calls = [];
    const provider = { healthy: async () => true, complete: async (messages) => { calls.push(messages); return { text: "The durable Stellar path is working.", finishReason: "stop", usage: { inputTokens: 12, outputTokens: 7 } }; } };

    const hosted = await user.invokeCommunityAssistant(tenantId, { userId, message: "Is the new path working?", surface: "app", conversationId: "conversation-a", routingPreference: "automatic" }, "stellar-hosted-1");
    assert.equal(hosted.status, "accepted");
    assert.equal(hosted.executionTarget, "sprite");
    assert.equal(hosted.meteringTarget, "hosted");
    await new StellarChatWorker(workerClient, provider, { workerId: "stellar-sprite-test", executionTarget: "sprite" }).runOnce();
    const hostedJob = await user.getExecutionJob(tenantId, hosted.jobId);
    assert.equal(hostedJob.state, "succeeded", JSON.stringify(hostedJob.error));
    assert.equal(hostedJob.result.kind, "stellar-chat-result.v1");
    assert.equal(hostedJob.result.text, "The durable Stellar path is working.");
    assert.equal(hostedJob.requestedByType, "user");
    assert.equal(hostedJob.requestedById, userId);
    assert.match(calls[0][0].content, /persona-neutral/);
    assert.match(calls[0][0].content, /prefers concise answers/);
    assert.doesNotMatch(calls[0][0].content, /You are Athena/);
    assert.equal((await user.getPersonalUsage(tenantId)).resources.find((item) => item.resource === "ai-chat-requests").hosted, 1);

    const freeFallback = await user.invokeCommunityAssistant(tenantId, { userId, message: "Try local", surface: "app", conversationId: "conversation-a", routingPreference: "companion" }, "stellar-free-fallback-1");
    assert.equal(freeFallback.executionTarget, "sprite");
    assert.match(freeFallback.fallbackReason, /paid plan/);

    service.control.registerApp({ appId: "companion", name: "Companion", description: "Local execution", version: "1.0.0", launchUrl: "https://spmt.test/apps/companion", allowedScopes: [], surfaces: ["standalone"], status: "active" });
    service.control.installApp(tenantId, "companion");
    service.control.reportRuntimeState({ tenantId, appId: "companion", state: "ready", detail: "Local worker connected" });
    service.control.setEntitlement({ tenantId, appId: "stellar-core", key: "billing.plan", value: "pro" });
    const stableReplay = await user.invokeCommunityAssistant(tenantId, { userId, message: "Try local", surface: "app", conversationId: "conversation-a", routingPreference: "companion" }, "stellar-free-fallback-1");
    assert.equal(stableReplay.jobId, freeFallback.jobId);
    assert.equal(stableReplay.executionTarget, "sprite", "an idempotent retry keeps the originally resolved route even after eligibility changes");
    assert.equal(stableReplay.fallbackReason, freeFallback.fallbackReason);
    await assert.rejects(
      user.invokeCommunityAssistant(tenantId, { userId, message: "A different message", surface: "app", conversationId: "conversation-a", routingPreference: "companion" }, "stellar-free-fallback-1"),
      (error) => error?.status === 409 && /idempotency key was reused with different input/.test(error.responseBody),
    );
    const local = await user.invokeCommunityAssistant(tenantId, { userId, message: "Use Companion", surface: "app", conversationId: "conversation-b", routingPreference: "companion" }, "stellar-companion-1");
    assert.equal(local.executionTarget, "companion");
    assert.equal(local.meteringTarget, "companion");
    assert.equal(local.fallbackReason, undefined);
    await new StellarChatWorker(workerClient, provider, { workerId: "stellar-companion-test", executionTarget: "companion" }).runOnce();
    assert.equal((await user.getExecutionJob(tenantId, local.jobId)).state, "succeeded");
    const usage = await user.getPersonalUsage(tenantId);
    assert.equal(usage.plan.planId, "pro");
    assert.equal(usage.resources.find((item) => item.resource === "ai-chat-requests").companion, 1);
    assert.equal(usage.resources.find((item) => item.resource === "ai-chat-requests").percent, 0, "Companion use is visible but does not fill the hosted allowance bar");
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
