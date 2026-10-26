import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const apiKey = process.env.STREAMWEAVER_KEENTOOLS_API_KEY_SECOND;
if (!apiKey) throw new Error("Repository secret STREAMWEAVER_KEENTOOLS_API_KEY_SECOND is missing.");

const refs = [
  ["01_front.png", "2332fd678836f3d3c99a3a9f7676c312fbcaf386565ef3418503c7b2aef41787"],
  ["02_front_left_45.png", "9020e1f6f223f5bcc37b4d09970f5558fe05fbea5c661f11308df9564dd20739"],
  ["03_front_right_45.png", "655d7eb3912a8387d52925f38f8670dcacefa5f57ed20e7788674d4df885cd88"],
  ["04_left_profile.png", "a6aabc95ce1e30f7b94da4627e691f94d734404e3e3fbd0ad5dbbd89ed5dfa01"],
  ["05_right_profile.png", "ff9dd763c045b7df009eeb54be51bf66e993ce3c5f65532d53e849ed015563b3"],
  ["06_back.png", "684b4557317e67f0be165afe96604151665a66ba91651153389c19246c01b690"],
  ["07_back_left_45.png", "53e660e26830bde93ee135ec380cbaeb9e3f738691eca512be447706ebbbcf3e"],
  ["08_back_right_45.png", "8823fe4106eaa439b2d933d2099949de4f728fe0b2a88ff1fe2b84561553704e"],
  ["09_top_of_head.png", "da3e748876edf30db2efd8e116ebbd092560be8bb220c26c08f8388fc758014a"],
  ["10_lower_face_jaw_detail.png", "4d453c304c9b527d2da68a7f42489e1e5dcb31dab7911ffa381f02987b5f670c"],
];

const dir = resolve("head_reference_renders_relit");
const images = [];
for (const [name, expected] of refs) {
  let bytes;
  try { bytes = await readFile(join(dir, name)); }
  catch { throw new Error(`Approved reference missing: ${dir}/${name}. Refusing to call KeenTools.`); }
  if (bytes.length < 1000 || bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Reference ${name} is not a valid PNG or has an invalid size. Refusing to call KeenTools.`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`Reference checksum mismatch for ${name}; this is not the approved relit image. Refusing to call KeenTools.`);
  images.push({ name, bytes });
}
console.log("Preflight passed: exact ten approved relit PNGs and SHA-256 checksums verified.");

const headers = (json = false) => ({
  authorization: `Bearer ${apiKey}`,
  ...(json ? { "content-type": "application/json" } : {}),
});
async function api(url, init = {}) {
  const response = await fetch(url, {
    ...init, headers: { ...headers(Boolean(init.body)), ...(init.headers || {}) },
    redirect: "error", signal: AbortSignal.timeout(180000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`KeenTools API HTTP ${response.status}: ${String(data.detail ?? data.message ?? "request failed").slice(0, 250)}`);
  return data;
}
function signedUrl(value) {
  const u = new URL(String(value ?? ""));
  if (u.protocol !== "https:" || u.username || u.password ||
      !/^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname.toLowerCase()) ||
      u.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
      !u.searchParams.has("X-Amz-Credential") || !u.searchParams.has("X-Amz-Signature")) {
    throw new Error("KeenTools returned an invalid signed URL.");
  }
  return u.toString();
}

// No API call that creates a reconstruction occurs before every approved image is verified.
const init = await api("https://api.keentools.io/v1/avatar/init", {
  method: "POST", body: JSON.stringify({ image_count: images.length }),
});
const avatarId = String(init.avatar_id ?? "");
if (!/^[A-Za-z0-9_-]{4,160}$/.test(avatarId) || !Array.isArray(init.img_urls) || init.img_urls.length !== images.length) {
  throw new Error("KeenTools returned invalid initialization data.");
}
await Promise.all(init.img_urls.map(async (raw, i) => {
  const response = await fetch(signedUrl(raw), {
    method: "PUT", headers: { "content-type": "image/png" }, body: images[i].bytes,
    redirect: "error", signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`KeenTools image upload ${i + 1} failed (HTTP ${response.status}).`);
}));
await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/process`, {
  method: "POST", body: JSON.stringify({ expressions_enabled: true, focal_length_type: { focal_length_type: "estimate_common" } }),
});
let complete = false;
for (let i = 0; i < 180; i++) {
  const status = await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-status`);
  if (status.status === "completed") { complete = true; break; }
  if (status.status === "failed" || status.status === "deleted") throw new Error(`KeenTools processing failed: ${String(status.data?.error_message ?? status.status).slice(0, 250)}`);
  await new Promise(r => setTimeout(r, 2000));
}
if (!complete) throw new Error("KeenTools reconstruction timed out after six minutes.");
const query = new URLSearchParams({ mesh_format: "glb", mesh_lod: "high_poly", blendshapes: "arkit,expression", texture: "png", edges: "false" });
let glb;
for (let i = 0; i < 30; i++) {
  const result = await api(`https://api.keentools.io/v1/avatar/${encodeURIComponent(avatarId)}/get-3d-model?${query}`);
  if (result.event === "redirect") {
    const response = await fetch(signedUrl(result.data?.url), { redirect: "error", signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`GLB download failed (HTTP ${response.status}).`);
    glb = new Uint8Array(await response.arrayBuffer());
    if (glb.byteLength < 20 || glb.byteLength > 64 * 1024 * 1024 || String.fromCharCode(...glb.slice(0, 4)) !== "glTF") throw new Error("Downloaded file is not a valid-size GLB.");
    break;
  }
  if (result.event !== "retry-after") throw new Error("KeenTools returned an unexpected model-download response.");
  await new Promise(r => setTimeout(r, Math.max(1, Math.min(60, Number(result.data?.time_sec) || 2)) * 1000));
}
if (!glb) throw new Error("KeenTools model download timed out.");
const out = resolve("keentools-output");
await mkdir(out, { recursive: true });
await writeFile(join(out, "Neon_Lock_In_Gamer_Head.glb"), glb);
await writeFile(join(out, "result.txt"), `KeenTools avatar ID: ${avatarId}\nModel: Neon_Lock_In_Gamer_Head.glb\nBytes: ${glb.byteLength}\nReference views: 10 approved relit PNGs; filenames and SHA-256 hashes verified before API use.\nStandalone head reconstruction only. No Fly.io deployment performed.\n`);
console.log(`KeenTools reconstruction complete. GLB size: ${glb.byteLength} bytes. Avatar ID: ${avatarId}`);
