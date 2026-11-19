import assert from "node:assert/strict";
import test from "node:test";
import { buildChatChainFromEnv, FallbackChatProvider, HostedChatCompletionsProvider, DEFAULT_CHAT_CHAIN } from "../apps/stellar-core/dist/chat-chain.js";
import { StellarProviderError } from "../apps/stellar-core/dist/worker.js";

const message = [{ role: "user", content: "hello" }];
const ok = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
const fail = (status) => new Response("nope", { status });

test("no keys means no chain, and missing slots are skipped without error", () => {
  const { chain, enabled } = buildChatChainFromEnv({});
  assert.equal(chain, undefined);
  assert.deepEqual(enabled, []);
});

test("only the configured slots are enabled, in default failover order", () => {
  const { enabled } = buildChatChainFromEnv({ GEMINI_API_KEY: "g", TOGETHER_API_KEY: "t" });
  assert.deepEqual(enabled, ["gemini", "together"]);
  assert.deepEqual(DEFAULT_CHAT_CHAIN, ["gemini", "openai", "together", "groq", "openrouter", "cloudflare"]);
});

test("Cloudflare needs both the token and the account id", () => {
  assert.deepEqual(buildChatChainFromEnv({ CLOUDFLARE_API_TOKEN: "x" }).enabled, []);
  assert.deepEqual(buildChatChainFromEnv({ CLOUDFLARE_API_TOKEN: "x", CLOUDFLARE_ACCOUNT_ID: "acct" }).enabled, ["cloudflare"]);
});

test("STELLAR_AI_CHAIN overrides the order and rejects unknown names", () => {
  const env = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q" };
  assert.deepEqual(buildChatChainFromEnv({ ...env, STELLAR_AI_CHAIN: "groq,gemini" }).enabled, ["groq", "gemini"]);
  assert.throws(() => buildChatChainFromEnv({ ...env, STELLAR_AI_CHAIN: "gemini,bogus" }), /unknown provider "bogus"/);
});

test("a failing provider falls through to the next and then cools down", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return url.includes("generativelanguage") ? fail(429) : ok("from groq"); };
  let now = 0;
  const gemini = new HostedChatCompletionsProvider({ name: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "g", model: "m", fetchImpl });
  const groq = new HostedChatCompletionsProvider({ name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "q", model: "m", fetchImpl });
  const chain = new FallbackChatProvider([{ name: "gemini", provider: gemini }, { name: "groq", provider: groq }], { cooldownMs: 60_000, now: () => now });

  const first = await chain.complete(message);
  assert.equal(first.text, "from groq");
  assert.equal(first.provider, "groq");
  assert.equal(calls.length, 2);

  now = 30_000;
  const second = await chain.complete(message);
  assert.equal(second.provider, "groq");
  assert.equal(calls.length, 3, "gemini is skipped during cooldown");

  now = 61_000;
  await chain.complete(message);
  assert.equal(calls.length, 5, "gemini is retried after cooldown");
});

test("all providers failing raises one retryable error without leaking keys", async () => {
  const fetchImpl = async () => fail(500);
  const provider = new HostedChatCompletionsProvider({ name: "together", baseUrl: "https://api.together.xyz/v1", apiKey: "SECRET-KEY-123", model: "m", fetchImpl });
  const chain = new FallbackChatProvider([{ name: "together", provider }]);
  await assert.rejects(chain.complete(message), (error) => {
    assert.ok(error instanceof StellarProviderError);
    assert.equal(error.retryable, true);
    assert.equal(String(error.message).includes("SECRET-KEY-123"), false);
    return true;
  });
});

test("a cut-off reply is treated as retryable so the next provider answers", async () => {
  const cut = async () => new Response(JSON.stringify({ choices: [{ message: { content: "The answer continues and" }, finish_reason: "length" }] }), { status: 200 });
  const full = async () => ok("Complete answer.");
  const a = new HostedChatCompletionsProvider({ name: "a", baseUrl: "https://a.example/v1", apiKey: "k", model: "m", fetchImpl: cut });
  const b = new HostedChatCompletionsProvider({ name: "b", baseUrl: "https://b.example/v1", apiKey: "k", model: "m", fetchImpl: full });
  const result = await new FallbackChatProvider([{ name: "a", provider: a }, { name: "b", provider: b }]).complete(message);
  assert.equal(result.provider, "b");
});
