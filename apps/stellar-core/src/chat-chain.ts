import { StellarProviderError, type StellarChatCompletionV1, type StellarChatMessageV1, type StellarChatProviderV1, looksIncompleteCompletion } from "./worker.js";

/** Default failover order. Providers without a key are skipped, so adding a key later enables it with no code change. */
export const DEFAULT_CHAT_CHAIN = ["gemini", "openai", "together", "groq", "openrouter", "cloudflare"] as const;
export type ChatChainName = typeof DEFAULT_CHAT_CHAIN[number];

export interface NamedChatProvider { name: string; provider: StellarChatProviderV1; }

/** Hosted OpenAI-compatible chat-completions endpoint (Gemini, Together, Groq, OpenRouter, Cloudflare Workers AI). */
export class HostedChatCompletionsProvider implements StellarChatProviderV1 {
  constructor(private readonly options: { name: string; baseUrl: string; apiKey: string; model: string; headers?: Record<string, string>; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    if (!options.apiKey.trim()) throw new Error(`${options.name} API key is required`);
    if (!options.model.trim()) throw new Error(`${options.name} chat model is required`);
  }
  async healthy() { return true; }
  async complete(messages: StellarChatMessageV1[]): Promise<StellarChatCompletionV1> {
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json", ...this.options.headers },
        body: JSON.stringify({ model: this.options.model, messages, temperature: 0.4, max_tokens: 1_200, stream: false }),
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
      });
    } catch (error) { throw new StellarProviderError(`${this.options.name} request failed: ${error instanceof Error ? error.message : "network error"}`, true); }
    if (!response.ok) throw new StellarProviderError(`${this.options.name} returned ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500);
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new StellarProviderError(`${this.options.name} returned no assistant text`, true);
    const finishReason = typeof body.choices?.[0]?.finish_reason === "string" ? body.choices[0].finish_reason : undefined;
    // A cut-off reply is retryable so the chain moves on instead of returning half a sentence.
    if (looksIncompleteCompletion(text, finishReason)) throw new StellarProviderError(`${this.options.name} returned an incomplete response`, true);
    return { text: text.trim(), ...(finishReason ? { finishReason } : {}), usage: { inputTokens: typeof body.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : 0, outputTokens: typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : 0 } };
  }
}

/**
 * Tries providers in order. A failed provider goes on a short cooldown and the next one is tried.
 * Any provider failure (bad key, quota, outage, cut-off reply) moves on; the failed provider cools down for a minute.
 */
export class FallbackChatProvider implements StellarChatProviderV1 {
  private readonly cooldownUntil = new Map<string, number>();
  constructor(private readonly providers: NamedChatProvider[], private readonly options: { cooldownMs?: number; now?: () => number } = {}) {
    if (providers.length === 0) throw new Error("At least one chat provider is required");
  }
  names() { return this.providers.map(p => p.name); }
  async healthy() { return (await Promise.all(this.providers.map(p => p.provider.healthy()))).some(Boolean); }
  async complete(messages: StellarChatMessageV1[]): Promise<StellarChatCompletionV1> {
    const now = this.options.now?.() ?? Date.now();
    const failures: string[] = [];
    for (const { name, provider } of this.providers) {
      if ((this.cooldownUntil.get(name) ?? 0) > now) { failures.push(`${name} cooling down`); continue; }
      try {
        const result = await provider.complete(messages);
        this.cooldownUntil.delete(name);
        return { ...result, provider: name };
      } catch (error) {
        if (!(error instanceof StellarProviderError)) throw error;
        failures.push(error.message);
        this.cooldownUntil.set(name, now + (this.options.cooldownMs ?? 60_000));
      }
    }
    throw new StellarProviderError(`All chat providers failed: ${failures.join("; ")}`, true);
  }
}

type Env = Record<string, string | undefined>;

/**
 * Builds the chain from environment. Each slot is optional: no key means the slot is skipped.
 * `openAi` is the existing OpenAI Responses provider, passed in so this module stays independent of its key handling.
 */
export function buildChatChainFromEnv(env: Env, options: { openAi?: StellarChatProviderV1; fetchImpl?: typeof fetch; localProvider?: StellarChatProviderV1 } = {}): { chain: FallbackChatProvider | undefined; enabled: string[] } {
  const order = (env.STELLAR_AI_CHAIN ?? DEFAULT_CHAT_CHAIN.join(",")).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const providers: NamedChatProvider[] = [];
  const fetchImpl = options.fetchImpl;
  for (const name of order) {
    const provider = slotProvider(name, env, options.openAi, fetchImpl);
    if (provider) providers.push({ name, provider });
    else if (!(DEFAULT_CHAT_CHAIN as readonly string[]).includes(name)) throw new Error(`STELLAR_AI_CHAIN contains unknown provider "${name}"`);
  }
  if (options.localProvider) providers.push({ name: "local", provider: options.localProvider });
  return { chain: providers.length ? new FallbackChatProvider(providers) : undefined, enabled: providers.map(p => p.name) };
}

function slotProvider(name: string, env: Env, openAi: StellarChatProviderV1 | undefined, fetchImpl: typeof fetch | undefined): StellarChatProviderV1 | undefined {
  const key = (v: string) => env[v]?.trim() ?? "";
  switch (name) {
    case "openai": return openAi;
    case "gemini": return key("GEMINI_API_KEY") ? new HostedChatCompletionsProvider({ name, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: key("GEMINI_API_KEY"), model: env.GEMINI_CHAT_MODEL || "gemini-2.5-flash", ...(fetchImpl ? { fetchImpl } : {}) }) : undefined;
    case "together": return key("TOGETHER_API_KEY") ? new HostedChatCompletionsProvider({ name, baseUrl: "https://api.together.xyz/v1", apiKey: key("TOGETHER_API_KEY"), model: env.TOGETHER_CHAT_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo", ...(fetchImpl ? { fetchImpl } : {}) }) : undefined;
    case "groq": return key("GROQ_API_KEY") ? new HostedChatCompletionsProvider({ name, baseUrl: "https://api.groq.com/openai/v1", apiKey: key("GROQ_API_KEY"), model: env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile", ...(fetchImpl ? { fetchImpl } : {}) }) : undefined;
    case "openrouter": return key("OPENROUTER_API_KEY") ? new HostedChatCompletionsProvider({ name, baseUrl: "https://openrouter.ai/api/v1", apiKey: key("OPENROUTER_API_KEY"), model: env.OPENROUTER_CHAT_MODEL || "meta-llama/llama-3.3-70b-instruct:free", ...(fetchImpl ? { fetchImpl } : {}) }) : undefined;
    case "cloudflare": return key("CLOUDFLARE_API_TOKEN") && key("CLOUDFLARE_ACCOUNT_ID") ? new HostedChatCompletionsProvider({ name, baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(key("CLOUDFLARE_ACCOUNT_ID"))}/ai/v1`, apiKey: key("CLOUDFLARE_API_TOKEN"), model: env.CLOUDFLARE_CHAT_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", ...(fetchImpl ? { fetchImpl } : {}) }) : undefined;
    default: return undefined;
  }
}

