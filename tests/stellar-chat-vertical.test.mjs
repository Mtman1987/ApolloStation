import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";
import { stellarCoreCatalogRegistration } from "../apps/stellar-core/dist/index.js";
import { StellarChatWorker, StellarProviderError } from "../apps/stellar-core/dist/worker.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

test("Stella uses one metered durable job path for hosted Qwen and eligible Companion routing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-stellar-vertical-"));
  const credential = "stellar-worker-test-credential-1234567890";
  const service = createSpmtService({ databasePath: join(directory, "stellar.sqlite"), webhookKey: Buffer.alloc(32, 4), host: "127.0.0.1", port: 0, publicBaseUrl: "https://spmt.test", stellarChatEnabled: true, stellarWorkerCredential: credential });
  try {
    service.control.registerApp(stellarCoreCatalogRegistration("https://stellar.spacemountain.live/"));
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
    const startedAt = new Date().toISOString();
    await workerClient.reportExecutionWorker({ executionOwner: "stellar-core", workerId: "stellar-sprite-test", executionTarget: "sprite", state: "ready", capabilityIds: ["stellar-core.ai-chat.v1"], providerHealthy: true, startedAt, metrics: { coldStartMs: 1250, completedJobs: 0, failedJobs: 0, inputUnits: 0, outputUnits: 0, memoryRssBytes: 2_000_000_000 } });
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

    const ephemeralTurn = await user.invokeCommunityAssistant(tenantId, { userId, message: "Do not remember this turn", surface: "app", conversationId: "conversation-a", routingPreference: "hosted", remember: false }, "stellar-ephemeral-1");
    await new StellarChatWorker(workerClient, provider, { workerId: "stellar-ephemeral-test", executionTarget: "sprite" }).runOnce();
    assert.equal((await user.getExecutionJob(tenantId, ephemeralTurn.jobId)).input.remember, false);
    assert.equal(calls[1].some((message) => /Is the new path working\?|durable Stellar path is working/.test(message.content)), false, "do-not-remember turns do not load conversation history");

    const failure = await user.invokeCommunityAssistant(tenantId, { userId, message: "Prove provider failure", surface: "app", conversationId: "conversation-failure", routingPreference: "hosted" }, "stellar-hosted-failure-1");
    const failingWorker = new StellarChatWorker(workerClient, { healthy: async () => true, complete: async () => { throw new StellarProviderError("provider temporarily unavailable", true); } }, { workerId: "stellar-failure-test", executionTarget: "sprite" });
    await failingWorker.runOnce();
    const failedJob = await user.getExecutionJob(tenantId, failure.jobId);
    assert.equal(failedJob.state, "queued");
    assert.equal(failedJob.error.retryable, true);
    assert.equal(failingWorker.metrics().failedJobs, 1);

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
    const staleLocal = await user.invokeCommunityAssistant(tenantId, { userId, message: "Do not trust only the app status", surface: "app", conversationId: "conversation-b", routingPreference: "companion" }, "stellar-companion-stale-1");
    assert.equal(staleLocal.executionTarget, "sprite", "a Companion app status without an authenticated live worker must fall back");
    assert.match(staleLocal.fallbackReason, /not connected and ready/);
    await workerClient.reportExecutionWorker({ executionOwner: "stellar-core", workerId: "stellar-companion-test", executionTarget: "companion", state: "ready", capabilityIds: ["stellar-core.ai-chat.v1"], tenantIds: [tenantId], providerHealthy: true, startedAt, metrics: { coldStartMs: 800, completedJobs: 0, failedJobs: 0, inputUnits: 0, outputUnits: 0 } });
    const beforeLocalUsage = (await user.getPersonalUsage(tenantId)).resources.find((item) => item.resource === "ai-chat-requests");
    const local = await user.invokeCommunityAssistant(tenantId, { userId, message: "Use Companion", surface: "app", conversationId: "conversation-b", routingPreference: "companion" }, "stellar-companion-1");
    assert.equal(local.executionTarget, "companion");
    assert.equal(local.meteringTarget, "companion");
    assert.equal(local.fallbackReason, undefined);
    await new StellarChatWorker(workerClient, provider, { workerId: "stellar-companion-test", executionTarget: "companion" }).runOnce();
    assert.equal((await user.getExecutionJob(tenantId, local.jobId)).state, "succeeded");
    const usage = await user.getPersonalUsage(tenantId);
    assert.equal(usage.plan.planId, "pro");
    assert.equal(usage.resources.find((item) => item.resource === "ai-chat-requests").companion, 1);
    assert.equal(usage.resources.find((item) => item.resource === "ai-chat-requests").hosted, beforeLocalUsage.hosted, "Companion use does not increase hosted consumption");
    assert.equal(usage.resources.find((item) => item.resource === "ai-chat-requests").percent, beforeLocalUsage.percent, "Companion use is visible but does not fill the hosted allowance bar");
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
