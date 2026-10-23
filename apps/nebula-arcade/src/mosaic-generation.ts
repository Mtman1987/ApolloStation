import sharp from "sharp";
import { MOSAIC_COLORS, MOSAIC_HEIGHT, MOSAIC_WIDTH, type MosaicColorCode } from "./mosaic-core.js";
import type { MosaicGenerationResult, MosaicGenerator } from "./mosaic-runtime.js";

export type StreamWeaverMosaicGeneratorOptions = {
  serviceToken?: string;
  streamWeaverUrl?: string;
  provider?: string;
  fallbackProviders?: string[];
  fetchImpl?: typeof fetch;
};
const DEFAULT_STREAMWEAVER_URL = "https://streamweaver-new.fly.dev";
const VERIFIED_FREE_IMAGE_PROVIDERS = new Set(["pollinations"]);
const NEGATIVE_PROMPT = "unrelated subject, substituted subject, people, animals, collage, multiple main subjects, text, letters, numbers, UI, controls, grid labels, gradients, blur, watermark, logo";

function cleanTheme(theme: string): string {
  const subject = String(theme || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (subject.length < 2) throw new Error("Enter a subject for the Mosaic theme.");
  return subject;
}
function promptForTheme(theme: string): string {
  const subject = cleanTheme(theme);
  return [
    `PRIMARY SUBJECT — depict this exact subject clearly and literally: “${subject}”.`,
    "Make one finished collaborative pixel-art mosaic. The named subject must be the dominant, unmistakable subject and occupy most of the canvas.",
    "Do not reinterpret, replace, or omit the named subject. Do not introduce unrelated people, animals, characters, objects, or a collage.",
    "Portrait 4:5 composition, one centered subject, complete readable silhouette, generous dark background around the edges.",
    "Use only ten flat colors: red, blue, green, yellow, purple, orange, pink, white, black, and cyan.",
    "Large connected color regions, crisp hard edges, no gradients, no antialiasing, and no tiny isolated details.",
    "The artwork will be reduced to exactly 40 columns by 50 rows and split into four equal 20-by-25 work boards.",
    "ARTWORK ONLY. No grid lines, letters, numbers, captions, labels, frame, interface, logo, or watermark.",
  ].join(" ");
}
function unwrap(value: any): any { return value?.data && typeof value.data === "object" ? value.data : value; }
function hexRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}
const RGB_PALETTE = Object.entries(MOSAIC_COLORS).map(([code, value]) => ({ code: code as MosaicColorCode, rgb: hexRgb(value.hex) }));
function nearestColor(red: number, green: number, blue: number): MosaicColorCode {
  let closest = RGB_PALETTE[0]!;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of RGB_PALETTE) {
    const [r, g, b] = candidate.rgb;
    const distance = (red - r) ** 2 + (green - g) ** 2 + (blue - b) ** 2;
    if (distance < closestDistance) { closest = candidate; closestDistance = distance; }
  }
  return closest.code;
}
async function imageToTarget(bytes: Buffer): Promise<MosaicColorCode[]> {
  const { data, info } = await sharp(bytes).flatten({ background: "#111827" })
    .resize(MOSAIC_WIDTH, MOSAIC_HEIGHT, { fit: "cover", position: "centre", kernel: sharp.kernel.lanczos3 })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== MOSAIC_WIDTH || info.height !== MOSAIC_HEIGHT || info.channels < 3) throw new Error("Generated artwork could not be converted to a 40-by-50 Mosaic.");
  const target: MosaicColorCode[] = [];
  for (let index = 0; index < data.length; index += info.channels) target.push(nearestColor(data[index]!, data[index + 1]!, data[index + 2]!));
  if (target.length !== MOSAIC_WIDTH * MOSAIC_HEIGHT) throw new Error("Generated artwork did not produce exactly 2,000 cells.");
  return target;
}
function safeImageUrl(value: unknown, base: URL): URL {
  const url = new URL(String(value || ""), base);
  const configuredHosts = String(process.env.MOSAIC_IMAGE_DOWNLOAD_HOSTS || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  const allowedHosts = new Set([base.hostname.toLowerCase(), "image.pollinations.ai", ...configuredHosts]);
  if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.has(url.hostname.toLowerCase())) throw new Error("Generated Mosaic image URL is outside the configured HTTPS download allowlist.");
  return url;
}

export function createStreamWeaverMosaicGenerator(options: StreamWeaverMosaicGeneratorOptions = {}): MosaicGenerator | undefined {
  const serviceToken = String(options.serviceToken ?? process.env.MOSAIC_STREAMWEAVER_SERVICE_TOKEN ?? "").trim();
  if (!serviceToken) return undefined;
  const base = new URL(String(options.streamWeaverUrl ?? process.env.STREAMWEAVER_URL ?? DEFAULT_STREAMWEAVER_URL).replace(/\/$/, "") + "/");
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("StreamWeaver Mosaic URL must be a credential-free HTTPS origin.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const configuredProvider = String(options.provider ?? process.env.MOSAIC_IMAGE_PROVIDER ?? "pollinations").trim().toLowerCase();
  const configuredFallbacks = options.fallbackProviders ?? String(process.env.MOSAIC_IMAGE_FALLBACK_PROVIDERS || "pollinations").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const providers = [configuredProvider, ...configuredFallbacks].filter((provider, index, all) => provider && all.indexOf(provider) === index);
  const disallowed = providers.filter((provider) => !VERIFIED_FREE_IMAGE_PROVIDERS.has(provider));
  if (disallowed.length) throw new Error(`Unverified or potentially paid Mosaic image providers are disabled: ${disallowed.join(", ")}. Configure a verified free provider.`);

  return async (theme: string, context?: { tenantId: string; channel: string }): Promise<MosaicGenerationResult> => {
    const subject = cleanTheme(theme);
    const failures: string[] = [];
    for (const provider of providers) {
      try {
        const response = await fetchImpl(new URL("api/ai/image", base), {
          method: "POST", signal: AbortSignal.timeout(45_000),
          headers: { "Content-Type": "application/json", "x-mountainview-bridge": "1", Authorization: `Bearer ${serviceToken}`, "x-bot-secret": serviceToken },
          body: JSON.stringify({
            prompt: promptForTheme(subject), scope: "public", tenantId: String(process.env.MOSAIC_STREAMWEAVER_TENANT_ID || context?.tenantId || "spacemountainlive"),
            resolution: "1024x1024", numImages: 1, providerOverride: provider,
            providerParams: { quality: "low", seed: Math.floor(Math.random() * 2_147_483_646) + 1, negativePrompt: NEGATIVE_PROMPT },
          }),
        });
        const raw = await response.json().catch(() => null);
        const data = unwrap(raw);
        const candidate = [
          ...(Array.isArray(data?.persistedImageUrls) ? data.persistedImageUrls : []),
          ...(Array.isArray(data?.images) ? data.images : []), data?.persistedImageUrl, data?.image, data?.imageResourceUrl,
        ].map((item) => String(item || "").trim()).find(Boolean);
        if (!response.ok || raw?.ok === false || !candidate) throw new Error(String(raw?.error || data?.error || raw?.message || `No generated artwork (HTTP ${response.status}).`).slice(0, 240));
        const imageUrl = safeImageUrl(candidate, base);
        const imageResponse = await fetchImpl(imageUrl, { signal: AbortSignal.timeout(45_000) });
        if (!imageResponse.ok) throw new Error(`Generated Mosaic could not be downloaded (HTTP ${imageResponse.status}).`);
        const bytes = Buffer.from(await imageResponse.arrayBuffer());
        if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("Generated Mosaic image was empty or larger than 20 MB.");
        return { target: await imageToTarget(bytes), provider: String(data?.provider || provider), sourceImageUrl: imageUrl.toString() };
      } catch (error) {
        failures.push(`${provider}: ${error instanceof Error ? error.message : "provider unavailable"}`);
      }
    }
    throw new Error(`Mosaic image generation failed: ${failures.join(" | ")}`);
  };
}
