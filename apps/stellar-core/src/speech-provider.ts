import { createHash } from "node:crypto";
import { ATHENA_CANONICAL_TTS_VOICE, getTtsVoiceOption, TTS_VOICE_OPTIONS } from "./speech-voices.js";

export class StellarSpeechError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

/** Provider credentials stay in the worker. Failover never changes the selected speaker. */
export class StellarSpeechProvider {
  private readonly cooldowns = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: { deepgramKey?: string; edenKey?: string; enabled?: boolean; fetchImpl?: typeof fetch; now?: () => number }) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  configured() { return this.options.enabled !== false && Boolean(this.options.deepgramKey || this.options.edenKey); }
  voices() { return TTS_VOICE_OPTIONS.map(v => ({ id: v.id, label: v.label, provider: v.provider, description: v.description })); }
  async synthesize(text: string, voiceId = ATHENA_CANONICAL_TTS_VOICE, tenantId = "") {
    if (!this.configured()) throw new StellarSpeechError("Speech providers are not configured");
    text = boundedText(text, 20_000);
    const voice = getTtsVoiceOption(voiceId);
    if (!TTS_VOICE_OPTIONS.some(v => v.id === voiceId) && !["athena", "apollo", "odysseus", "theia"].includes(voiceId)) throw new StellarSpeechError("Choose a supported voice");
    const chunks = splitSpeech(text), output: Buffer[] = [], providers: string[] = [];
    for (const chunk of chunks) {
      const routes = voice.provider === "deepgram" ? ["deepgram", "edenai"] : ["edenai"];
      let audio: Buffer | undefined;
      for (const route of routes) {
        const key = route === "deepgram" ? this.options.deepgramKey : this.options.edenKey;
        if (!key) continue;
        const identity = `${tenantId}:${voice.id}:${route}:${createHash("sha256").update(key).digest("hex")}`;
        const now = this.options.now?.() ?? Date.now();
        if ((this.cooldowns.get(identity) ?? 0) > now) continue;
        try {
          if (route === "deepgram") {
            const response = await this.request(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice.deepgramModel!)}&encoding=mp3`, { method: "POST", headers: { authorization: `Token ${key}`, "content-type": "application/json" }, body: JSON.stringify({ text: chunk }) });
            audio = await audioBytes(response);
          } else {
            const deepgram = voice.provider === "deepgram";
            const response = await this.request(deepgram ? "https://api.edenai.run/v3/universal-ai" : "https://api.edenai.run/v2/audio/text_to_speech", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(deepgram ? { model: "audio/tts/deepgram/aura-2", input: { text: chunk, voice: voice.deepgramModel, audio_format: "mp3" } } : { providers: voice.edenaiProvider, language: "en", text: chunk, option: voice.edenaiOption, audio_format: "mp3", settings: { [voice.edenaiProvider]: voice.edenaiVoiceModel } }) });
            const result = await response.json() as Record<string, any>;
            if (deepgram && (result.status !== "success" || result.provider !== "deepgram")) throw new StellarSpeechError("Speech provider did not return the selected voice", true);
            const url = deepgram ? result.output?.audio_resource_url : result[voice.edenaiProvider]?.audio_resource_url;
            audio = await audioBytes(await this.request(providerMediaUrl(url), {}));
          }
          providers.push(route); this.cooldowns.delete(identity); break;
        } catch {
          this.cooldowns.set(identity, now + 30_000);
          if (this.cooldowns.size > 2000) for (const [id, expiry] of this.cooldowns) if (expiry <= now) this.cooldowns.delete(id);
        }
      }
      if (!audio) throw new StellarSpeechError("The selected voice is temporarily unavailable from its configured providers", true);
      output.push(audio);
      if (output.reduce((n, b) => n + b.length, 0) > 8 * 1024 * 1024) throw new StellarSpeechError("Speech audio exceeds the shared media limit");
    }
    return { bytes: Buffer.concat(output), contentType: "audio/mpeg", voice: voice.id, providers: [...new Set(providers)] };
  }
  async transcribe(bytes: Uint8Array, contentType: string) {
    if (!this.configured()) throw new StellarSpeechError("Speech providers are not configured");
    if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024 || !["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg"].includes(contentType)) throw new StellarSpeechError("Choose a supported recording up to 8 MiB");
    if (this.options.deepgramKey) {
      try {
        const response = await this.request("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", { method: "POST", headers: { authorization: `Token ${this.options.deepgramKey}`, "content-type": contentType }, body: new Blob([new Uint8Array(bytes)]) });
        const value = await response.json() as Record<string, any>;
        const transcription = boundedText(value.results?.channels?.[0]?.alternatives?.[0]?.transcript, 50_000);
        return { transcription, provider: "deepgram" };
      } catch { /* Eden may still accept this recording. */ }
    }
    if (!this.options.edenKey) throw new StellarSpeechError("Transcription is temporarily unavailable", true);
    const endpoint = "https://api.edenai.run/v2/audio/speech_to_text_async", headers = { authorization: `Bearer ${this.options.edenKey}` };
    const form = new FormData(); form.set("providers", "openai"); form.set("language", "en-US"); form.set("file", new Blob([new Uint8Array(bytes)], { type: contentType }), "recording");
    let value = await (await this.request(endpoint, { method: "POST", headers, body: form })).json() as Record<string, any>;
    const id = value.public_id ?? value.data?.public_id;
    for (let attempt = 0; attempt < 30; attempt++) {
      const results = value.results ?? value;
      const transcript = results.openai?.text ?? results.openai?.transcription ?? results.text;
      if (typeof transcript === "string" && transcript.trim()) return { transcription: boundedText(transcript, 50_000), provider: "edenai" };
      if (!id || /fail|error/i.test(String(value.status))) throw new StellarSpeechError("Transcription failed", true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      value = await (await this.request(`${endpoint}/${encodeURIComponent(String(id))}?response_as_dict=true`, { headers })).json() as Record<string, any>;
    }
    throw new StellarSpeechError("Transcription timed out", true);
  }
  private async request(url: string, init: RequestInit) {
    const response = await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new StellarSpeechError(`Speech provider returned HTTP ${response.status}`, response.status === 429 || response.status >= 500);
    return response;
  }
}
export function splitSpeech(text: string): string[] {
  const chunks: string[] = []; let remaining = text.trim();
  while (remaining.length > 1900) { let at = remaining.lastIndexOf(" ", 1900); if (at < 950) at = 1900; chunks.push(remaining.slice(0, at)); remaining = remaining.slice(at).trimStart(); }
  if (remaining) chunks.push(remaining); return chunks;
}
function boundedText(value: unknown, max: number) { if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new StellarSpeechError("Speech text is missing or too large"); return value.trim(); }
function providerMediaUrl(value: unknown) {
  if (typeof value !== "string") throw new StellarSpeechError("Speech provider returned no audio");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !/(?:^|\.)(?:edenai\.run|edenai\.co|amazonaws\.com|googleapis\.com|cloudfront\.net|azureedge\.net|blob\.core\.windows\.net)$/.test(url.hostname)) throw new StellarSpeechError("Speech provider returned an untrusted audio host");
  return url.toString();
}
async function audioBytes(response: Response) {
  if (!(response.headers.get("content-type") ?? "").startsWith("audio/")) throw new StellarSpeechError("Speech provider returned non-audio content");
  const reader = response.body?.getReader(); if (!reader) throw new StellarSpeechError("Speech provider returned empty audio");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 8 * 1024 * 1024) throw new StellarSpeechError("Speech audio is too large"); chunks.push(item.value); } } finally { await reader.cancel(); }
  if (!size) throw new StellarSpeechError("Speech provider returned empty audio");
  return Buffer.concat(chunks);
}
