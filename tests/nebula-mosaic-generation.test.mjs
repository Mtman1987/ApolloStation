import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createStreamWeaverMosaicGenerator } from "../apps/nebula-arcade/dist/mosaic-generation.js";
import { MOSAIC_CELL_COUNT } from "../apps/nebula-arcade/dist/mosaic-core.js";

test("Mosaic generator stays disabled without a service token and rejects unverified paid providers", () => {
  assert.equal(createStreamWeaverMosaicGenerator({ serviceToken: "" }), undefined);
  assert.throws(() => createStreamWeaverMosaicGenerator({ serviceToken: "test-token", provider: "openai" }), /potentially paid/);
});

test("Mosaic generator calls the configured free provider and quantizes image pixels to 2,000 cells", async () => {
  const png = await sharp({ create: { width: 80, height: 100, channels: 3, background: { r: 239, g: 68, b: 68 } } }).png().toBuffer();
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/api/ai/image")) return new Response(JSON.stringify({ ok: true, data: { persistedImageUrl: "https://streamweaver-new.fly.dev/mosaic.png", provider: "pollinations" } }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/mosaic.png")) return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    throw new Error("Unexpected test URL");
  };
  const generate = createStreamWeaverMosaicGenerator({ serviceToken: "test-token", streamWeaverUrl: "https://streamweaver-new.fly.dev", provider: "pollinations", fallbackProviders: [], fetchImpl });
  const result = await generate("red pixel dragon", { tenantId: "tenant-a", channel: "main" });
  assert.equal(result.provider, "pollinations");
  assert.equal(result.target.length, MOSAIC_CELL_COUNT);
  assert.equal(result.target.every((color) => color === "R"), true);
  assert.equal(requests.length, 2);
  const payload = JSON.parse(requests[0].init.body);
  assert.equal(payload.tenantId, "tenant-a");
  assert.equal(payload.providerOverride, "pollinations");
  assert.match(payload.prompt, /red pixel dragon/);
  assert.equal(requests[0].init.headers["x-bot-secret"], "test-token");
});

test("Mosaic generator rejects image URLs outside the HTTPS allowlist", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ ok: true, data: { persistedImageUrl: "https://evil.example/mosaic.png" } }), { status: 200, headers: { "content-type": "application/json" } });
  const generate = createStreamWeaverMosaicGenerator({ serviceToken: "test-token", provider: "pollinations", fallbackProviders: [], fetchImpl });
  await assert.rejects(() => generate("pixel fox", { tenantId: "tenant-a", channel: "main" }), /outside the configured HTTPS download allowlist/);
});
