import {readFile, writeFile, mkdir} from "node:fs/promises";
import {resolve, join} from "node:path";
import {randomUUID} from "node:crypto";

const apiKey = process.env.STREAMWEAVER_KEENTOOLS_API_KEY_SECOND;
if (!apiKey) throw new Error("Repository secret STREAMWEAVER_KEENTOOLS_API_KEY_SECOND is missing.");

const manifest = JSON.parse(await readFile(".github/data/keentools-discord-reference-upload.json", "utf8"));
const selected = [
  "01_front.png","02_front_threequarter_left.png","03_left.png",
  "07_right.png","08_front_threequarter_right.png","09_front_high.png","10_front_low.png"
];
const attachments = (manifest.messages ?? []).flatMap(m => m.attachments ?? []);
const byName = new Map(attachments.map(a => [a.filename, a.url]));
if (attachments.length !== 10 || attachments.some(a => !a.filename || !a.url) || selected.some(name => !byName.has(name))) {
  throw new Error("Discord CDN manifest must contain the ten source images and all seven selected facial views.");
}
function cdnUrl(value) {
  const u = new URL(String(value ?? ""));
  if (u.protocol !== "https:" || !["cdn.discordapp.com","media.discordapp.net"].includes(u.hostname.toLowerCase()) || u.username || u.password) {
    throw new Error("Reference image URL is not an HTTPS Discord CDN URL.");
  }
  return u;
}
const photos = await Promise.all(selected.map(async name => {
  const response = await fetch(cdnUrl(byName.get(name)), {redirect:"follow", signal:AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Discord CDN download for ${name} failed (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error(`Reference ${name} is empty or exceeds KeenFace's 64 MiB image limit.`);
  return {name, bytes, type:"image/png"};
}));

const base = "https://api.keenface.ai/v2";
const requestId = randomUUID();
async function api(path, init={}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {authorization:`Bearer ${apiKey}`, ...(init.headers ?? {})},
    redirect:"error",
    signal:AbortSignal.timeout(660000)
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) {
    const err = data.error ?? {};
    const safeMessage = String(err.message ?? err.code ?? data.message ?? "request failed").slice(0,250);
    const requestRef = err.request_id ? `; request_id=${String(err.request_id).slice(0,100)}` : "";
    throw new Error(`KeenFace API HTTP ${response.status}: ${safeMessage}${requestRef}`);
  }
  return data;
}

// The Discord images are deliberately captured multi-angle views, so use Scan Reconstruction.
// The v2 API takes photo bytes directly (not presigned S3 URLs) and starts processing at head creation.
const form = new FormData();
for (const photo of photos) {
  form.append("photos", new Blob([photo.bytes], {type:photo.type}), photo.name);
}
form.append("scan_reconstruction", "true");
form.append("texture", "pbr");
form.append("cleanup", "true");
form.append("focal_length", "auto");
const created = await api("/heads?wait=0", {
  method:"POST",
  headers:{"Idempotency-Key":requestId},
  body:form
});
const headId = String(created.id ?? "");
if (!/^[A-Za-z0-9_-]{4,160}$/.test(headId)) {
  throw new Error("KeenFace returned no valid head ID: " + JSON.stringify({status:created.status,error:created.error}).slice(0,400));
}
console.log(`KeenFace accepted head ${headId}; initial status=${String(created.status)}`);
let head = created;
for (let i=0; i<90; i++) {
  if (head.status === "completed") break;
  if (head.status === "failed" || head.status === "deleted") {
    const e = head.error ?? {};
    throw new Error(`KeenFace reconstruction ${head.status}: ${String(e.code ?? "unknown")} — ${String(e.message ?? "no error detail").slice(0,300)}${e.request_id ? `; request_id=${e.request_id}` : ""}`);
  }
  await new Promise(r => setTimeout(r, 5000));
  head = await api(`/heads/${encodeURIComponent(headId)}`);
}
if (head.status !== "completed") throw new Error(`KeenFace head ${headId} did not complete within 7.5 minutes; last status=${String(head.status)}. It can be resumed by polling this head ID.`);

const modelQuery = new URLSearchParams({mesh_format:"glb",texture:"png",blendshapes:"arkit"});
let glb;
for (let i=0; i<10; i++) {
  const result = await api(`/heads/${encodeURIComponent(headId)}/model?${modelQuery}`);
  if (result.event === "redirect") {
    const downloadUrl = new URL(String(result.data?.url ?? ""));
    if (downloadUrl.protocol !== "https:" || downloadUrl.username || downloadUrl.password) throw new Error("KeenFace returned an invalid model download URL.");
    const response = await fetch(downloadUrl, {redirect:"error", signal:AbortSignal.timeout(180000)});
    if (!response.ok) throw new Error(`GLB download failed (HTTP ${response.status}).`);
    glb = new Uint8Array(await response.arrayBuffer());
    if (glb.byteLength < 20 || glb.byteLength > 128*1024*1024 || String.fromCharCode(...glb.slice(0,4)) !== "glTF") throw new Error("Downloaded file is not a valid-size GLB.");
    break;
  }
  if (result.event !== "retry-after") throw new Error("KeenFace returned an unexpected model response: " + JSON.stringify(result).slice(0,400));
  await new Promise(r => setTimeout(r, Math.max(1, Math.min(60, Number(result.data?.time_sec)||2))*1000));
}
if (!glb) throw new Error("KeenFace model preparation/download timed out.");
const out = resolve("keentools-output");
await mkdir(out, {recursive:true});
await writeFile(join(out, "Neon_Lock_In_Gamer_Head.glb"), glb);
await writeFile(join(out, "result.txt"), `KeenFace head ID: ${headId}\nModel: Neon_Lock_In_Gamer_Head.glb\nBytes: ${glb.byteLength}\nReference set: 10 source images verified; 7 facial views used for Scan Reconstruction.\nAPI v2; request ID: ${requestId}\nStandalone head reconstruction only. No Fly.io or Sprites dependency. No app deployment performed.\n`);
console.log(`KeenFace reconstruction complete. GLB size: ${glb.byteLength} bytes. Head ID: ${headId}`);
