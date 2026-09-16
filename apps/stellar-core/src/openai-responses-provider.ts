import type { StellarChatCompletionV1, StellarChatMessageV1, StellarChatProviderV1 } from "./worker.js";
import { StellarProviderError } from "./worker.js";

/** Hosted inference adapter used when Green has no local llama.cpp/Qwen model.
 * It keeps the API key server-side and exposes only the existing Stellar job boundary. */
export class OpenAiResponsesChatProvider implements StellarChatProviderV1 {
  constructor(private readonly options: { apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    if (!options.apiKey.trim()) throw new Error("OPENAI_API_KEY is required for hosted Stellar inference");
  }

  async healthy() {
    // Do not spend tokens on readiness probes. Authentication/provider failures
    // are surfaced by the first real job and the worker reports that failure.
    return Boolean(this.options.apiKey.trim());
  }

  async complete(messages: StellarChatMessageV1[]): Promise<StellarChatCompletionV1> {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const input = messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role, content: message.content }));
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          ...(system ? { instructions: system } : {}),
          input,
          store: false,
          max_output_tokens: 1600,
          reasoning: { effort: "low" },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
      });
    } catch (error) {
      throw new StellarProviderError(error instanceof Error ? error.message : "Hosted inference request failed", true);
    }
    if (!response.ok) {
      throw new StellarProviderError(`Hosted inference returned ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500);
    }
    const body = await response.json() as {
      status?: string;
      output_text?: string;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = typeof body.output_text === "string" && body.output_text.trim()
      ? body.output_text.trim()
      : (body.output ?? []).flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text" && typeof part.text === "string").map((part) => part.text!.trim()).filter(Boolean).join("\n");
    if (!text) throw new StellarProviderError("Hosted inference returned no assistant text", true);
    return {
      text,
      ...(body.status ? { finishReason: body.status } : {}),
      usage: {
        ...(typeof body.usage?.input_tokens === "number" ? { inputTokens: body.usage.input_tokens } : {}),
        ...(typeof body.usage?.output_tokens === "number" ? { outputTokens: body.usage.output_tokens } : {}),
      },
    };
  }
}
