# AI API Round-Robin Carousel & Cascading Fallback Architecture

> **Status:** Saved for future evaluation. This is a proposal, not production code. Keep migration/porting work ahead of implementation. Review and adapt it to Apollo's existing provider routing, credential management, and request handling before integrating.

## Index & Table of Contents

1. **Section 1: Architecture Overview** — Core routing concepts (outer round-robin carousel, inner key carousel, cascading fallback, and monthly reset guardrails).
2. **Section 2: Step-by-Step Request Workflow** — Six-stage execution lifecycle from initializing the provider ring to handling `200 OK`, `429` cooldowns, and `503` exhaustion.
3. **Section 3: Provider Registry & Routing Implementation** — Complete JavaScript configuration and routing code with blank API key fields (`"").
   - *3.1 Provider Carousel Registry (`PROVIDERS`)* — Groq, Google, and Provider C definitions.
   - *3.2 Key Rotation Helper (`getNextApiKey`)* — Inner per-provider key carousel logic.
   - *3.3 Payload Normalizer (`buildRequest`)* — Schema translation for Google vs. OpenAI-compatible endpoints.
   - *3.4 Fallback Router (`sendWithFallback`)* — Carousel rotation, timeout handling, `Retry-After` cooldowns, and cascading retries.
4. **Section 4: Scaling & Quota Management for 1,000+ Users** — Guardrails for burn-rate alerts, per-user rate limits, caching, and adding extra providers.

### Quick Topic & Symbol Index

| Topic / Symbol | Section | Description |
| :--- | :--- | :--- |
| `429 Too Many Requests` | Section 2, Section 3.4 | Rate-limit detection, `Retry-After` parsing, and exponential backoff cooldowns |
| `503 Service Unavailable` | Section 2, Section 3.4 | Behavior when all three providers are in cooldown or exhausted |
| `apiKey` / `keys` (blank fields) | Section 3.1, Section 3.2 | Empty `""` placeholders for Groq, Google, and Provider C credentials |
| `buildRequest()` | Section 3.3 | Normalizes prompts into Google `generateContent` or OpenAI-compatible JSON |
| `carouselPtr` | Section 1, Section 2, Section 3.4 | Atomic top-level pointer rotating the starting provider slot (`% 3`) |
| `cooldownUntil` | Section 2, Section 3.1, Section 3.4 | Timestamp gate skipping rate-limited providers until their window expires |
| Daily Burn-Rate Alert | Section 4 | Monitoring `monthlyQuota / 30` to prevent mid-month exhaustion |
| `getNextApiKey()` | Section 3.2 | Optional inner key carousel for rotating multiple keys per provider |
| Google Gemini Endpoint | Section 3.1, Section 3.3 | `gemini-2.5-flash:generateContent` URL and payload structure |
| Groq Endpoint | Section 3.1, Section 3.3 | `api.groq.com` OpenAI-compatible chat completions setup |
| Monthly Reset Strategy | Section 1, Section 4 | Load distribution and per-user limits for 1,000+ active users |
| `PROVIDERS` | Section 3.1 | Ordered array defining Groq, Google, and Provider C slots |
| `provider_c` | Section 3.1 | Pluggable placeholder for the third AI coding platform |
| Response Caching | Section 4 | Deduplicating deterministic prompts to conserve free-tier quotas |
| `Retry-After` Header | Section 2, Section 3.4 | Dynamic cooldown calculation with 30s–600s exponential fallback |
| `sendWithFallback()` | Section 3.4 | Main request loop combining round-robin start selection and cascading retries |

---

## 1. Architecture Overview

This architecture combines a **top-level round-robin carousel** with a **cascading fallback loop** across three AI platforms (**Groq**, **Google**, and **Provider C**) to distribute load evenly, handle `HTTP 429` rate limits automatically, and prevent any single free-tier quota from exhausting mid-month.

### Core Mechanisms

- **Outer Round-Robin Carousel:** Rotates the starting provider slot (`carouselPtr = (carouselPtr + 1) % 3`) for every incoming request so traffic is spread evenly across Groq, Google, and Provider C instead of hitting one primary provider until it fails.
- **Inner Key Carousel (Optional):** Maintains a secondary rotation index per provider if multiple API keys or model variants are configured within the same platform.
- **Cascading Fallback:** If the selected starting provider returns `HTTP 429` (rate limit), `5xx` (transient server error), or times out, the router places that provider into a temporary cooldown and immediately retries the normalized request against the next healthy provider in the ring.
- **Quota & Monthly Reset Guardrails:** Tracks per-provider request/token counters and `Retry-After` cooldowns to warn you before all three free tiers saturate mid-month (especially important with 1,000+ active users).

---

## 2. Step-by-Step Request Workflow

1. **Initialize Provider Registry:** Load the ordered list of three providers (`groq`, `google`, `provider_c`), each with its endpoint URL, target model, empty `apiKey` slot (`""`), `cooldownUntil: 0`, and optional `keys` array.
2. **Advance the Carousel Pointer:** On each incoming request, atomically read and increment `carouselPtr = (carouselPtr + 1) % 3` to pick the starting slot (`startIndex`).
3. **Evaluate Provider Health:** Starting at `startIndex`, iterate through up to 3 slots (`(startIndex + attempt) % 3`). Skip any provider whose `cooldownUntil` timestamp is greater than the current time (`Date.now()`).
4. **Normalize & Dispatch Request:** Translate the application's unified prompt payload into the target provider's schema (OpenAI-compatible JSON for Groq and most third-party hosts; `generateContent` JSON for Google) and execute the HTTP call with a strict timeout.
5. **Handle Rate Limits & Transient Errors:**
   - **200 OK:** Reset any consecutive failure counter for that provider, log token/request usage, and return the normalized response.
   - **429 Too Many Requests / 5xx / Timeout:** Parse the `Retry-After` response header (defaulting to an exponential backoff window such as 30 seconds if missing), set `cooldownUntil = now + retryAfterMs`, and advance `attempt` to cascade to the next slot.
   - **400 / 401 / 403 Client Errors:** Do not cascade on malformed payloads or invalid credentials; surface the error immediately so configuration issues are caught early.
6. **Handle Total Exhaustion:** If all three providers are in cooldown or fail within the same request cycle, return a structured `503 Service Unavailable` with the per-provider failure reasons and earliest `cooldownUntil` timestamp.

---

## 3. Provider Registry & Routing Implementation

All API key fields are intentionally left blank (`""`) for you to populate via environment variables or a secrets manager.

### 3.1 Provider Carousel Registry (`PROVIDERS`)

```javascript
// Provider Carousel Registry (API keys intentionally left blank)
const PROVIDERS = [
  {
    name: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    apiKey: "",
    keys: ["", ""], // Optional inner key carousel
    keyIndex: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
  },
  {
    name: "google",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    model: "gemini-2.5-flash",
    apiKey: "",
    keys: ["", ""],
    keyIndex: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
  },
  {
    name: "provider_c",
    endpoint: "", // Add third AI platform endpoint URL
    model: "",    // Add third AI platform model ID
    apiKey: "",
    keys: ["", ""],
    keyIndex: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
  },
];

let carouselPtr = 0;
```

### 3.2 Key Rotation Helper (`getNextApiKey`)

```javascript
function getNextApiKey(provider) {
  if (Array.isArray(provider.keys) && provider.keys.length > 0) {
    const key = provider.keys[provider.keyIndex % provider.keys.length];
    provider.keyIndex = (provider.keyIndex + 1) % provider.keys.length;
    if (key) return key;
  }
  return provider.apiKey;
}
```

### 3.3 Payload Normalizer (`buildRequest`)

```javascript
function buildRequest(provider, promptPayload) {
  const apiKey = getNextApiKey(provider);

  if (provider.name === "google") {
    return {
      url: `${provider.endpoint}?key=${apiKey}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptPayload.prompt }] }],
        generationConfig: {
          temperature: promptPayload.temperature ?? 0.7,
          maxOutputTokens: promptPayload.maxTokens ?? 1024,
        },
      }),
    };
  }

  // OpenAI-compatible schema (Groq and standard third-party coding endpoints)
  return {
    url: provider.endpoint,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "user", content: promptPayload.prompt }],
      temperature: promptPayload.temperature ?? 0.7,
      max_tokens: promptPayload.maxTokens ?? 1024,
    }),
  };
}
```

### 3.4 Fallback Router (`sendWithFallback`)

```javascript
async function sendWithFallback(promptPayload) {
  const total = PROVIDERS.length;
  const startIndex = carouselPtr;
  carouselPtr = (carouselPtr + 1) % total;

  const now = Date.now();
  const errors = [];

  for (let attempt = 0; attempt < total; attempt++) {
    const idx = (startIndex + attempt) % total;
    const provider = PROVIDERS[idx];

    if (provider.cooldownUntil > now) {
      errors.push(`${provider.name}: in cooldown until ${new Date(provider.cooldownUntil).toISOString()}`);
      continue;
    }

    const req = buildRequest(provider, promptPayload);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        provider.consecutive429s = 0;
        const data = await res.json();
        return { provider: provider.name, data };
      }

      if (res.status === 429 || res.status >= 500) {
        provider.consecutive429s += 1;
        const retryHeader = Number(res.headers.get("retry-after"));
        const backoffSec = retryHeader > 0
          ? retryHeader
          : Math.min(30 * Math.pow(2, provider.consecutive429s - 1), 600);

        provider.cooldownUntil = Date.now() + backoffSec * 1000;
        errors.push(`${provider.name}: HTTP ${res.status} (cooldown ${backoffSec}s)`);
        continue;
      }

      throw new Error(`${provider.name}: non-retryable HTTP ${res.status}`);
    } catch (err) {
      if (err.name === "AbortError") {
        provider.cooldownUntil = Date.now() + 30000;
        errors.push(`${provider.name}: request timeout`);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`All providers exhausted: ${errors.join(" | ")}`);
}
```

---

## 4. Scaling & Quota Management for 1,000+ Users

Relying solely on free tiers across three platforms for over 1,000 users carries a risk of exhausting monthly or daily token quotas before the billing cycle resets. Add these guardrails to monitor capacity and prevent mid-month lockouts:

| Guardrail | Purpose | Implementation Detail |
| :--- | :--- | :--- |
| Daily Burn-Rate Alert | Detect mid-month exhaustion early | Track daily requests and tokens per provider; alert if daily usage exceeds `monthlyQuota / 30`. |
| Per-User Rate Limiting | Stop single users from draining shared pools | Apply a token-bucket limit per user ID before requests enter the provider carousel. |
| Response Caching | Reduce redundant API calls | Cache identical or deterministic coding prompts by hash in Redis or in-memory TTL store. |
| Provider Expansion | Increase aggregate headroom | Append a 4th or 5th OpenAI-compatible provider object to `PROVIDERS`; the `% total` math scales automatically. |

---

## 5. Integration Review — Deferred Until Porting Is Complete

This design is useful as a future reference, but it should not be integrated as-is. Before implementation, compare it with Apollo's existing AI/provider routing and make a migration-safe design.

### Required review and hardening

- **Reuse existing routing:** map the current Apollo AI request entrypoints and provider adapters; avoid creating a parallel router.
- **Provider inventory:** validate actual providers/models and available quota, latency, reliability, and acceptable data handling; Provider C remains undefined until selected.
- **Concurrency-safe rotation:** the global `carouselPtr` and per-provider `keyIndex` are not safe as shared mutable state in multi-process or concurrent deployments. Use an atomic/shared strategy or deterministic selection.
- **Credential handling:** use environment/secrets storage; never put keys in source, logs, request URLs, artifacts, or browser/client code. Google API key in query string is particularly easy to leak; prefer supported header authentication where available.
- **Retry classification:** do not treat every 5xx as identical. Retry only safe transient cases; distinguish malformed requests, auth/config errors, quota exhaustion, and provider outages. Ensure retrying is bounded.
- **Timeout cleanup:** clear timeout handles in a `finally` block and ensure aborted requests are handled consistently.
- **Retry-After parsing:** support both delta-seconds and HTTP-date forms; use a sensible bounded fallback.
- **Quota behavior:** free-tier quotas can be daily, per-minute, per-model, or project-level; `monthlyQuota / 30` is only a rough estimate and not a reliable enforcement policy. Do not rotate multiple keys to bypass provider terms or quota controls.
- **Data/privacy:** only fail over to providers approved for the request's data classification; redact prompts and tokens from telemetry.
- **Caching:** only cache when the request is safe and cacheable; key by model, prompt/system context, user/tenant permissions, and relevant parameters; do not leak cross-user private responses.
- **User fairness:** rate limits and quotas should be explicit, configurable, and disclosed—not silently imposed.
- **Observability:** track per-provider success/error, latency, retry count, token usage, cooldown, and quota signals without secrets or prompt content.
- **Testing:** unit tests for rotation, cooldown, retry classification, concurrency, timeouts, provider schema normalization, key selection, and total exhaustion; integration tests with mocked providers.
- **Acceptance:** a feature flag and rollback path; migration and porting work remains the priority until explicitly re-opened.

## Source

Original Library document: **Ai Api Fallback Architecture (2).md** (added 2026-11-23).
